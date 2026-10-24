import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const [source, markup] = await Promise.all([
  readFile(new URL('../public/js/home-intro.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
]);

function intro({ home = true, reduced = false, referrer = '', type = 'navigate', search = '', hidden = false } = {}) {
  let now = 0;
  let nextId = 0;
  let overlay;
  const timers = new Map();
  const listeners = new Map();
  const host = () => ({
    addEventListener: (event, callback) => listeners.set(event, callback),
    removeEventListener: (event) => listeners.delete(event),
    dispatch: (event, detail = {}) => listeners.get(event)?.(detail),
  });
  const window = {
    ...host(),
    location: { origin: 'https://vidamix.test', search },
    matchMedia: (query) => ({ matches: query.includes('reduced-motion') ? reduced : false }),
    setTimeout: (callback, delay) => { const id = ++nextId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
  };
  const bodyClasses = new Set(home ? ['home-page'] : []);
  const document = {
    ...host(), referrer, hidden,
    body: {
      classList: {
        contains: (name) => bodyClasses.has(name),
        add: (name) => bodyClasses.add(name),
      },
      prepend: (element) => { overlay = element; },
    },
    createElement: () => {
      const classes = new Set();
      const events = new Map();
      const element = {
        className: '', innerHTML: '', removed: false, isConnected: true,
        classList: {
          add: (name) => classes.add(name),
          remove: (name) => classes.delete(name),
          contains: (name) => classes.has(name),
        },
        classes,
        setAttribute() {},
        addEventListener: (event, callback) => events.set(event, callback),
        removeEventListener: (event) => events.delete(event),
        dispatch: (event) => events.get(event)?.(),
        remove() { element.removed = true; element.isConnected = false; },
      };
      return element;
    },
  };
  vm.runInNewContext(source, {
    window, document,
    URL, URLSearchParams,
    setTimeout: window.setTimeout,
    clearTimeout: window.clearTimeout,
    performance: { getEntriesByType: () => [{ type }] },
  });
  return {
    window, document, overlay, listeners, timers,
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

const preview = (options = {}) => intro({ search: '?abertura=1', ...options });

test('abertura normal e recarga não montam véu nem timers', () => {
  for (const type of ['navigate', 'reload', 'back_forward']) {
    const app = intro({ type });
    assert.equal(app.overlay, undefined);
    assert.equal(app.timers.size, 0);
  }
});

test('a demonstração monta o gradient animado e entrega a tela exatamente em 2 s', () => {
  const app = preview();
  assert.equal(app.overlay.className, 'home-intro');
  assert.match(app.overlay.innerHTML, /home-intro-canvas/);
  assert.equal((app.overlay.innerHTML.match(/home-intro-blob/g) || []).length, 3);
  assert.doesNotMatch(app.overlay.innerHTML, /home-intro-progress/);
  assert.match(app.overlay.innerHTML, /stackmedia-wordmark\.svg/);

  app.advance(1349);
  assert.equal(app.overlay.classes.has('is-leaving'), false);
  assert.equal(app.document.body.classList.contains('home-entry-ready'), false);

  app.advance(1); // 1350 ms: começa a dissolver e o conteúdo entra
  assert.equal(app.overlay.classes.has('is-leaving'), true);
  assert.equal(app.document.body.classList.contains('home-entry-ready'), true);

  app.advance(649);
  assert.equal(app.overlay.removed, false);

  app.advance(1); // 2000 ms
  assert.equal(app.overlay.removed, true);
  assert.equal(app.timers.size, 0);
});

test('a abertura aparece só na tela inicial', () => {
  assert.equal(preview({ home: false }).overlay, undefined);
});

test('voltar de outra tela ou do histórico não reexecuta a abertura', () => {
  assert.equal(intro({ referrer: 'https://vidamix.test/catalogo' }).overlay, undefined);
  assert.equal(intro({ type: 'back_forward' }).overlay, undefined);
});

test('?abertura=1 força a abertura para demonstração', () => {
  const app = intro({ referrer: 'https://vidamix.test/catalogo', search: '?abertura=1' });
  assert.ok(app.overlay);
});

test('menos movimento entrega o conteúdo de imediato, sem véu', () => {
  const app = preview({ reduced: true });
  assert.equal(app.overlay, undefined);
  assert.equal(app.document.body.classList.contains('home-entry-ready'), false);
  assert.equal(app.timers.size, 0);
});

test('toque, tecla ou saída da tela encerram o véu na hora', () => {
  const tapped = preview();
  tapped.overlay.dispatch('pointerdown');
  assert.equal(tapped.overlay.removed, true);
  assert.equal(tapped.document.body.classList.contains('home-entry-ready'), true);
  assert.equal(tapped.timers.size, 0);

  const typed = preview();
  typed.window.dispatch('keydown');
  assert.equal(typed.overlay.removed, true);
  assert.equal(typed.timers.size, 0);

  const left = preview();
  left.window.dispatch('pagehide');
  assert.equal(left.overlay.removed, true, 'o véu sai antes do snapshot do histórico');
  assert.equal(left.timers.size, 0);
  assert.equal(left.document.body.classList.contains('home-entry-ready'), true);
});

test('a tela inicial carrega a abertura antes de qualquer conteúdo visível', () => {
  const script = markup.indexOf('<script src="/js/home-intro.js"></script>');
  assert.ok(script > -1);
  assert.ok(markup.indexOf('<script src="/js/pwa-launch.js"></script>') < script);
  assert.ok(script < markup.indexOf('<header class="site-header">'));
});

test('suspensão sem pagehide e restauração não preservam o véu', () => {
  const app = preview();
  app.window.dispatch('pageshow', { persisted: false });
  assert.equal(app.overlay.removed, false);
  for (let cycle = 0; cycle < 4; cycle++) {
    app.document.hidden = true;
    app.document.dispatch('visibilitychange');
    assert.equal(app.overlay.removed, true);
    assert.equal(app.timers.size, 0);
    app.document.hidden = false;
    app.document.dispatch('visibilitychange');
    app.window.dispatch('pageshow', { persisted: true });
    assert.equal(app.overlay.removed, true);
  }
  const restored = preview();
  restored.window.dispatch('pageshow', { persisted: true });
  assert.equal(restored.overlay.removed, true);
  assert.equal(restored.timers.size, 0);
  assert.equal(preview({ hidden: true }).overlay.removed, true);
});
