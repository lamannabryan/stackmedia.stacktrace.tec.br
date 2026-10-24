import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import * as model from '../public/js/features/indoor/model.js';
import { bindPriceInput } from '../public/js/features/stories/price-input.js';
import { selectedProductIds, loadSelectedProducts } from '../public/js/features/magazines/selection.js';
import { getCarouselState } from '../public/js/features/indoor/renderer.js';
import { sampleThemeColor } from '../public/js/features/indoor/palette.js';

const [markup, moduleSource] = await Promise.all([
  readFile(new URL('../public/indoor-h.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/js/features/indoor/editor.js', import.meta.url), 'utf8'),
]);
// Run the real controller with the real model and price input. Browser facilities
// are simulated; renderer and MP4 encoding have their own executable test suites.
const script = moduleSource.replace(/^import .+;\r?$/gm, '')
  .replace("await import('../stories/video-export.js')", 'await importVideo()');

class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName.toLowerCase();
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
    this.value = '';
    this.clickCount = 0;
    const classes = new Set();
    this.classList = {
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
      contains: (name) => classes.has(name),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
    };
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); delete this[name]; }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
  }
  dispatch(type, detail = {}) {
    const event = { target: this, ...detail };
    for (const callback of this.listeners.get(type) || []) callback(event);
  }
  click() { if (!this.disabled) { this.clickCount += 1; this.dispatch('click'); } }
  focus() { this.focused = true; if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  contains(node) { return node === this || this.descendants().includes(node); }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  getContext() { return { canvas: this }; }
  querySelectorAll(selector) {
    const matches = (node) => {
      if (selector.endsWith(':not(:disabled)') && node.disabled) return false;
      const simple = selector.replace(':not(:disabled)', '');
      if (simple === 'button') return node.tagName === 'button';
      if (selector === 'button' || selector === 'input') return node.tagName === selector;
      const data = selector.match(/^\[data-product-id="([^"]+)"\]$/);
      if (data) return node.dataset.productId === data[1];
      const move = simple.match(/^\[data-move="([^"]+)"\]$/);
      if (move) return node.dataset.move === move[1];
      if (simple.startsWith('.')) return (node.className || '').split(' ').includes(simple.slice(1));
      const attribute = selector.match(/^\[([^=]+)="([^"]+)"\]$/);
      return attribute ? node.getAttribute(attribute[1]) === attribute[2] : false;
    };
    const descendants = this.children.flatMap((child) => [child, ...child.descendants()]);
    return descendants.filter(matches);
  }
  descendants() { return this.children.flatMap((child) => [child, ...child.descendants()]); }
  querySelector(selector) {
    const classDescendant = selector.match(/^(\.[\w-]+) (.+)$/);
    if (classDescendant) return this.querySelector(classDescendant[1])?.querySelector(classDescendant[2]) ?? null;
    const descendantInput = selector.match(/^(\[data-product-id="[^"]+"\]) input$/);
    if (descendantInput) return this.querySelector(descendantInput[1])?.querySelector('input') ?? null;
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

const flush = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};
const products = Array.from({ length: 6 }, (_, index) => ({
  id: index + 1, nome: `Produto ${index + 1}`, imagem_local_url: `/assets/imagens/produto-${index + 1}.png`,
}));
const backgrounds = [{ nome: 'Campanha TV', url: '/assets/camas-indoor-h/campanha.png' }];
const productPage = (items = products, page = 1, totalPages = 1) => ({
  items, pagination: { page, total: items.length * totalPages, totalPages },
});

async function openEditor(t, options = {}) {
  // Missing HTML controls must fail the same way they would in the browser.
  const elements = new Map();
  const steps = [];
  const backs = [];
  for (const [tag, name] of markup.matchAll(/<([a-z][a-z0-9]*)\b[^>]*>/gi)) {
    const node = new Element(name);
    const id = tag.match(/\bid="([^"]+)"/)?.[1];
    node.hidden = /\bhidden(?:\s|[=>])/.test(tag);
    node.disabled = /\bdisabled(?:\s|[=>])/.test(tag);
    node.value = tag.match(/\bvalue="([^"]*)"/)?.[1] ?? '';
    for (const [, attribute, value] of tag.matchAll(/\b(data-step|data-go|width|height)="([^"]+)"/g)) {
      if (attribute.startsWith('data-')) node.dataset[attribute.slice(5)] = value;
      else node[attribute] = Number(value);
    }
    if (id) elements.set(id, node);
    if (node.dataset.step) steps.push(node);
    if (node.dataset.go) backs.push(node);
  }
  const document = new Element('document');
  document.getElementById = (id) => elements.get(id) ?? null;
  document.querySelectorAll = (selector) => selector === '[data-step]' ? steps : selector === '[data-go]' ? backs : [];
  document.createElement = (tag) => { const node = new Element(tag); node.ownerDocument = document; return node; };
  for (const node of elements.values()) node.ownerDocument = document;
  for (const [parent, children] of Object.entries({
    catalog: ['search', 'results'], 'selection-panel': ['selected', 'selected-heading'],
    'product-views': ['show-catalog', 'show-selection'], 'mobile-dock': ['mobile-back', 'mobile-next'],
  })) elements.get(`indoor-${parent}`).append(...children.map((id) => elements.get(`indoor-${id}`)));
  const window = new Element('window');
  window.location = { search: options.search || '' };
  const media = new Element('media');
  media.matches = Boolean(options.mobile);
  window.matchMedia = () => media;
  window.scrollY = 0;
  window.scrollTo = ({ top }) => { window.scrollY = top; };
  const requests = [];
  const imageRequests = [];
  const paints = [];
  const exports = [];
  const createdUrls = [];
  const revokedUrls = [];
  const timers = new Map();
  const frames = new Map();
  let nextId = 1;
  class FakeImage {
    set src(url) {
      this.url = url;
      this.naturalWidth = 1920;
      this.naturalHeight = 1080;
      imageRequests.push(url);
      queueMicrotask(() => {
        if (options.imageLoad) options.imageLoad(this, url);
        else this.onload?.();
      });
    }
  }
  const sandbox = vm.createContext({
    ...model, bindPriceInput, selectedProductIds, loadSelectedProducts, sampleThemeColor, document, window, Image: FakeImage,
    AbortController, DOMException, URLSearchParams, Blob,
    INDOOR_WIDTH: 1920, INDOOR_HEIGHT: 1080, INDOOR_PRODUCT_DURATION: 8,
    drawIndoorFrame: (context, snapshot, seconds) => {
      paints.push({ context, snapshot, seconds });
      return getCarouselState(seconds, snapshot.products.length);
    },
    performance: { now: () => 0 },
    requestAnimationFrame: (callback) => { const id = nextId++; frames.set(id, callback); return id; },
    cancelAnimationFrame: (id) => frames.delete(id),
    setTimeout: (callback, duration) => { const id = nextId++; timers.set(id, { callback, duration }); return id; },
    clearTimeout: (id) => timers.delete(id),
    URL: {
      createObjectURL: (blob) => { const url = `blob:indoor-${createdUrls.length}`; createdUrls.push({ url, blob }); return url; },
      revokeObjectURL: (url) => revokedUrls.push(url),
    },
    fetch: async (url, { signal, cache }) => {
      requests.push({ url, signal, cache });
      const parsed = new URL(url, 'https://local.invalid');
      let body;
      if (parsed.pathname === '/api/products') {
        body = options.products ? await options.products(parsed.searchParams, signal) : productPage();
      } else if (/^\/api\/products\/\d+$/.test(parsed.pathname)) {
        const id = Number(parsed.pathname.split('/').at(-1));
        body = options.product ? await options.product(id) : { ...products.find(item => item.id === id), revista_preco_centavos: id * 100 + 99 };
      } else if (url === '/api/indoor-backgrounds') {
        body = { items: options.backgrounds ? await options.backgrounds() : backgrounds };
      } else throw new Error(`Unexpected API URL: ${url}`);
      return { ok: true, status: 200, json: async () => body };
    },
    importVideo: async () => ({
      exportStoryVideo: async (configuration) => {
        exports.push({ ...configuration, width: configuration.canvas.width, height: configuration.canvas.height });
        if (options.exportVideo) return options.exportVideo(configuration);
        configuration.renderFrame(0);
        configuration.renderFrame(449 / 30);
        configuration.onProgress(1);
        return new Blob(['MP4 test artifact'], { type: 'video/mp4' });
      },
    }),
  });
  vm.runInContext(script, sandbox, { filename: 'indoor/editor.js' });
  t.after(() => window.dispatch('pagehide'));
  await flush();
  const get = (id) => elements.get(`indoor-${id}`);
  const runDebounce = async () => {
    for (const [id, timer] of timers) if (timer.duration === 200) {
      timers.delete(id);
      timer.callback();
    }
    await flush();
  };
  const resize = (mobile) => { media.matches = mobile; media.dispatch('change'); };
  return { get, steps, document, window, resize, requests, imageRequests, paints, exports, createdUrls, revokedUrls, frames, runDebounce };
}

