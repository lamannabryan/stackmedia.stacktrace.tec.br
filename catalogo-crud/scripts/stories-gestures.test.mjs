import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { STORY_SAFE_TOP, STORY_SAFE_BOTTOM, STORY_HEIGHT, STORY_WIDTH, MIN_PRODUCT_WIDTH } from '../public/js/features/stories/constants.js';
import { getArtworkFormat } from '../public/js/features/stories/formats.js';

const source = await readFile(new URL('../public/js/features/stories/editor.js', import.meta.url), 'utf8');
test('Stories clamps products, offer cards and text below the expanded header during movement and resize', () => {
  const functions = ['getProductWidthLimits', 'clampProductTransform', 'clampDetailsTransform', 'clampFreeTextTransform'];
  const code = functions.map(name => {
    const start = source.indexOf(`function ${name}(`);
    return source.slice(start, source.indexOf('\nfunction ', start + 1));
  }).join('\n');
  const sandbox = vm.createContext({
    STORY_SAFE_TOP, STORY_SAFE_BOTTOM, STORY_HEIGHT, STORY_WIDTH, MIN_PRODUCT_WIDTH,
    state: { freeText: 'Oferta' },
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    getProductImage: () => ({}), getProductAspectRatio: () => 0.5,
    getDefaultProductWidth: () => 400,
    getDetailsWidthLimits: () => ({ minimum: 260, maximum: 1032 }),
    getDetailsLayout: ({ width }) => ({ width, descriptionWidth: width, cardHeight: 300 }),
    getFreeTextWidthLimits: () => ({ minimum: 180, maximum: 1032 }),
    getFreeTextLayout: ({ width }) => ({ width, height: 100 }),
  });
  vm.runInContext(code, sandbox);
  assert.equal(STORY_SAFE_TOP, 410);
  assert.equal(getArtworkFormat('feed').safeTop, 270);
  assert.equal(STORY_SAFE_BOTTOM, 110);
  assert.equal(getArtworkFormat('feed').safeBottom, 0);
  for (const name of ['clampProductTransform', 'clampDetailsTransform', 'clampFreeTextTransform']) {
    for (const width of [150, 400, 5000]) {
      const transform = sandbox[name]({ x: 100, y: -1000, width });
      assert.equal(transform.y, 410, `${name} protects the top at width ${width}`);
      const bottom = sandbox[name]({ x: 100, y: 5000, width });
      const height = name === 'clampProductTransform' ? bottom.width / 0.5 : name === 'clampDetailsTransform' ? 300 : 100;
      assert.equal(bottom.y + height, STORY_HEIGHT - 110, `${name} protects the bottom at width ${width}`);
    }
  }
  const largest = sandbox.clampProductTransform({ x: 0, y: 0, width: 5000 });
  assert.ok(largest.y + largest.width / 0.5 <= STORY_HEIGHT - STORY_SAFE_BOTTOM);
});

// Exercise the real gesture controller, while substituting canvas rendering and product data.
const gestures = source.slice(source.indexOf('let mobileCanvasSelection ='), source.indexOf('\nfunction moveEditorBy('));
const resize = source.slice(source.indexOf('function transformFromResizeGesture('), source.indexOf('\nfunction isMobilePreviewLocked('));

