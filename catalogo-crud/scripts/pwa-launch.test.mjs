import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../public/js/pwa-launch.js', import.meta.url), 'utf8');

function launch({ standalone = true, apple = false, reduced = false, referrer = '', type = 'navigate', search = '', loading = false } = {}) {
  let now = 0;
  let nextId = 0;
  let overlay;
  const timers = new Map();
  const host = () => {
    const listeners = new Map();
    return {
      addEventListener: (type, callback) => listeners.set(type, callback),
      removeEventListener: (type) => listeners.delete(type),
      dispatch: (type) => listeners.get(type)?.(),
    };
  };
  const window = {
    ...host(), location: { origin: 'https://vidamix.test', search },
    matchMedia: (query) => ({ matches: query.includes('reduced-motion') ? reduced : standalone }),
    setTimeout: (callback, delay) => { const id = ++nextId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
  };
  const document = {
    ...host(), referrer, readyState: loading ? 'loading' : 'complete',
    body: { prepend: (element) => { overlay = element; } },
    createElement: () => ({
      ...host(), removed: false, classes: new Set(),
      classList: { add: (name) => overlay.classes.add(name) },
      setAttribute() {}, remove() { this.removed = true; },
    }),
  };
  vm.runInNewContext(source, {
    window, document, navigator: { standalone: apple }, URL, URLSearchParams,
    performance: { now: () => now, getEntriesByType: () => [{ type }] },
  });
  return {
    window, document, overlay, timers,
    advance(ms) {
      const target = now + ms;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, timer] = next;
        timers.delete(id);
        now = timer.at;
        timer.callback();
      }
      now = target;
    },
  };
}

test('launch appears only for installed apps; browser preview is explicit', () => {
  assert.equal(launch({ standalone: false }).overlay, undefined);
  assert.ok(launch().overlay);
  assert.ok(launch({ standalone: false, apple: true }).overlay);
  assert.ok(launch({ standalone: false, search: '?abertura=1' }).overlay);
});

test('internal links, reloads and history never replay the launch', () => {
  assert.equal(launch({ referrer: 'https://vidamix.test/catalogo' }).overlay, undefined);
  for (const type of ['reload', 'back_forward']) assert.equal(launch({ type }).overlay, undefined);
  assert.ok(launch({ referrer: 'https://other.test/' }).overlay);
});

test('launch reveals the app after the introduction and releases every timer', () => {
  const app = launch();
  app.advance(1499);
  assert.equal(app.overlay.classes.has('is-leaving'), false);
  app.advance(1);
  assert.equal(app.overlay.classes.has('is-leaving'), true);
  app.advance(360);
  assert.equal(app.overlay.removed, true);
  assert.equal(app.timers.size, 0);
});

test('reduced motion does not impose the animated introduction delay', () => {
  const app = launch({ reduced: true });
  app.advance(180);
  assert.equal(app.overlay.removed, true);
});

test('slow initialization is bounded and late readiness cannot resurrect the overlay', () => {
  const app = launch({ loading: true });
  app.advance(3200);
  assert.equal(app.overlay.removed, true);
  app.document.dispatch('DOMContentLoaded');
  assert.equal(app.timers.size, 0);
  const ready = launch({ loading: true });
  ready.advance(1800);
  ready.document.dispatch('DOMContentLoaded');
  ready.advance(360);
  assert.equal(ready.overlay.removed, true);
});

test('interaction and leaving the page remove the overlay before a history snapshot', () => {
  for (const event of ['keydown', 'pagehide', 'pointerdown']) {
    const app = launch({ loading: true });
    (event === 'pointerdown' ? app.overlay : app.window).dispatch(event);
    assert.equal(app.overlay.removed, true, event);
    assert.equal(app.timers.size, 0, event);
  }
});

test('every application entry loads the launch before visible content', async () => {
  for (const page of ['index', 'catalogo', 'stories', 'feed', 'indoor-h']) {
    const html = await readFile(new URL(`../public/${page}.html`, import.meta.url), 'utf8');
    assert.match(html, /<body[^>]*>\s*<script src="\/js\/pwa-launch.js"><\/script>/, page);
  }
});
