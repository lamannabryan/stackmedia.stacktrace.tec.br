import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../public/js/page-loading.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function host() {
  const events = new Map();
  return {
    addEventListener(name, callback) {
      if (!events.has(name)) events.set(name, []);
      events.get(name).push(callback);
    },
    emit(name, event = {}) { for (const callback of events.get(name) || []) callback(event); },
    dispatchEvent(event) { this.emit(event.type, event); },
  };
}
function fixture({ images = [], fonts = Promise.resolve() } = {}) {
  const classes = new Set();
  const message = {}, retry = host();
  const content = { inert: false }, alreadyInert = { inert: true };
  const timers = new Map();
  let timerId = 0, reloads = 0, mutations;
  const overlay = { hidden: false, querySelector: selector => selector === 'button' ? retry : message };
  const document = {
    ...host(), readyState: 'loading', images, fonts: { ready: fonts },
    documentElement: { classList: {
      add: name => classes.add(name), remove: name => classes.delete(name),
    } },
    body: { children: [content, alreadyInert], prepend(child) { this.children.unshift(child); } },
    createElement: () => overlay,
  };
  const window = {
    ...host(), innerHeight: 800, innerWidth: 1200,
    location: Object.assign(new URL('https://stackmedia.test/catalogo'), { reload() { reloads++; } }),
    setTimeout(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout: id => timers.delete(id),
    requestAnimationFrame: callback => queueMicrotask(callback),
  };
  vm.runInNewContext(source, {
    window, document, URL, Event, queueMicrotask,
    MutationObserver: class {
      constructor(callback) { mutations = callback; }
      observe() {}
      disconnect() {}
    },
  });
  return {
    window, document, content, alreadyInert, overlay, message, retry,
    loading: () => classes.has('app-is-loading'),
    track: promise => window.appLoading.track(promise),
    load: () => window.emit('load'),
    timeout(delay) { for (const timer of timers.values()) if (timer.delay === delay) timer.callback(); },
    append(child) { document.body.children.push(child); mutations(); },
    get reloads() { return reloads; },
    async click(href, eventOverrides = {}, linkOverrides = {}) {
      const link = { href, target: '', hasAttribute: () => false, ...linkOverrides };
      const event = { button: 0, target: { closest: () => link }, ...eventOverrides };
      document.emit('click', event);
      await flush();
    },
  };
}
function image({ ready = Promise.resolve(), top = 0, hidden = false } = {}) {
  return {
    loading: 'lazy', decoded: 0,
    getAttribute: () => '/product.webp', closest: () => hidden,
    getBoundingClientRect: () => ({ width: 100, height: 100, top, bottom: top + 100, left: 0, right: 100 }),
    decode() { this.decoded++; return ready; },
  };
}

test('every application page covers content before it is parsed', async () => {
  for (const page of ['index', 'catalogo', 'stories', 'feed', 'encarte', 'indoor-h', 'parceiros',
    'usuarios', 'revistas', 'backgrounds', 'import-produtos', 'login', 'offline']) {
    const html = await readFile(new URL(`../public/${page}.html`, import.meta.url), 'utf8');
    assert.match(html, /<body[^>]*>\s*<script src="\/js\/page-loading.js"><\/script>/, page);
    assert.ok(html.indexOf('/page-loading.css') < html.indexOf('<body'), page);
  }
});

test('covers the first paint and waits for data, rendering and window load in either order', async () => {
  for (const dataFirst of [false, true]) {
    const f = fixture(), data = deferred(), rendering = deferred();
    f.track(data.promise); f.track(rendering.promise);
    assert.equal(f.loading(), true);
    assert.equal(f.content.inert, true);
    const tabbar = { inert: false };
    f.append(tabbar);
    assert.equal(tabbar.inert, true);
    if (!dataFirst) f.load();
    data.resolve(); await flush();
    assert.equal(f.loading(), true);
    rendering.resolve(); await flush();
    if (dataFirst) {
      assert.equal(f.loading(), true);
      f.load(); await flush();
    }
    assert.equal(f.loading(), false);
    assert.equal(f.overlay.hidden, true);
    assert.equal(f.content.inert, false);
    assert.equal(tabbar.inert, false);
    assert.equal(f.alreadyInert.inert, true);
  }
});

test('waits for fonts and viewport images, without waiting for hidden or below-fold images', async () => {
  const font = deferred(), bytes = deferred();
  const visible = image({ ready: bytes.promise });
  const below = image({ top: 1600 }), hidden = image({ hidden: true });
  const f = fixture({ images: [visible, below, hidden], fonts: font.promise });
  f.load(); await flush();
  assert.equal(visible.decoded, 0);
  font.resolve(); await flush();
  assert.equal(f.loading(), true);
  assert.equal(visible.loading, 'eager');
  assert.equal(below.decoded, 0);
  assert.equal(hidden.decoded, 0);
  bytes.resolve(); await flush();
  assert.equal(f.loading(), false);
});

test('new tasks registered while decoding images delay the reveal', async () => {
  const bytes = deferred(), data = deferred();
  const f = fixture({ images: [image({ ready: bytes.promise })] });
  f.load(); await flush();
  f.track(data.promise);
  bytes.resolve(); await flush();
  assert.equal(f.loading(), true);
  data.resolve(); await flush();
  assert.equal(f.loading(), false);
});

test('slow data offers a reload without revealing unfinished content, then recovers', async () => {
  const data = deferred(), f = fixture();
  f.track(data.promise); f.load();
  f.timeout(20000);
  assert.equal(f.loading(), true);
  assert.equal(f.retry.hidden, false);
  assert.match(f.message.textContent, /demorando/);
  data.resolve(); await flush();
  assert.equal(f.loading(), false);
});

test('initialization and module errors retain the overlay with a working retry', async () => {
  for (const failure of ['promise', 'script']) {
    const f = fixture(), task = deferred();
    if (failure === 'promise') { f.track(task.promise); task.reject(new Error('Network')); }
    else f.window.emit('error', { target: { tagName: 'SCRIPT' } });
    f.load(); await flush();
    assert.equal(f.loading(), true);
    assert.equal(f.retry.hidden, false);
    assert.match(f.message.textContent, /Não foi possível/);
    f.retry.emit('click');
    assert.equal(f.reloads, 1);
  }
});

test('handled API errors and broken images reveal the rendered fallback', async () => {
  const f = fixture({ images: [image()] });
  f.document.images[0].decode = async () => { throw new Error('Image'); };
  const rendered = deferred();
  f.track(rendered.promise.catch(() => { f.content.error = 'Tente novamente'; }));
  rendered.reject(new Error('API'));
  f.load(); await flush();
  assert.equal(f.content.error, 'Tente novamente');
  assert.equal(f.loading(), false);
});

test('internal navigation covers the page and releases canceled navigations and history restores', async () => {
  const f = fixture(); f.load(); await flush();
  for (const href of ['#products', '/catalogo', 'https://external.test/', '/assets/a.png']) await f.click(href);
  for (const key of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey', 'defaultPrevented']) await f.click('/artes/stories', { [key]: true });
  await f.click('/artes/stories', {}, { target: '_blank' });
  await f.click('/artes/stories', {}, { hasAttribute: () => true });
  assert.equal(f.loading(), false);
  await f.click('/artes/stories?productId=42');
  assert.equal(f.loading(), true);
  f.window.emit('pagehide');
  f.window.emit('pageshow', { persisted: true });
  assert.equal(f.loading(), false);
  await f.click('/import-produtos');
  assert.equal(f.loading(), true);
  f.timeout(15000);
  assert.equal(f.loading(), false);
  // Background actions after initialization never cover the page again.
  f.track(new Promise(() => {}));
  assert.equal(f.loading(), false);
});
