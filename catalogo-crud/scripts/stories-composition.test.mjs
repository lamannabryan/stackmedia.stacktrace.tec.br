import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { COMPOSITION_COUNTS, compositionModes, compositionTargets } from '../public/js/features/stories/composition.js';
import { createStoriesEditorState } from '../public/js/features/stories/state.js';
import { createAutoLayout } from '../public/js/features/stories/auto-layout.js';
import { getArtworkFormat } from '../public/js/features/stories/formats.js';
import { getStoryVideoLayerState } from '../public/js/features/stories/video-animation.js';
import { suggestedMagazinePrice } from '../public/js/features/stories/price-input.js';
import { loadSelectedProducts, selectedProductIds } from '../public/js/features/magazines/selection.js';

const source = await readFile(new URL('../public/js/features/stories/editor.js', import.meta.url), 'utf8');
function selectionFixture(mode, formatName = 'stories') {
  const state = createStoriesEditorState(getArtworkFormat(formatName).maxProducts || 2); state.compositionMode = mode;
  const sandbox = vm.createContext({ state, COMPOSITION_COUNTS, compositionTargets,
    productSelectionRequest: null, loadSelectedProducts, selectedProductIds, compositionModes, formatName,
    format: getArtworkFormat(formatName), productPanel: {},
    addProductToResults(product) { state.productResults.push(product); },
    COMPOSITION_MODES: new Set(compositionModes(formatName)), compositionPanel: {},
    elements: { productContent: { contains: () => false } }, document: { activeElement: null },
    syncCompositionModeControls() {}, setPanelCollapsed() {}, syncProductPanel() {},
    renderProducts() {}, syncProductEditor() {}, renderPreview() {}, updateAvailability() {},
    suggestedMagazinePrice: product => product?.price || '', setProductRemovalStatus() {},
    refreshProductSelection() {}, setStatus() {}, mobileEditor: null });
  for (const name of ['getCompositionProductLimit', 'isMultiProductMode', 'productTargets', 'detailTargets', 'extraSlot',
    'selectedProducts', 'getPriceForDetailsTarget', 'selectProductForComposition', 'removeProductFromComposition',
    'normalizeCompositionMode', 'isTwoProductsMode', 'setCompositionMode', 'resetProductCompositionState']) {
    const start = source.indexOf(`function ${name}(`);
    vm.runInContext(source.slice(start, source.indexOf('\nfunction ', start + 1)), sandbox);
  }
  for (const name of ['selectProductFromCatalogue', 'preselectProductFromLocation']) {
    const start = source.indexOf(`async function ${name}(`);
    const end = source.slice(start + 1).search(/\n(?:async )?function /);
    vm.runInContext(source.slice(start, start + 1 + end), sandbox);
  }
  return sandbox;
}

for (const formatName of ['stories', 'feed', 'encarte']) {
  test(`${formatName} refreshes magazine prices before selecting from an already loaded catalogue`, async () => {
    const f = selectionFixture('two-products', formatName);
    f.suggestedMagazinePrice = suggestedMagazinePrice;
    const current = { id: 1, imagem_local_url: '/product.png', revista_preco_centavos: 1990 };
    const requests = [];
    f.requestJson = async (url, options) => {
      requests.push(url);
      assert.equal(options.cache, 'no-store');
      return { ...current };
    };
    await f.selectProductFromCatalogue({ ...current, revista_preco_centavos: 999 });
    assert.equal(f.state.price, '19,90');
    assert.deepEqual(requests, ['/api/products/1']);
    f.state.price = '17,50';
    current.id = 2;
    current.revista_preco_centavos = 2990;
    await f.selectProductFromCatalogue({ id: 2 });
    assert.equal(f.state.price, '17,50', 'adding another product preserves manual edits');
    assert.equal(f.state.secondaryPrice, '29,90');
    await f.selectProductFromCatalogue(current);
    assert.equal(requests.length, 2, 'deselecting requires no lookup');
    current.revista_preco_centavos = null;
    await f.selectProductFromCatalogue({ ...current, revista_preco_centavos: 2990 });
    assert.equal(f.state.secondaryPrice, '', 'an expired or removed offer cannot survive in the catalogue');
  });

  test(`${formatName} applies magazine prices to single and multiple product links`, async () => {
    for (const search of ['?productId=1', '?productIds=1,2']) {
      const f = selectionFixture('single', formatName);
      f.suggestedMagazinePrice = suggestedMagazinePrice;
      f.window = { location: { search } };
      f.requestJson = async url => ({ id: Number(url.split('/').at(-1)), revista_preco_centavos: 1990 });
      assert.equal(await f.preselectProductFromLocation(), true);
      assert.equal(f.state.price, '19,90');
      assert.equal(f.state.secondaryPrice, search.includes('productIds') ? '19,90' : '');
    }
  });
}

