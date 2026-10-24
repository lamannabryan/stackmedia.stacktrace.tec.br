import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { getEncarteItemBounds, drawEncarteItemSurface } from '../public/js/features/stories/encarte-items.js';
import { createAutoLayout } from '../public/js/features/stories/auto-layout.js';
import { compositionTargets } from '../public/js/features/stories/composition.js';
import { getArtworkFormat } from '../public/js/features/stories/formats.js';

test('fallback item areas enclose the image and offer and follow manual edits within the canvas', () => {
  const image = { x: 50, y: 350, width: 200, height: 300 };
  const details = { x: 30, y: 675, width: 260, height: 140 };
  assert.deepEqual(getEncarteItemBounds(image, details, 1080, 1440), { x: 20, y: 340, width: 280, height: 485 });
  assert.deepEqual(getEncarteItemBounds({ ...image, x: 400 }, details, 1080, 1440), { x: 20, y: 340, width: 590, height: 485 });
  assert.equal(getEncarteItemBounds(null, null, 1080, 1440), null);
  const edge = getEncarteItemBounds({ x: 0, y: 0, width: 1080, height: 1440 }, null, 1080, 1440);
  assert.deepEqual(edge, { x: 3, y: 3, width: 1074, height: 1434 });
});

for (const orientation of ['vertical', 'horizontal']) {
  test(`five ${orientation} reserved cells keep content inside their surfaces during subtle zoom`, () => {
    const format = getArtworkFormat('encarte');
    const targets = compositionTargets('five-products');
    const ratios = [0.25, 0.7, 1, 2.4, 0.6];
    const layout = createAutoLayout({ format, mode: 'five-products', orientation,
      products: targets.map((target, i) => ({ target, aspectRatio: ratios[i] })),
      measureDetails: (_, width) => ({ width, height: 160 }),
    });
    assert.ok(layout);
    const frames = targets.map((target, i) => {
      const product = layout.products[target];
      const frame = layout.itemAreas[target];
      const details = { ...layout.details[target.replace('product', 'details')], height: 160 };
      for (const box of [{ ...product, height: product.width / ratios[i] }, details]) {
        assert.ok(box.x >= frame.x && box.y >= frame.y);
        assert.ok(box.x + box.width <= frame.x + frame.width + .01);
        assert.ok(box.y + box.height <= frame.y + frame.height + .01);
        const centerX = frame.x + frame.width / 2, centerY = frame.y + frame.height / 2;
        const zoomed = { x: centerX + (box.x - centerX) * 1.015, y: centerY + (box.y - centerY) * 1.015,
          width: box.width * 1.015, height: box.height * 1.015 };
        assert.ok(zoomed.x >= frame.x + 6 && zoomed.y >= frame.y + 6);
        assert.ok(zoomed.x + zoomed.width <= frame.x + frame.width - 6);
        assert.ok(zoomed.y + zoomed.height <= frame.y + frame.height - 6);
      }
      return frame;
    });
    const x = Math.min(...frames.map(frame => frame.x)), y = Math.min(...frames.map(frame => frame.y));
    const right = Math.max(...frames.map(frame => frame.x + frame.width));
    const bottom = Math.max(...frames.map(frame => frame.y + frame.height));
    assert.ok(Math.abs(frames.reduce((sum, frame) => sum + frame.width * frame.height, 0) - (right - x) * (bottom - y)) < .01);
    assert.ok(Math.abs(frames[0].x + frames[0].width - frames[1].x) < .01, 'horizontal edges touch');
    const nextRow = orientation === 'horizontal' ? 2 : 3;
    assert.ok(Math.abs(frames[0].y + frames[0].height - frames[nextRow].y) < .01, 'vertical edges touch');
    for (const [index, frame] of frames.entries()) {
      for (const next of frames.slice(index + 1)) {
        assert.ok(frame.x + frame.width <= next.x + .01 || next.x + next.width <= frame.x + .01
          || frame.y + frame.height <= next.y + .01 || next.y + next.height <= frame.y + .01);
      }
    }
  });
}

const source = await readFile(new URL('../public/js/features/stories/editor.js', import.meta.url), 'utf8');
const { offerQuantity, quantityImageBoxes } = await import('../public/js/features/stories/quantity-offer.js');
test('only Encarte snapshots include item surfaces and freeze the shared animation geometry', () => {
  let rasterized = 0;
  const sandbox = vm.createContext({
    formatName: 'encarte', STORY_WIDTH: 1080, STORY_HEIGHT: 1440,
    state: { backgroundImage: {}, backgroundBadgeTheme: { fill: '#123456' } },
    productTargets: () => ['product'], detailTargets: () => ['details'],
    getProductImage: () => ({}), getDetailsProduct: () => ({}),
    getProductBox: () => ({ x: 100, y: 350, width: 200, height: 300 }),
    getDetailsBox: () => ({ x: 80, y: 670, width: 260, height: 150 }),
    getFreeTextBox: () => null, hasPrice: () => true, getPriceForDetailsTarget: () => '99,90',
    getEncarteItemBounds, drawEncarteItemSurface,
    offerQuantity, quantityImageBoxes,
    drawProductImage() {}, drawProductCopies() {}, drawDetailsCard() {}, drawImageCover() {},
    createExportCanvas: () => ({ canvas: { id: ++rasterized }, context: {} }),
  });
  for (const name of ['getCompositionLayers', 'captureVideoSnapshot']) {
    const start = source.indexOf(`function ${name}(`);
    vm.runInContext(source.slice(start, source.indexOf('\nfunction ', start + 1)), sandbox);
  }
  const canvases = [];
  const snapshot = sandbox.captureVideoSnapshot(canvases);
  assert.equal(snapshot.format, 'encarte');
  assert.equal(snapshot.itemCount, 1);
  assert.equal(snapshot.layers[0].kind, 'item-surface');
  assert.equal(snapshot.layers[0].canvas, undefined, 'frames do not allocate full-size canvases');
  assert.equal(canvases.length, 3, 'only background, product and offer are rasterized');
  assert.deepEqual(snapshot.layers[1].animationBounds, snapshot.layers[0].bounds);
  assert.deepEqual(snapshot.layers[2].animationBounds, snapshot.layers[0].bounds);
  sandbox.state.backgroundBadgeTheme.fill = '#ffffff';
  assert.equal(snapshot.layers[0].accent, '#123456');
  for (const format of ['stories', 'feed']) {
    sandbox.formatName = format;
    assert.equal(sandbox.getCompositionLayers().length, 2);
    assert.ok(sandbox.getCompositionLayers().every(layer => layer.kind !== 'item-surface'));
  }
});