async function selectProduct(fixture, id) {
  fixture.get('results').querySelector(`[data-product-id="${id}"]`).click();
  await flush();
}

async function selectFive(fixture) {
  for (let id = 1; id <= 5; id += 1) await selectProduct(fixture, id);
}

async function openPreview(fixture) {
  await selectFive(fixture);
  fixture.get('continue').click();
  fixture.get('continue').click();
  await flush();
  fixture.get('backgrounds').querySelector('button').click();
  fixture.get('open-preview').click();
  await flush();
}

test('TV requires at least two products and a background, and limits selection to five', async (t) => {
  const f = await openEditor(t);
  const query = new URL(f.requests[0].url, 'https://local.invalid').searchParams;
  assert.equal(query.get('status'), 'ativo');
  assert.equal(query.get('imagem'), 'com');
  assert.equal(query.get('page'), '1');
  assert.equal(query.get('pageSize'), '18');
  assert.equal(f.get('continue').disabled, true);
  assert.equal(f.get('download').disabled, true);
  await selectProduct(f, 1);
  assert.equal(f.get('continue').disabled, true);
  f.get('continue').click();
  assert.equal(f.requests.length, 2, 'One product cannot continue');
  for (let id = 2; id <= 4; id += 1) await selectProduct(f, id);
  assert.equal(f.get('continue').disabled, false);
  await selectProduct(f, 5);
  assert.equal(f.get('selection-count').textContent, '5 / 5');
  assert.equal(f.get('results').querySelector('[data-product-id="6"]').disabled, true);
  assert.equal(f.get('continue').disabled, false);
  f.get('continue').click();
  f.get('continue').click();
  await flush();
  assert.equal(f.requests.at(-1).url, '/api/indoor-backgrounds');
  assert.equal(f.get('products-panel').hidden, true);
  assert.equal(f.get('background-panel').hidden, false);
  assert.equal(f.get('open-preview').disabled, true);
  f.get('backgrounds').querySelector('button').click();
  f.get('open-preview').click();
  await flush();
  assert.equal(f.get('preview-panel').hidden, false);
  assert.equal(f.get('download').disabled, false);
  assert.equal(f.imageRequests.length, 6);
  assert.equal(f.get('scenes').children.length, 5);
  assert.deepEqual(Array.from(f.paints.at(-1).snapshot.products, (entry) => entry.product.id), [1, 2, 3, 4, 5]);
  f.get('scenes').children[4].click();
  assert.equal(f.paints.at(-1).seconds, 32);
  assert.equal(f.get('duration-summary').textContent, '40 segundos');
  assert.equal(Number(f.get('time').max), 40 - 1 / 30);
  f.get('play').click();
  assert.equal(f.frames.size, 1);
  f.document.hidden = true;
  f.document.dispatch('visibilitychange');
  assert.equal(f.frames.size, 0, 'Hiding the tab pauses playback');
});

