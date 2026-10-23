import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { COMPOSITION_COUNTS, compositionTargets } from '../public/js/features/stories/composition.js';
import { createStoriesEditorState } from '../public/js/features/stories/state.js';
import { createAutoLayout } from '../public/js/features/stories/auto-layout.js';
import { getArtworkFormat } from '../public/js/features/stories/formats.js';
import { getStoryVideoLayerState } from '../public/js/features/stories/video-animation.js';

const source = await readFile(new URL('../public/js/features/stories/editor.js', import.meta.url), 'utf8');
function selectionFixture(mode) {
  const state = createStoriesEditorState(); state.compositionMode = mode;
  const sandbox = vm.createContext({ state, COMPOSITION_COUNTS, compositionTargets,
    COMPOSITION_MODES: new Set(Object.keys(COMPOSITION_COUNTS)), compositionPanel: {},
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
  assert.deepEqual(COMPOSITION_COUNTS, { single: 1, 'two-products': 2, combo: 2 });
  for (const name of ['stories', 'feed']) {
    const html = await readFile(new URL('../public/' + name + '.html', import.meta.url), 'utf8');
    const modes = [...html.matchAll(/data-composition-mode="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(modes, ['single', 'two-products', 'combo']);
  }
});

for (const [mode, count] of Object.entries(COMPOSITION_COUNTS)) {
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
    assert.equal(compositionTargets(mode).length, 1);
  });
}

test('both product layers appear during video reading and disappear at both endpoints', () => {
  for (let index = 0; index < 2; index++) for (const kind of ['product', 'details']) {
    assert.equal(getStoryVideoLayerState({ kind, index }, 0).opacity, 0);
    assert.equal(getStoryVideoLayerState({ kind, index }, 5).opacity, 1);
    assert.equal(getStoryVideoLayerState({ kind, index }, 15).opacity, 0);
  }
});
