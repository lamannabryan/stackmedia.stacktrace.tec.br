import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const magazineSource = (await readFile(new URL('../public/js/features/magazines/home.js', import.meta.url), 'utf8'))
  .replaceAll('export ', '').replace("import('./catalogue.js')", 'loadCatalogue()');
const carouselSource = (await readFile(new URL('../public/js/features/partners/carousel.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '');

function element() {
  const events = new Map(), attributes = new Map();
  return {
    hidden: false, children: [], textContent: '',
    addEventListener: (name, fn) => events.set(name, fn),
    dispatch: (name, event = {}) => events.get(name)?.(event),
    setAttribute: (name, value) => attributes.set(name, value),
    getAttribute: name => attributes.get(name),
    removeAttribute(name) { delete this[name]; },
    append(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    decode: async () => {},
    animate: () => ({ finished: Promise.resolve(), pause() {}, play() {}, cancel() {} }),
    matches: () => false,
  };
}

const magazine = { title: 'Edição de outubro', month: '2026-10', items: [{ product: { id: 1 } }] };

async function magazineClient({ observer = true, failImport = false, response = magazine } = {}) {
  const nodes = new Map();
  const get = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const state = { requests: 0, imports: 0, mounts: [], disconnected: false };
  class Observer {
    constructor(callback) { state.intersect = callback; }
    observe(node) { state.observed = node; }
    disconnect() { state.disconnected = true; }
  }
  const context = vm.createContext({
    Intl, Date, AbortSignal,
    window: observer ? { IntersectionObserver: Observer } : {}, IntersectionObserver: Observer,
    document: { getElementById: get, createElement: element },
    fetch: async () => { state.requests++; return { ok: true, json: async () => ({ revista: response }) }; },
    loadCatalogue: async () => {
      state.imports++;
      if (failImport && state.imports === 1) throw new Error('offline');
      return { mountMagazineCatalogue: edition => state.mounts.push(edition) };
    },
  });
  vm.runInContext(magazineSource, context);
  await flush();
  return { state, get, result: await vm.runInContext('currentMagazine', context) };
}

test('the magazine GET starts without waiting for auth/me; below-fold catalogue waits for visibility', async () => {
  const app = await magazineClient();
  assert.equal(app.state.requests, 1);
  assert.equal(app.result.title, magazine.title);
  assert.equal(app.get('home-magazine-title').textContent, magazine.title);
  assert.equal(app.state.imports, 0);
  app.state.intersect([{ isIntersecting: false }]);
  await flush();
  assert.equal(app.state.imports, 0);
  app.state.intersect([{ isIntersecting: true }]);
  app.state.intersect([{ isIntersecting: true }]);
  await flush();
  assert.equal(app.state.imports, 1);
  assert.equal(app.state.mounts.length, 1);
  assert.equal(app.state.disconnected, true);
});

test('magazine has a no-observer fallback, retries a failed module and skips an empty edition', async () => {
  const legacy = await magazineClient({ observer: false });
  assert.equal(legacy.state.mounts.length, 1);
  const retry = await magazineClient({ observer: false, failImport: true });
  assert.equal(retry.state.mounts.length, 0);
  retry.get('home-magazine-status').children[0].dispatch('click');
  await flush();
  assert.equal(retry.state.mounts.length, 1);
  const empty = await magazineClient({ response: null });
  assert.equal(empty.result, null);
  assert.equal(empty.state.imports, 0);
});

async function carouselClient(edition = null) {
  const nodes = new Map();
  const get = selector => { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); };
  const images = [get('#partner-logo'), element(), element()];
  const root = get('#partner-carousel');
  root.querySelector = get;
  root.querySelectorAll = () => images;
  const logos = new Map();
  const context = vm.createContext({
    AbortSignal, performance, encodeURIComponent,
    setTimeout: () => 1, clearTimeout() {},
    document: { querySelector: get, getElementById: id => get('#' + id), createElement: element,
      hidden: false, addEventListener() {} },
    window: { addEventListener() {} },
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    sessionReady: new Promise(() => {}),
    currentMagazine: Promise.resolve(edition), magazineMonth: () => 'outubro',
    logoArtwork: url => { const pending = deferred(); logos.set(url, pending); return pending.promise; },
    fetch: async () => ({ ok: true, json: async () => ({ items: ['Acme', 'Beta', 'Gama'].map(fabricante => ({
      fabricante, logo_url: `/${fabricante}.webp`, total: 10,
    })) }) }),
  });
  vm.runInContext(carouselSource, context);
  await flush();
  return { get, images, logos, context };
}

test('a slow logo or session does not block the hero; only the visible logo is prepared', async () => {
  const app = await carouselClient();
  assert.equal(app.get('#partner-name').textContent, 'Acme');
  assert.equal(app.get('#partner-carousel').getAttribute('aria-busy'), 'false');
  assert.equal(app.get('#partner-loading').hidden, true);
  assert.equal(app.get('#partner-products').href, '/catalogo?fabricante=Acme');
  assert.deepEqual([...app.logos.keys()], ['/Acme.webp']);
  app.get('#partner-next').dispatch('click');
  await flush();
  assert.equal(app.get('#partner-name').textContent, 'Beta');
  app.logos.get('/Acme.webp').resolve({ src: '/late-acme.webp' });
  await flush();
  assert.ok(app.images.every(image => image.src !== '/late-acme.webp'));
  app.logos.get('/Beta.webp').resolve({ src: '/beta-ready.webp' });
  await flush();
  assert.ok(app.images.every(image => image.src === '/beta-ready.webp' && !image.hidden));
  assert.equal(app.get('#partner-logo-placeholder').hidden, true);
});

test('the magazine slide makes no partner-logo downloads on startup', async () => {
  const app = await carouselClient(magazine);
  assert.equal(app.get('#partner-name').textContent, magazine.title);
  assert.equal(app.get('#partner-loading').hidden, true);
  assert.equal(app.logos.size, 0);
});
