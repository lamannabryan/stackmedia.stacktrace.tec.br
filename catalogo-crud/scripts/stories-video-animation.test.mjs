import assert from 'node:assert/strict';
import test from 'node:test';
import {
  drawStoryVideoFrame,
  getStoryVideoLayerState,
  STORY_VIDEO_DURATION_SECONDS,
} from '../public/js/features/stories/video-animation.js';

const STILL = { opacity: 1, translateX: 0, translateY: 0, scale: 1 };
const LAYERS = [
  { kind: 'product', index: 0 },
  { kind: 'product', index: 1 },
  { kind: 'details', index: 0 },
  { kind: 'details', index: 1 },
  { kind: 'text', index: 0 },
];

test('the 15-second story has invisible endpoints and a stable reading interval', () => {
  assert.equal(STORY_VIDEO_DURATION_SECONDS, 15);
  for (const layer of LAYERS) {
    assert.equal(getStoryVideoLayerState(layer, 0).opacity, 0);
    assert.equal(getStoryVideoLayerState(layer, 15).opacity, 0);
    for (const seconds of [1.5, 2, 7.5, 13, 13.5]) {
      assert.deepEqual(getStoryVideoLayerState(layer, seconds), STILL);
    }
  }
});

test('product, details and text enter in sequence, with the secondary product following the first', () => {
  const first = getStoryVideoLayerState(LAYERS[0], 0.25);
  const second = getStoryVideoLayerState(LAYERS[1], 0.25);
  const details = getStoryVideoLayerState(LAYERS[2], 0.25);
  const text = getStoryVideoLayerState(LAYERS[4], 0.25);
  assert.ok(first.opacity > second.opacity && second.opacity > details.opacity);
  assert.ok(details.opacity > text.opacity);
  assert.equal(text.opacity, 0);
  assert.ok(first.translateX < 0 && second.translateX > 0);
  assert.ok(first.translateY > 0 && first.scale < 1);
  assert.equal(details.translateX, 0);
});

test('entrance and exit remain bounded and monotonic without flicker', () => {
  for (const layer of LAYERS) {
    let previous = 0;
    for (let tick = 0; tick <= 60; tick += 1) {
      const current = getStoryVideoLayerState(layer, tick / 40);
      assert.ok(current.opacity >= previous && current.opacity <= 1);
      assert.ok(current.scale >= 0.94 && current.scale <= 1);
      assert.ok(Object.values(current).every(Number.isFinite));
      previous = current.opacity;
    }
    previous = 1;
    for (let tick = 0; tick <= 60; tick += 1) {
      const current = getStoryVideoLayerState(layer, 13.5 + tick / 40);
      assert.ok(current.opacity <= previous && current.opacity >= 0);
      assert.ok(current.scale >= 0.98 && current.scale <= 1);
      assert.ok(Object.values(current).every(Number.isFinite));
      previous = current.opacity;
    }
    const exiting = getStoryVideoLayerState(layer, 14.05);
    assert.ok(exiting.opacity > 0 && exiting.opacity < 1);
    assert.ok(exiting.translateY < 0 && exiting.scale < 1);
  }
});

test('repeated and out-of-order requests are deterministic, with times clamped to the story', () => {
  for (const layer of LAYERS) {
    const middle = getStoryVideoLayerState(layer, 0.7);
    getStoryVideoLayerState(layer, 14);
    assert.deepEqual(getStoryVideoLayerState(layer, 0.7), middle);
    assert.deepEqual(getStoryVideoLayerState(layer, -1), getStoryVideoLayerState(layer, 0));
    assert.deepEqual(getStoryVideoLayerState(layer, NaN), getStoryVideoLayerState(layer, 0));
    assert.deepEqual(getStoryVideoLayerState(layer, Infinity), getStoryVideoLayerState(layer, 15));
    assert.deepEqual(getStoryVideoLayerState(layer, 20), getStoryVideoLayerState(layer, 15));
  }
});

class FakeContext {
  constructor() {
    this.globalAlpha = 0.3;
    this.globalCompositeOperation = 'screen';
    this.filter = 'blur(2px)';
    this.shadowColor = 'red';
    this.shadowBlur = 8;
    this.shadowOffsetX = 3;
    this.shadowOffsetY = 4;
    this.matrix = [2, 0, 0, 2, 5, 6];
    this.stack = [];
    this.draws = [];
    this.clears = [];
  }

  state() {
    return {
      globalAlpha: this.globalAlpha,
      globalCompositeOperation: this.globalCompositeOperation,
      filter: this.filter,
      shadowColor: this.shadowColor,
      shadowBlur: this.shadowBlur,
      shadowOffsetX: this.shadowOffsetX,
      shadowOffsetY: this.shadowOffsetY,
      matrix: [...this.matrix],
    };
  }