test('catalogue selection fails without inserting stale prices and can retry', async () => {
  const f = selectionFixture('single');
  const messages = [];
  f.suggestedMagazinePrice = suggestedMagazinePrice;
  f.setStatus = (...args) => messages.push(args);
  f.requestJson = async () => { throw new Error('Network unavailable'); };
  await f.selectProductFromCatalogue({ id: 1, revista_preco_centavos: 999 });
  assert.equal(f.state.selectedProduct, null);
  assert.equal(f.state.price, '');
  assert.equal(messages.at(-1)[1], true);
  f.requestJson = async () => ({ id: 1, imagem_local_url: '/product.png', revista_preco_centavos: 1990 });
  await f.selectProductFromCatalogue({ id: 1 });
  assert.equal(f.state.price, '19,90');
});

test('pending catalogue selections cannot apply after removal or a composition change', async () => {
  for (const cancel of [f => f.removeProductFromComposition('all'), f => f.setCompositionMode('single')]) {
    const f = selectionFixture('two-products');
    let resolve;
    f.requestJson = () => new Promise(done => { resolve = done; });
    const pending = f.selectProductFromCatalogue({ id: 1 });
    await f.selectProductFromCatalogue({ id: 2 });
    cancel(f);
    resolve({ id: 1, imagem_local_url: '/product.png', revista_preco_centavos: 1990 });
    await pending;
    assert.equal(f.state.selectedProduct, null);
    assert.equal(f.productSelectionRequest, null);
  }
});