function fixture({ mobile = true, targets = ['product'], linked = false } = {}) {
  const transforms = Object.fromEntries(targets.map((target) => [target, { x: 100, y: 100, width: 400 }]));
  const selections = new Map(targets.map((target) => {
    const captures = new Set();
    const classes = new Set();
    return [target, {
      dataset: { editTarget: target }, hidden: false,
      classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) },
      setPointerCapture: (id) => captures.add(id),
      hasPointerCapture: (id) => captures.has(id),
      releasePointerCapture: (id) => captures.delete(id),
      focus() { this.focused = true; },
    }];
  }));
  const state = { activeEditor: null, gesture: null };
  const resizePoints = [];
  const linkedMovements = [];
  let now = 0;
  let renders = 0;
  const getEditorBox = (target, transform = transforms[target]) => transform && { ...transform, height: transform.width };
  const sandbox = vm.createContext({
    state,
    productTargets: () => targets.filter(target => target.startsWith('product')),
    detailTargets: () => targets.filter(target => target.startsWith('details')),
    document: { body: { classList: { contains: (name) => mobile && name === 'is-mobile-editor' } } },
    performance: { now: () => now },
    isMobilePreviewLocked: () => false,
    getEditorSelection: (target) => selections.get(target),
    getEditorTransform: (target) => transforms[target],
    getEditorBox,
    getEditorWidthLimits: () => ({ minimum: 20, maximum: 1500 }),
    clamp: (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value)),
    clampEditorTransform: (_target, transform) => transform,
    setEditorTransform: (target, transform) => { transforms[target] = transform; },
    setActiveEditor: (target) => { state.activeEditor = target; },
    hasAnchoredEditors: () => linked,
    getAnchoredEditorTargets: () => targets,
    moveAnchoredEditorsBy: (x, y, initial) => {
      linkedMovements.push({ x, y });
      for (const target of targets) transforms[target] = { ...initial[target], x: initial[target].x + x, y: initial[target].y + y };
    },
    artPointFromEvent: (event) => ({ x: event.clientX * 5.4, y: event.clientY * 5.4 }),
    transformDetailsFromResizeGesture: (handle, point, transform, target) => {
      resizePoints.push({ target, handle, point }); return transform;
    },
    transformFreeTextFromResizeGesture: (handle, point, transform) => {
      resizePoints.push({ target: 'free-text', handle, point }); return transform;
    },
    schedulePreview: () => { renders += 1; }, syncProductEditor() {}, updateAvailability() {},
  });
  vm.runInContext(`${resize}\n${gestures}`, sandbox, { filename: 'stories/editor.js gesture controller' });
  const event = (target, { x = 45, y = 45, handle, pointerId = 1, ...details } = {}) => ({
    currentTarget: selections.get(target),
    target: { closest: () => handle ? { dataset: { resizeHandle: handle } } : null },
    clientX: x, clientY: y, pointerId, button: 0, isPrimary: true, pointerType: 'touch',
    preventDefault() { this.defaultPrevented = true; }, ...details,
  });
  const down = (target = targets[0], options) => { const e = event(target, options); sandbox.beginGesture(e); return e; };
  const move = (options) => sandbox.moveGesture(event(targets[0], options));
  const up = (options) => { now += 30; sandbox.finishGesture(event(targets[0], { type: 'pointerup', ...options })); };
  const tap = (target = targets[0], options) => { down(target, options); up(options); now += 70; };
  return { state, transforms, selections, down, move, up, tap, event, sandbox, resizePoints, linkedMovements,
    advance: (duration) => { now += duration; }, get renders() { return renders; } };
}

test('mobile resize preserves the grab offset in all four 44px corner targets', () => {
  for (const handle of ['nw', 'ne', 'sw', 'se']) {
    const f = fixture();
    const cornerX = handle.includes('e') ? 500 : 100;
    const cornerY = handle.includes('s') ? 500 : 100;
    const x = cornerX / 5.4 + 20;
    const y = cornerY / 5.4 + 10;
    f.down('product', { x, y, handle });
    f.move({ x, y });
    assert.ok(Math.abs(f.transforms.product.width - 400) < 1e-9, handle);
    assert.ok(Math.abs(f.transforms.product.x - 100) < 1e-9, handle);
    assert.ok(Math.abs(f.transforms.product.y - 100) < 1e-9, handle);
    f.up({ x, y });
  }
});

test('a small resize follows the finger delta instead of jumping to the edge of its hit target', () => {
  const f = fixture();
  const x = 500 / 5.4 + 20;
  const y = 500 / 5.4;
  f.down('product', { x, y, handle: 'se' });
  f.move({ x: x + 2, y });
  assert.ok(Math.abs(f.transforms.product.width - 405.4) < 1e-9);
  assert.equal(f.transforms.product.x, 100);
  assert.equal(f.transforms.product.y, 100);
});