test('magazine links open TV with the selected order and imported prices and export two products', async t => {
  const f = await openEditor(t, { search: '?productIds=4,2' });
  assert.equal(f.get('selected-heading').textContent, 'Preços e ordem');
  assert.deepEqual(Array.from(f.get('selected').children, row => row.dataset.productId), ['4', '2']);
  assert.deepEqual(Array.from(f.get('selected').querySelectorAll('input'), input => input.value), ['4,99', '2,99']);
  f.get('continue').click();
  await flush();
  f.get('backgrounds').querySelector('button').click();
  f.get('open-preview').click();
  await flush();
  assert.equal(f.get('scenes').children.length, 2);
  assert.equal(f.get('sequence-summary').textContent, '2 produtos · 8 s por produto');
  f.get('scenes').children[1].click();
  assert.equal(f.paints.at(-1).seconds, 8);
  f.get('download').click();
  await flush();
  assert.equal(f.exports.length, 1);
  assert.deepEqual(Array.from(f.paints.at(-1).snapshot.products, item => [item.product.id, item.price]), [[4, 'R$ 4,99'], [2, 'R$ 2,99']]);
});

test('TV catalogue and search use fresh magazine prices even when the listed price is stale', async t => {
  const f = await openEditor(t, {
    products: () => productPage(products.map(product => ({ ...product, revista_preco_centavos: 999 }))),
    product: async id => ({ ...products[id - 1], revista_preco_centavos: id === 1 ? 1990 : null }),
  });
  await selectProduct(f, 1);
  f.get('search').value = 'Produto 2';
  f.get('search').dispatch('input');
  await f.runDebounce();
  await selectProduct(f, 2);
  const lookups = f.requests.filter(request => /^\/api\/products\/\d+$/.test(request.url));
  assert.deepEqual(lookups.map(request => request.url), ['/api/products/1', '/api/products/2']);
  assert.ok(lookups.every(request => request.cache === 'no-store'));
  f.get('continue').click();
  assert.deepEqual(Array.from(f.get('selected').querySelectorAll('input'), input => input.value), ['19,90', '']);
});

