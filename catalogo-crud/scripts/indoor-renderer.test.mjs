import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INDOOR_WIDTH, INDOOR_HEIGHT, INDOOR_DURATION, INDOOR_PRODUCT_COUNT,
  getCarouselState, drawIndoorFrame,
} from '../public/js/features/indoor/renderer.js';

function mockContext() {
  const stack = [];
  const calls = [];
  const context = {
    calls,
    font: '10px Arial',
    globalAlpha: 0.4,
    shadowBlur: 8,
    offsetX: 0,
    save() {
      stack.push(Object.fromEntries(Object.entries(this).filter(([, value]) => typeof value !== 'function' && value !== calls)));
    },
    restore() {
      const state = stack.pop();
      assert.ok(state, 'every restore must have a matching save');
      for (const key of Object.keys(this)) {
        if (typeof this[key] !== 'function' && this[key] !== calls) delete this[key];
      }
      Object.assign(this, state);
    },
    setTransform() { this.offsetX = 0; },
    translate(x) { this.offsetX += x; },
    measureText(value) { return { width: Array.from(value).length * Number(this.font.match(/([\d.]+)px/)[1]) * 0.6 }; },
    fillText(text, x, y) {
      calls.push({ type: 'text', text, x, y, width: this.measureText(text).width, font: this.font, offsetX: this.offsetX });
    },
    drawImage(...args) { calls.push({ type: 'image', args, offsetX: this.offsetX }); },
    fillRect(...args) { calls.push({ type: 'fillRect', args }); },
    rect(...args) { calls.push({ type: 'clipRect', args }); },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    closePath() {},
    fill() {},
    clip() {},
    assertBalanced() { assert.equal(stack.length, 0); },
  };
  return context;
}

function snapshot(overrides = {}) {
  return {
    background: { width: 1920, height: 1080, id: 'background' },
    products: Array.from({ length: 5 }, (_, index) => ({
      product: { nome: `Produto ${index + 1}`, subtitulo: 'Conteúdo da embalagem', fabricante: 'VidaMix' },
      image: { width: 600, height: 1000, id: index },
      price: 'R$ 19,90',
    })),
    ...overrides,
  };
}

test('Indoor uses Full HD and five products in a deterministic 15-second loop', () => {
  assert.deepEqual([INDOOR_WIDTH, INDOOR_HEIGHT, INDOOR_DURATION, INDOOR_PRODUCT_COUNT], [1920, 1080, 15, 5]);
  for (let index = 0; index < 5; index += 1) {
    for (const phase of [0, 1.5, 2.5]) {
      const state = getCarouselState(index * 3 + phase);
      assert.equal(state.index, index);
      assert.equal(state.transition, false);
      assert.deepEqual(state.slides, [{ index, offsetX: 0, opacity: 1 }]);
      assert.deepEqual(getCarouselState(index * 3 + phase), state);
    }
  }
  assert.deepEqual(getCarouselState(15), getCarouselState(0));
  assert.deepEqual(getCarouselState(45), getCarouselState(0));
  for (const invalid of [-10, NaN, Infinity, undefined]) assert.deepEqual(getCarouselState(invalid), getCarouselState(0));
});

test('each transition slides to the next product and the last slides back to the first', () => {
  for (let index = 0; index < 5; index += 1) {
    const middle = getCarouselState(index * 3 + 2.825);
    assert.equal(middle.transition, true);
    assert.equal(middle.nextIndex, (index + 1) % 5);
    assert.ok(Math.abs(middle.progress - 0.5) < 1e-12);
    assert.equal(middle.slides.length, 2);
    assert.ok(Math.abs(middle.slides[0].offsetX + 640) < 1e-8);
    assert.ok(Math.abs(middle.slides[1].offsetX - 640) < 1e-8);
    assert.ok(Math.abs(middle.slides[1].offsetX - middle.slides[0].offsetX - 1280) < 1e-8);
    const before = getCarouselState((index + 1) * 3 - 0.000001);
    const after = getCarouselState((index + 1) * 3);
    assert.ok(Math.abs(before.slides[1].offsetX - after.slides[0].offsetX) < 0.001);
    assert.equal(before.slides[1].index, after.slides[0].index);
  }
});

test('renderer paints only the visible product, or two products during a transition', () => {
  const input = snapshot();
  for (const [seconds, expectedProducts] of [[1, [0]], [6, [2]], [14.9, [4, 0]]]) {
    const context = mockContext();
    const state = drawIndoorFrame(context, input, seconds);
    assert.deepEqual(state, getCarouselState(seconds));
    assert.deepEqual(context.calls.filter((call) => call.type === 'image').map((call) => call.args[0].id), ['background', ...expectedProducts]);
    assert.equal(context.globalAlpha, 0.4);
    assert.equal(context.shadowBlur, 8);
    context.assertBalanced();
  }
});

