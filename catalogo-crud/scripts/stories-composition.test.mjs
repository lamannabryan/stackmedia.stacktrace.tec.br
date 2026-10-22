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

test('changing quantity preserves retained prices and clears removed images, transforms and offers', () => {
  const f = selectionFixture('five-products');
  for (let id = 1; id <= 5; id++) f.selectProductForComposition({ id, price: `${id},00` });
  f.state.secondaryPrice = '89,90';
  f.state.extraProducts[0].price = '77,70';
  for (const slot of f.state.extraProducts) { slot.image = {}; slot.productTransform = { x: 1, y: 2, width: 300 }; }
  f.setCompositionMode('four-products');
  assert.equal(f.state.extraProducts[0].price, '77,70');
  assert.equal(f.state.extraProducts[2].product, null);
  assert.ok(f.state.extraProducts.every(slot => slot.image === null && slot.productTransform === null));
  f.setCompositionMode('two-products');
  assert.equal(f.state.secondaryPrice, '89,90');
  assert.ok(f.state.extraProducts.every(slot => slot.product === null && slot.price === ''));
  f.setCompositionMode('single');
  assert.equal(f.state.selectedProduct.id, 1);
  assert.equal(f.state.secondaryProduct, null);
  f.setCompositionMode('combo');
  assert.equal(f.state.price, '');
  f.setCompositionMode('five-products');
  assert.equal(f.state.price, '1,00');
});

for (const [mode, count] of Object.entries(COMPOSITION_COUNTS).filter(([, count]) => count > 2)) {
  test(`${mode} enforces the limit, toggles selections and keeps prices with remaining products`, () => {
    const f = selectionFixture(mode);
    const products = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, nome: `Produto ${i + 1}`, price: `${i + 1},99` }));
    products.forEach(product => f.selectProductForComposition(product));
    assert.deepEqual(Array.from(f.selectedProducts(), p => p.id), products.slice(0, count).map(p => p.id));
    f.state.extraProducts[count - 3].price = '99,90';
    f.selectProductForComposition(products[1]);
    assert.equal(f.state.secondaryProduct.id, 3);
    assert.equal(f.state.secondaryPrice, count === 3 ? '99,90' : '3,99');
    assert.equal(f.getPriceForDetailsTarget(f.detailTargets()[count - 2]), '99,90');
    f.selectProductForComposition(products[5]);
    assert.equal(f.selectedProducts().at(-1).id, 6);
    assert.equal(f.getPriceForDetailsTarget(f.detailTargets().at(-1)), '6,99');
    f.removeProductFromComposition('primary');
    assert.equal(f.state.selectedProduct.id, 3);
    f.removeProductFromComposition('all');
    assert.ok(f.selectedProducts().every(p => p === null));
    assert.ok(f.detailTargets().every(target => f.getPriceForDetailsTarget(target) === ''));
  });

  for (const name of ['stories', 'feed']) test(`${name} ${mode} fits every image and offer without collisions`, () => {
    const format = getArtworkFormat(name);
    for (const ratios of [[0.3, 0.5, 1, 2, 4], [1, 1, 1, 1, 1]]) {
      const products = compositionTargets(mode).map((target, i) => ({ target, aspectRatio: ratios[i] }));
      const measureDetails = (_target, width) => ({ width: width * 0.95, height: 190 });
      const options = { format, mode, products, measureDetails };
      const result = createAutoLayout(options);
      assert.ok(result);
      assert.equal(Object.keys(result.products).length, count);
      assert.equal(Object.keys(result.details).length, count);
      assert.deepEqual(createAutoLayout(options), result, 'repeated adjustment is stable');
      const boxes = products.map(p => ({ ...result.products[p.target], height: result.products[p.target].width / p.aspectRatio }));
      for (const [target, transform] of Object.entries(result.details)) {
        const measured = measureDetails(target, transform.width);
        boxes.push({ x: transform.x + (transform.width - measured.width) / 2, y: transform.y, ...measured });
      }
      for (const a of boxes) {
        assert.ok(a.x >= 56 && a.x + a.width <= format.width - 56 + 0.01);
        assert.ok(a.y >= format.safeTop + 24 && a.y + a.height <= format.height - Math.max(56, format.safeBottom) + 0.01);
      }
      for (let i = 0; i < boxes.length; i++) for (const b of boxes.slice(i + 1)) {
        const a = boxes[i];
        assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
      }
      assert.equal(createAutoLayout({ ...options, products: products.slice(1) }), null);
      assert.equal(createAutoLayout({ ...options, freeTextBox: { x: 0, y: 0, width: format.width, height: format.height } }), null);
    }
  });
}

test('every layer of a five-product video appears during reading and disappears at both endpoints', () => {
  for (let index = 0; index < 5; index++) for (const kind of ['product', 'details']) {
    assert.equal(getStoryVideoLayerState({ kind, index }, 0).opacity, 0);
    assert.equal(getStoryVideoLayerState({ kind, index }, 5).opacity, 1);
    assert.equal(getStoryVideoLayerState({ kind, index }, 15).opacity, 0);
  }
});