test('TV blocks duplicate clicks while checking the price and allows retry after failure', async t => {
  const pending = deferred();
  let retry = false;
  const f = await openEditor(t, { product: async id => retry
    ? { ...products[id - 1], revista_preco_centavos: 1990 } : pending.promise });
  f.get('results').querySelector('[data-product-id="1"]').click();
  assert.equal(f.get('results').querySelector('[data-product-id="1"]').disabled, true);
  assert.equal(f.get('continue').disabled, true);
  assert.match(f.get('status').textContent, /Carregando produto/);
  pending.reject(new Error('Network unavailable'));
  await flush();
  assert.equal(f.get('selection-count').textContent, '0 / 5');
  assert.match(f.get('status').textContent, /Não foi possível carregar o produto/);
  assert.equal(f.get('results').querySelector('[data-product-id="1"]').disabled, false);
  retry = true;
  await selectProduct(f, 1);
  assert.equal(f.get('selection-count').textContent, '1 / 5');
});

test('unavailable preselected products report an error without opening a partial TV campaign', async t => {
  const f = await openEditor(t, { search: '?productIds=1,2', product: async id => {
    if (id === 2) throw new Error('Produto indisponível');
    return products[0];
  } });
  assert.equal(f.get('selection-count').textContent, '0 / 5');
  assert.match(f.get('status').textContent, /Produto indisponível/);
  assert.equal(f.get('continue').disabled, true);
});

test('mobile review preserves catalogue scroll and prices while reordering without focusing the keyboard', async (t) => {
  const f = await openEditor(t, { mobile: true });
  assert.equal(f.get('mobile-dock').hidden, false);
  assert.equal(f.get('selection-panel').hidden, true);
  assert.equal(f.get('mobile-next').disabled, true);
  await selectProduct(f, 1);
  await selectProduct(f, 2);
  f.window.scrollY = 640;
  f.get('mobile-next').click();
  assert.equal(f.get('catalog').hidden, true);
  assert.equal(f.get('selection-panel').hidden, false);
  assert.equal(f.window.scrollY, 0);
  assert.equal(f.get('mobile-next').disabled, false, 'Two products can advance');
  assert.equal(f.get('selected').querySelector('input'), null);
  for (let id = 3; id <= 5; id++) await selectProduct(f, id);
  f.get('mobile-next').click();
  const input = f.get('selected').querySelector('[data-product-id="1"] input');
  input.value = '1290';
  input.dispatch('input');
  f.get('selected').querySelector('[data-product-id="1"]').querySelector('[data-move="1"]').click();
  assert.equal(f.get('selected').children[1].dataset.productId, '1');
  assert.equal(f.get('selected').children[1].querySelector('input').value, '12,90');
  assert.equal(f.document.activeElement.tagName, 'button', 'Reordering does not open the price keyboard');
  f.get('mobile-back').click();
  f.get('mobile-back').click();
  assert.equal(f.get('catalog').hidden, false);
  assert.equal(f.get('selection-panel').hidden, true);
  assert.equal(f.window.scrollY, 640, 'Returning to the catalogue restores the browsing position');
  f.resize(false);
  assert.equal(f.get('catalog').hidden, false);
  assert.equal(f.get('selection-panel').hidden, false);
  assert.equal(f.get('mobile-dock').hidden, true);
  assert.equal(f.get('selected').querySelector('input'), null);
  f.get('continue').click();
  assert.equal(f.get('selected').children[1].querySelector('input').value, '12,90');
});

