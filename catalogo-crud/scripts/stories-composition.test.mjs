import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { COMPOSITION_COUNTS, compositionModes, compositionTargets } from '../public/js/features/stories/composition.js';
import { createStoriesEditorState } from '../public/js/features/stories/state.js';
import { createAutoLayout } from '../public/js/features/stories/auto-layout.js';
import { getArtworkFormat } from '../public/js/features/stories/formats.js';
import { getStoryVideoLayerState } from '../public/js/features/stories/video-animation.js';

const source = await readFile(new URL('../public/js/features/stories/editor.js', import.meta.url), 'utf8');
function selectionFixture(mode, formatName = 'stories') {
  const state = createStoriesEditorState(getArtworkFormat(formatName).maxProducts || 2); state.compositionMode = mode;
  const sandbox = vm.createContext({ state, COMPOSITION_COUNTS, compositionTargets,
    COMPOSITION_MODES: new Set(compositionModes(formatName)), compositionPanel: {},
    elements: { productContent: { contains: () => false } }, document: { activeElement: null },
    syncCompositionModeControls() {}, setPanelCollapsed() {}, syncProductPanel() {},
    renderProducts() {}, syncProductEditor() {}, renderPreview() {},
    suggestedMagazinePrice: product => product?.price || '', setProductRemovalStatus() {},
    refreshProductSelection() {}, setStatus() {}, mobileEditor: null });
  for (const name of ['getCompositionProductLimit', 'isMultiProductMode', 'productTargets', 'detailTargets', 'extraSlot',
    'selectedProducts', 'getPriceForDetailsTarget', 'selectProductForComposition', 'removeProductFromComposition',
    'normalizeCompositionMode', 'isTwoProductsMode', 'setCompositionMode', 'resetProductCompositionState']) {
    const start = source.indexOf(`function ${name}(`);
    vm.runInContext(source.slice(start, source.indexOf('\nfunction ', start + 1)), sandbox);
  }
  return sandbox;
}

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
  assert.equal(format.width, 1080); assert.equal(format.height, 1080);
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
      assert.ok(box.x + box.width <= 1080.01 && box.y + box.height <= 1080.01);
      for (const other of boxes.slice(index + 1)) assert.ok(box.x + box.width <= other.x + .01 || other.x + other.width <= box.x + .01 || box.y + box.height <= other.y + .01 || other.y + other.height <= box.y + .01);
    }
    assert.equal(createAutoLayout({ mode, orientation, format, products, measureDetails, freeTextBox: { x: 0, y: 0, width: 1080, height: 1080 } }), null);
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
  for (const box of boxes) assert.ok(box.width / (2 / 3) >= 270, 'product height must use the space freed by the compact offers');
  assert.ok(boxes[3].x > boxes[0].x, 'last row is centered');
});