test('price cards and free text receive the same corrected visual corner coordinates', () => {
  for (const target of ['details', 'details-secondary', 'free-text']) {
    const f = fixture({ targets: [target] });
    const x = 500 / 5.4 + 18;
    const y = 500 / 5.4 - 12;
    f.down(target, { x, y, handle: 'se' });
    f.move({ x: x + 10, y: y + 5 });
    assert.equal(f.resizePoints[0].target, target);
    assert.ok(Math.abs(f.resizePoints[0].point.x - 554) < 1e-9);
    assert.ok(Math.abs(f.resizePoints[0].point.y - 527) < 1e-9);
  }
});

test('overlapping elements follow paint order and repeated taps cycle through every visible layer', () => {
  const f = fixture({ targets: ['product', 'product-secondary', 'details', 'details-secondary', 'free-text'] });
  const expected = ['free-text', 'details-secondary', 'details', 'product-secondary', 'product', 'free-text'];
  for (const target of expected) {
    f.tap('product-secondary'); // DOM order is deliberately different from canvas paint order.
    assert.equal(f.state.activeEditor, target);
  }
  assert.equal(f.renders, 0, 'Taps select without shifting any artwork layer');
  f.selections.get('details-secondary').hidden = true;
  f.tap('product-secondary');
  assert.equal(f.state.activeEditor, 'details', 'Hidden layers are skipped');
});

test('a selected covered element stays draggable without moving the layer painted above it', () => {
  const f = fixture({ targets: ['product', 'details'] });
  f.tap('details');
  f.tap('details');
  assert.equal(f.state.activeEditor, 'product');
  f.down('details');
  assert.equal(f.selections.get('product').hasPointerCapture(1), true);
  f.move({ x: 60, y: 50 });
  f.up({ x: 60, y: 50 });
  assert.ok(Math.abs(f.transforms.product.x - 181) < 1e-9);
  assert.ok(Math.abs(f.transforms.product.y - 127) < 1e-9);
  assert.equal(f.transforms.details.x, 100);
  assert.equal(f.state.activeEditor, 'product', 'Dragging does not cycle the selected target');
  assert.equal(f.selections.get('product').hasPointerCapture(1), false);
});

test('small tap jitter, secondary pointers and cancelled gestures cannot change or cycle artwork', () => {
  const f = fixture({ targets: ['product', 'details'] });
  f.down('details', { isPrimary: false });
  assert.equal(f.state.gesture, null);
  f.tap('details');
  f.down('details');
  f.move({ x: 90, pointerId: 2 });
  f.move({ x: 47 });
  assert.equal(f.transforms.details.x, 100);
  f.sandbox.finishGesture(f.event('details', { type: 'pointercancel' }));
  assert.equal(f.state.activeEditor, 'details');
  f.tap('details');
  assert.equal(f.state.activeEditor, 'details', 'Cancellation resets the tap sequence');
  f.sandbox.finishGesture();
  f.tap('details');
  assert.equal(f.state.activeEditor, 'details', 'Changing editor step resets the tap sequence');
});

test('linked mobile dragging preserves the relative positions of every linked layer', () => {
  const f = fixture({ targets: ['product', 'details'], linked: true });
  f.transforms.details.x = 150;
  f.down('product');
  f.move({ x: 55, y: 55 });
  f.up({ x: 55, y: 55 });
  assert.equal(f.linkedMovements.length, 1);
  assert.equal(f.transforms.details.x - f.transforms.product.x, 50);
  assert.ok(Math.abs(f.transforms.product.y - 154) < 1e-9);
});

test('desktop retains its DOM target and immediate precise movement without mobile tap cycling', () => {
  const f = fixture({ mobile: false, targets: ['product', 'details'] });
  f.tap('product');
  f.tap('product');
  assert.equal(f.state.activeEditor, 'product');
  f.down('product');
  f.move({ x: 46 });
  assert.ok(Math.abs(f.transforms.product.x - 105.4) < 1e-9);
  assert.equal(f.transforms.details.x, 100);
});