test('mobile actions complete the campaign and keep export cancellation available', async (t) => {
  const f = await openEditor(t, { mobile: true, exportVideo: ({ signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
  }) });
  await selectFive(f);
  f.get('mobile-next').click();
  assert.equal(f.get('selection-panel').hidden, false);
  f.get('mobile-next').click();
  f.get('mobile-next').click();
  await flush();
  assert.equal(f.get('background-panel').hidden, false);
  assert.equal(f.get('mobile-next').disabled, true, 'A background is still required');
  f.get('backgrounds').querySelector('button').click();
  f.get('mobile-next').click();
  await flush();
  assert.equal(f.get('preview-panel').hidden, false);
  assert.equal(f.get('mobile-next').disabled, false);
  f.get('mobile-next').click();
  await flush();
  assert.equal(f.exports.length, 1);
  assert.equal(f.get('mobile-next').disabled, true);
  assert.equal(f.get('mobile-back').textContent, 'Cancelar');
  f.get('mobile-back').click();
  await flush();
  assert.equal(f.exports[0].signal.aborted, true);
  assert.equal(f.createdUrls.length, 0);
  assert.equal(f.get('mobile-next').disabled, false);
  assert.match(f.get('mobile-hint').textContent, /Exportação cancelada/);
});

test('empty background inventory blocks preview and can recover after refreshing', async (t) => {
  let items = [];
  const f = await openEditor(t, { backgrounds: () => items });
  await selectFive(f);
  f.get('continue').click();
  f.get('continue').click();
  await flush();
  assert.equal(f.get('open-preview').disabled, true);
  assert.equal(f.get('download').disabled, true);
  assert.equal(f.get('reload-backgrounds').hidden, false);
  assert.match(f.get('backgrounds').children[0].textContent, /Ainda não há fundos/);
  items = backgrounds;
  f.get('reload-backgrounds').click();
  await flush();
  f.get('backgrounds').querySelector('button').click();
  assert.equal(f.get('open-preview').disabled, false);
});

test('failed product images prevent export and retry reloads only the failed image', async (t) => {
  let failing = true;
  const f = await openEditor(t, { imageLoad(image, url) {
    if (failing && url === products[2].imagem_local_url) image.onerror?.();
    else image.onload?.();
  } });
  await openPreview(f);
  assert.equal(f.get('download').disabled, true);
  assert.equal(f.get('play').disabled, true);
  assert.equal(f.get('retry-preview').hidden, false);
  assert.match(f.get('preview-loading').textContent, /Não foi possível carregar/);
  f.get('download').click();
  assert.equal(f.exports.length, 0);
  failing = false;
  f.get('retry-preview').click();
  await flush();
  assert.equal(f.get('download').disabled, false);
  assert.equal(f.imageRequests.length, 7);
  assert.equal(f.imageRequests.at(-1), products[2].imagem_local_url);
});