test('background cover crops without distortion and product contain fits the safe area', () => {
  const input = snapshot({ background: { width: 1000, height: 1000 } });
  input.products[0].image = { width: 4000, height: 100 };
  const context = mockContext();
  drawIndoorFrame(context, input, 0);
  const images = context.calls.filter((call) => call.type === 'image');
  const [, sx, sy, sw, sh, dx, dy, dw, dh] = images[0].args;
  assert.deepEqual([sx, sy, sw, sh, dx, dy, dw, dh], [0, 218.75, 1000, 562.5, 0, 0, 1920, 1080]);
  assert.ok(Math.abs(sw / sh - dw / dh) < 1e-10);
  const [, x, y, width, height] = images[1].args;
  assert.equal(width / height, 40);
  assert.ok(x >= 600 && y >= 120 && x + width <= 1140 && y + height <= 960);
  assert.deepEqual(context.calls.find((call) => call.type === 'clipRect').args, [576, 84, 1280, 912]);
  context.assertBalanced();
});

test('long names, descriptions, manufacturer and prices remain inside the details card', () => {
  const input = snapshot();
  Object.assign(input.products[0], {
    product: { nome: 'Nome muito longo de produto '.repeat(1000), subtitulo: 'Descrição e quantidade '.repeat(1000), fabricante: 'Fabricante'.repeat(1000) },
    price: `R$ ${'999'.repeat(1000)},99`,
  });
  const context = mockContext();
  drawIndoorFrame(context, input, 0);
  const textCalls = context.calls.filter((call) => call.type === 'text');
  assert.equal(textCalls.length, 7, 'one manufacturer, three title lines, two description lines, one price');
  assert.ok(textCalls.some((call) => call.text.endsWith('…')));
  for (const call of textCalls) {
    assert.ok(call.text.length < 100);
    assert.ok(call.width <= 572);
    assert.ok(call.x >= 1224 && call.x + call.width <= 1796);
    assert.ok(call.y >= 276 && call.y + Number(call.font.match(/([\d.]+)px/)[1]) <= 860);
  }
  context.assertBalanced();
});

test('price is optional and no preview controls or timing labels are painted', () => {
  const input = snapshot();
  input.products[0].price = '';
  const context = mockContext();
  drawIndoorFrame(context, input, 0);
  const texts = context.calls.filter((call) => call.type === 'text').map((call) => call.text);
  assert.deepEqual(texts, ['VidaMix', 'Produto 1', 'Conteúdo da embalagem']);
});

test('stationary and sliding offers are clipped clear of the actual templates campaign marks', () => {
  for (const seconds of [0, 2.825, 5.825, 11.9, 14.9999]) {
    const context = mockContext();
    drawIndoorFrame(context, snapshot(), seconds);
    const clipIndex = context.calls.findIndex((call) => call.type === 'clipRect');
    const clip = context.calls[clipIndex].args;
    assert.deepEqual(clip, [576, 84, 1280, 912]);
    assert.ok(clip[0] > 545, 'reserve the widest left-side campaign logo');
    assert.ok(clipIndex > 0, 'paint the fixed background before restricting moving content');
    for (const [index, call] of context.calls.entries()) {
      if (call.type === 'text' || (call.type === 'image' && call.args[0].id !== 'background')) {
        assert.ok(index > clipIndex, 'all product images and offer text must be drawn within the clip');
      }
    }
    context.assertBalanced();
  }
});

test('renderer requires exactly five entries and does not mutate the snapshot', () => {
  for (const products of [[], Array(4).fill({}), Array(6).fill({}), [null, {}, {}, {}, {}]]) {
    const context = mockContext();
    assert.throws(() => drawIndoorFrame(context, snapshot({ products }), 0), /exatamente 5 produtos/);
    assert.equal(context.calls.length, 0);
    context.assertBalanced();
  }
  const input = snapshot();
  const original = structuredClone(input);
  drawIndoorFrame(mockContext(), input, 2.9);
  assert.deepEqual(input, original);
});

test('renderer restores all canvas state when drawing fails', () => {
  const context = mockContext();
  context.fillText = () => { throw new Error('draw failure'); };
  assert.throws(() => drawIndoorFrame(context, snapshot(), 2.9), /draw failure/);
  assert.equal(context.globalAlpha, 0.4);
  assert.equal(context.shadowBlur, 8);
  context.assertBalanced();
});