  save() { this.stack.push(this.state()); }
  restore() { Object.assign(this, this.stack.pop()); }
  setTransform(...matrix) { this.matrix = matrix; }
  translate(x, y) {
    const [a, b, c, d, e, f] = this.matrix;
    this.matrix = [a, b, c, d, a * x + c * y + e, b * x + d * y + f];
  }
  scale(x, y) {
    const [a, b, c, d, e, f] = this.matrix;
    this.matrix = [a * x, b * x, c * y, d * y, e, f];
  }
  clearRect(...rectangle) { this.clears.push(rectangle); }
  drawImage(canvas, ...position) {
    if (canvas === this.failOn) throw new Error('paint failed');
    this.draws.push({ canvas, position, ...this.state() });
  }
}

function snapshot() {
  return Object.freeze({
    width: 1080,
    height: 1920,
    background: 'background',
    layers: Object.freeze(LAYERS.map((layer, index) => Object.freeze({
      ...layer,
      canvas: `layer-${index}`,
      bounds: Object.freeze({ x: 120 + index * 20, y: 540 + index * 100, width: 320, height: 480 }),
      compositeOperation: layer.kind === 'product' ? 'multiply' : 'source-over',
    }))),
  });
}

test('the reading interval preserves painting order, geometry and product blending', () => {
  const context = new FakeContext();
  const artwork = snapshot();
  const initial = context.state();
  drawStoryVideoFrame(context, artwork, 7.5);
  assert.deepEqual(context.clears, [[0, 0, 1080, 1920]]);
  assert.deepEqual(context.draws.map(({ canvas }) => canvas), [artwork.background, ...artwork.layers.map(({ canvas }) => canvas)]);
  assert.deepEqual(context.draws.map(({ globalCompositeOperation }) => globalCompositeOperation), [
    'source-over', 'multiply', 'multiply', 'source-over', 'source-over', 'source-over',
  ]);
  for (const draw of context.draws) {
    assert.deepEqual(draw.matrix, [1, 0, 0, 1, 0, 0]);
    assert.deepEqual(draw.position, [0, 0]);
    assert.equal(draw.globalAlpha, 1);
    assert.equal(draw.filter, 'none');
    assert.equal(draw.shadowBlur, 0);
    assert.equal(draw.shadowColor, 'transparent');
  }
  assert.deepEqual(context.state(), initial);
  assert.equal(context.stack.length, 0);
});

test('animated layers use their own bounds as the pivot and leave the background fixed', () => {
  const context = new FakeContext();
  const artwork = snapshot();
  drawStoryVideoFrame(context, artwork, 0.7);
  assert.deepEqual(context.draws[0].matrix, [1, 0, 0, 1, 0, 0]);
  assert.equal(context.draws[0].globalAlpha, 1);
  for (const layer of artwork.layers) {
    const draw = context.draws.find(({ canvas }) => canvas === layer.canvas);
    const animation = getStoryVideoLayerState(layer, 0.7);
    const centerX = layer.bounds.x + layer.bounds.width / 2;
    const centerY = layer.bounds.y + layer.bounds.height / 2;
    assert.ok(draw);
    assert.equal(draw.globalAlpha, animation.opacity);
    assert.equal(draw.matrix[0], animation.scale);
    assert.equal(draw.matrix[3], animation.scale);
    const transformedCenterX = draw.matrix[0] * centerX + draw.matrix[4];
    const transformedCenterY = draw.matrix[3] * centerY + draw.matrix[5];
    assert.ok(Math.abs(transformedCenterX - centerX - animation.translateX) < 1e-9);
    assert.ok(Math.abs(transformedCenterY - centerY - animation.translateY) < 1e-9);
  }
});

test('first and last frames only paint the background', () => {
  for (const seconds of [0, 15]) {
    const context = new FakeContext();
    drawStoryVideoFrame(context, snapshot(), seconds);
    assert.deepEqual(context.draws.map(({ canvas }) => canvas), ['background']);
    assert.equal(context.stack.length, 0);
  }
});

test('a painting failure still restores the caller canvas state', () => {
  for (const failOn of ['background', 'layer-1']) {
    const context = new FakeContext();
    context.failOn = failOn;
    const initial = context.state();
    assert.throws(() => drawStoryVideoFrame(context, snapshot(), 0.7), /paint failed/);
    assert.deepEqual(context.state(), initial);
    assert.equal(context.stack.length, 0);
  }
});