test('both editors offer only one product, two products and a two-product combo', async () => {
  assert.deepEqual(compositionModes('stories'), ['single', 'two-products', 'combo']);
  assert.deepEqual(compositionModes('feed'), ['single', 'two-products', 'combo']);
  for (const name of ['stories', 'feed']) {
    const html = await readFile(new URL('../public/' + name + '.html', import.meta.url), 'utf8');
    const modes = [...html.matchAll(/data-composition-mode="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(modes, ['single', 'two-products', 'combo']);
  }
});

for (const [mode, count] of Object.entries(COMPOSITION_COUNTS).filter(([, count]) => count <= 2)) {
  test(mode + ' never selects or exports more than the allowed products', () => {
    const f = selectionFixture(mode);
    for (let id = 1; id <= 5; id++) {
      f.selectProductForComposition({ id, price: id + ',00' });
      assert.ok(f.selectedProducts().filter(Boolean).length <= count);
    }
    assert.equal(f.selectedProducts().filter(Boolean).length, count);
    assert.equal(f.productTargets().length, count);
    assert.equal(f.detailTargets().length, mode === 'combo' ? 1 : count);
    assert.equal(f.state.extraProducts.length, 0);
    assert.equal(f.state.secondaryProduct?.id ?? null, count === 2 ? 5 : null);
    f.removeProductFromComposition('all');
    assert.ok(f.selectedProducts().every(product => product === null));
    assert.equal(f.state.price, '');
    assert.equal(f.state.secondaryPrice, '');
  });
}

test('reducing to one product clears the second product, its image, position and price', () => {
  const f = selectionFixture('two-products');
  f.selectProductForComposition({ id: 1, price: '1,00' });
  f.selectProductForComposition({ id: 2, price: '2,00' });
  f.state.secondaryPrice = '89,90';
  f.state.secondaryProductImage = {};
  f.state.secondaryProductTransform = { x: 1, y: 2, width: 300 };
  f.setCompositionMode('single');
  assert.equal(f.state.selectedProduct.id, 1);
  assert.equal(f.state.price, '1,00');
  assert.equal(f.state.secondaryProduct, null);
  assert.equal(f.state.secondaryPrice, '');
  assert.equal(f.state.secondaryProductImage, null);
  assert.equal(f.state.secondaryProductTransform, null);
  f.setCompositionMode('two-products');
  assert.equal(f.state.secondaryProduct, null, 'removed products do not reappear');
});

test('switching between separate offers and combo keeps two products and resets the shared price', () => {
  const f = selectionFixture('two-products');
  f.selectProductForComposition({ id: 1, price: '1,00' });
  f.selectProductForComposition({ id: 2, price: '2,00' });
  f.setCompositionMode('combo');
  assert.equal(f.state.price, '');
  assert.equal(f.detailTargets().length, 1);
  assert.deepEqual(Array.from(f.selectedProducts(), product => product.id), [1, 2]);
  f.setCompositionMode('two-products');
  assert.equal(f.state.price, '1,00');
  assert.equal(f.state.secondaryPrice, '2,00');
});

for (const mode of ['three-products', 'four-products', 'five-products']) {
  test(mode + ' is no longer accepted by the editor', () => {
    const f = selectionFixture('two-products');
    f.selectProductForComposition({ id: 1, price: '1,00' });
    f.selectProductForComposition({ id: 2, price: '2,00' });
    f.setCompositionMode(mode);
    assert.equal(f.state.compositionMode, 'single');
    assert.equal(f.state.secondaryProduct, null);
    assert.equal(f.productTargets().length, 1);
    assert.ok(!compositionModes('feed').includes(mode));
  });
}

test('both product layers appear during video reading and disappear at both endpoints', () => {
  for (let index = 0; index < 9; index++) for (const kind of ['product', 'details']) {
    assert.equal(getStoryVideoLayerState({ kind, index }, 0).opacity, 0);
    assert.equal(getStoryVideoLayerState({ kind, index }, 5).opacity, 1);
    assert.equal(getStoryVideoLayerState({ kind, index }, 15).opacity, 0);
  }
});

test('Encarte offers all counts through five using the same editor controls as Feed', async () => {
  const read = name => readFile(new URL('../public/' + name + '.html', import.meta.url), 'utf8');
  const html = await read('encarte');
  const feed = await read('feed');
  const ids = source => [...source.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids(html)).size, ids(html).length, 'IDs must remain unique');
  for (const id of ids(feed).filter(id => id !== 'story-composition-mode-combo')) assert.ok(ids(html).includes(id), 'missing shared control ' + id);
  assert.deepEqual([...html.matchAll(/data-composition-mode="([^"]+)"/g)].map(match => match[1]), compositionModes('encarte'));
  const format = getArtworkFormat('encarte');
  assert.equal(format.width, 1080); assert.equal(format.height, 1440);
  assert.equal(format.backgroundsUrl, '/api/encarte-backgrounds');
});

for (const [mode, count] of Object.entries(COMPOSITION_COUNTS).filter(([, count]) => count > 2)) {
  for (const orientation of ['vertical', 'horizontal']) test(`Encarte ${count} ${orientation} fits every product and offer without overlap`, () => {
    const format = getArtworkFormat('encarte');
    const products = compositionTargets(mode).map((target, index) => ({ target, aspectRatio: [0.25, 1, 2.4][index % 3] }));
    const measureDetails = (_target, width) => ({ width, height: 142 });
    const layout = createAutoLayout({ mode, orientation, format, products, measureDetails });
    assert.ok(layout, 'layout must be available');
    assert.equal(Object.keys(layout.products).length, count);
    assert.equal(Object.keys(layout.details).length, count);
    const boxes = products.map(product => ({ ...layout.products[product.target], height: layout.products[product.target].width / product.aspectRatio }));
    boxes.push(...Object.values(layout.details).map(transform => ({ ...transform, height: 142 })));
    for (const [index, box] of boxes.entries()) {
      assert.ok(box.x >= 0 && box.y >= format.safeTop && box.width > 0 && box.height > 0);
      assert.ok(box.x + box.width <= 1080.01 && box.y + box.height <= format.height + .01);
      for (const other of boxes.slice(index + 1)) assert.ok(box.x + box.width <= other.x + .01 || other.x + other.width <= box.x + .01 || box.y + box.height <= other.y + .01 || other.y + other.height <= box.y + .01);
    }
    assert.equal(createAutoLayout({ mode, orientation, format, products, measureDetails, freeTextBox: { x: 0, y: 0, width: format.width, height: format.height } }), null);
  });
}

for (const [mode, count] of Object.entries(COMPOSITION_COUNTS).filter(([mode]) => compositionModes('encarte').includes(mode))) {
  test('Encarte ' + mode + ' keeps products and prices together up to its limit', () => {
    const f = selectionFixture(mode, 'encarte');
    for (let id = 1; id <= count; id++) f.selectProductForComposition({ id, price: id + ',00' });
    assert.equal(f.selectedProducts().filter(Boolean).length, count);
    if (count > 2) {
      f.selectProductForComposition({ id: 99, price: '99,00' });
      assert.equal(f.selectedProducts().filter(Boolean).length, count);
      f.removeProductFromComposition('3');
      assert.equal(f.selectedProducts().filter(Boolean).length, count - 1);
      if (count > 3) { assert.equal(f.state.extraProducts[0].product.id, 4); assert.equal(f.state.extraProducts[0].price, '4,00'); }
      f.setCompositionMode('two-products');
      assert.ok(f.state.extraProducts.every(slot => slot.product === null && slot.price === ''));
      f.setCompositionMode(mode);
      assert.equal(f.selectedProducts().filter(Boolean).length, 2);
    }
    f.removeProductFromComposition('all');
    assert.ok(f.selectedProducts().every(product => !product));
  });
}

test('Encarte rejects combo while Feed and Stories retain it', () => {
  const f = selectionFixture('single', 'encarte');
  f.setCompositionMode('combo');
  assert.equal(f.state.compositionMode, 'single');
  assert.ok(!compositionModes('encarte').includes('combo'));
});

test('Encarte rejects compositions above five products', () => {
  assert.equal(getArtworkFormat('encarte').maxProducts, 5);
  assert.deepEqual(compositionModes('encarte'), ['single', 'two-products', 'three-products', 'four-products', 'five-products']);
  for (const mode of ['six-products', 'seven-products', 'eight-products', 'nine-products']) {
    const f = selectionFixture('five-products', 'encarte');
    f.setCompositionMode(mode);
    assert.equal(f.state.compositionMode, 'single');
    assert.equal(f.state.extraProducts.length, 3);
  }
});

test('five-product Encarte gives images two tall rows with centered offers below', () => {
  const products = compositionTargets('five-products').map(target => ({ target, aspectRatio: 2 / 3 }));
  const layout = createAutoLayout({ format: getArtworkFormat('encarte'), mode: 'five-products', products,
    measureDetails: (_target, width) => ({ width, height: 142 }) });
  const boxes = Object.values(layout.products);
  assert.equal(new Set(boxes.map(box => box.y)).size, 2);
  assert.equal(boxes[0].y, boxes[2].y);
  assert.equal(boxes[3].y, boxes[4].y);
  for (const box of boxes) {
    assert.ok(box.width / (2 / 3) >= 240, 'products remain readable inside the campaign safe area');
    assert.ok(box.y >= 326, 'products stay below the campaign header');
  }
  for (const card of Object.values(layout.details)) assert.ok(card.y + 142 <= 1440 * 0.84 + .01, 'offers stay above the diagonal footer');
  assert.ok(boxes[3].x > boxes[0].x, 'last row is centered');
});