test('editing a price invalidates the preview and revokes the previous MP4 before regenerating', async (t) => {
  const f = await openEditor(t);
  await openPreview(f);
  f.get('download').click();
  await flush();
  assert.equal(f.exports.length, 1);
  assert.equal(f.exports[0].width, 1920);
  assert.equal(f.exports[0].height, 1080);
  assert.equal(f.get('download-link').hidden, false);
  assert.equal(f.get('download-link').clickCount, 1);
  assert.match(f.get('download-link').download, /^stackmedia-tv-.*\.mp4$/);
  assert.equal(f.get('export-progress').hidden, true);
  assert.equal(f.exports[0].canvas.width, 0, 'Export releases its temporary canvas');
  f.steps.find((node) => node.dataset.step === 'pricing').click();
  const input = f.get('selected').querySelector('input');
  input.value = '1290';
  input.dispatch('input');
  assert.equal(input.value, '12,90');
  assert.equal(f.get('download').disabled, true);
  assert.equal(f.get('download-link').hidden, true);
  assert.equal(f.get('download-link').href, undefined);
  assert.deepEqual(f.revokedUrls, [f.createdUrls[0].url]);
  f.steps.find((node) => node.dataset.step === 'preview').click();
  await flush();
  assert.equal(f.get('download').disabled, false);
  assert.equal(f.paints.at(-1).snapshot.products[0].price, 'R$ 12,90');
  assert.equal(f.exports[0].signal.aborted, false);
});

test('cancelling export aborts the encoder, prevents download and restores the preview controls', async (t) => {
  const f = await openEditor(t, { exportVideo: ({ signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
  }) });
  await openPreview(f);
  f.get('download').click();
  await flush();
  assert.equal(f.exports.length, 1);
  assert.equal(f.get('download').disabled, true);
  assert.equal(f.get('search').disabled, true);
  assert.ok(f.steps.every((node) => node.disabled));
  assert.equal(f.get('cancel-export').hidden, false);
  f.get('cancel-export').click();
  await flush();
  assert.equal(f.exports[0].signal.aborted, true);
  assert.equal(f.createdUrls.length, 0);
  assert.equal(f.get('download').disabled, false);
  assert.equal(f.get('search').disabled, false);
  assert.equal(f.get('cancel-export').hidden, true);
  assert.equal(f.get('export-progress').hidden, true);
  assert.match(f.get('export-status').textContent, /Exportação cancelada/);
  assert.equal(f.get('export-status').classList.contains('is-error'), false);
});

test('out-of-order search responses cannot replace results from the latest query', async (t) => {
  const old = deferred();
  const latest = deferred();
  const f = await openEditor(t, { products: (params) => {
    if (params.get('q') === 'antiga') return old.promise;
    if (params.get('q') === 'nova') return latest.promise;
    return productPage();
  } });
  await selectProduct(f, 1);
  f.get('search').value = 'antiga';
  f.get('search').dispatch('input');
  await f.runDebounce();
  const oldRequest = f.requests.at(-1);
  f.get('search').value = 'nova';
  f.get('search').dispatch('input');
  assert.equal(oldRequest.signal.aborted, true);
  await f.runDebounce();
  latest.resolve(productPage([products[4]]));
  await flush();
  old.resolve(productPage([products[1]]));
  await flush();
  assert.equal(f.get('results').children.length, 1);
  assert.equal(f.get('results').children[0].dataset.productId, '5');
  assert.equal(f.get('selection-count').textContent, '1 / 5', 'Searching retains the existing selection');
  assert.equal(f.get('results').getAttribute('aria-busy'), 'false');
});

test('leaving preview while images load cannot restore a stale exportable snapshot', async (t) => {
  const loading = [];
  const f = await openEditor(t, { imageLoad: (image) => loading.push(image) });
  await openPreview(f);
  assert.equal(loading.length, 6);
  assert.equal(f.get('download').disabled, true);
  f.steps.find((node) => node.dataset.step === 'pricing').click();
  f.get('selected').querySelector('input').value = '999';
  f.get('selected').querySelector('input').dispatch('input');
  for (const image of loading) image.onload?.();
  await flush();
  assert.equal(f.get('download').disabled, true);
  assert.equal(f.paints.length, 0);
  f.steps.find((node) => node.dataset.step === 'preview').click();
  await flush();
  assert.equal(f.get('download').disabled, false);
  assert.equal(f.paints.at(-1).snapshot.products[0].price, 'R$ 9,99');
});
