import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createStoriesEditorState } from '../public/js/features/stories/state.js';
import { createAutoLayout } from '../public/js/features/stories/auto-layout.js';
import { getArtworkFormat } from '../public/js/features/stories/formats.js';

const SAFE_AREA = { left: 56, top: 434, right: 1024, bottom: 1920 * 0.82 };
const GAP = 32;
const EPSILON = 0.001;

function measureCards(target, width) {
  // Mimic cards whose visible description is narrower than the editing frame.
  return {
    width: Math.max(176, width * 0.88),
    height: Math.max(116, width * (target === 'details-secondary' ? 0.46 : 0.38)),
  };
}

function inputFor(mode, aspectRatios = [1, 1], overrides = {}) {
  return {
    mode,
    products: [
      { target: 'product', aspectRatio: aspectRatios[0] },
      ...(mode === 'single' ? [] : [{ target: 'product-secondary', aspectRatio: aspectRatios[1] }]),
    ],
    measureDetails: measureCards,
    ...overrides,
  };
}

function visualBoxes(layout, input) {
  const boxes = [];
  for (const product of input.products) {
    const transform = layout.products[product.target];
    assert.ok(transform, `missing ${product.target}`);
    boxes.push({
      target: product.target,
      ...transform,
      height: transform.width / product.aspectRatio,
    });
  }
  for (const [target, transform] of Object.entries(layout.details)) {
    const measured = input.measureDetails(target, transform.width);
    boxes.push({
      target,
      x: transform.x + (transform.width - measured.width) / 2,
      y: transform.y,
      width: measured.width,
      height: measured.height,
    });
  }
  return boxes;
}

function assertSeparated(first, second) {
  assert.ok(
    first.x + first.width + GAP <= second.x + EPSILON
      || second.x + second.width + GAP <= first.x + EPSILON
      || first.y + first.height + GAP <= second.y + EPSILON
      || second.y + second.height + GAP <= first.y + EPSILON,
    `${first.target} overlaps or crowds ${second.target}: ${JSON.stringify([first, second])}`,
  );
}

function assertUsableLayout(input) {
  const safeArea = input.format ? {
    left: 56, top: input.format.safeTop + 24,
    right: input.format.width - 56, bottom: input.format.height - Math.max(56, input.format.safeBottom || 0, input.format.height * 0.18),
  } : SAFE_AREA;
  const layout = createAutoLayout(input);
  assert.ok(layout, `expected a usable ${input.mode} composition`);
  assert.equal(typeof layout.arrangement, 'string');
  assert.ok(layout.arrangement.length > 0);
  assert.deepEqual(Object.keys(layout.products).sort(), input.products.map(({ target }) => target).sort());
  assert.deepEqual(
    Object.keys(layout.details).sort(),
    input.mode === 'two-products' ? ['details', 'details-secondary'] : ['details'],
  );

  const boxes = visualBoxes(layout, input);
  for (const box of boxes) {
    assert.ok([box.x, box.y, box.width, box.height].every(Number.isFinite), `${box.target} has invalid geometry`);
    assert.ok(box.width > 0 && box.height > 0, `${box.target} must remain visible`);
    assert.ok(box.x >= safeArea.left - EPSILON, `${box.target} exceeds the left margin`);
    assert.ok(box.y >= safeArea.top - EPSILON, `${box.target} overlaps the brand header`);
    assert.ok(box.x + box.width <= safeArea.right + EPSILON, `${box.target} exceeds the right margin`);
    assert.ok(box.y + box.height <= safeArea.bottom + EPSILON, `${box.target} exceeds the bottom margin`);
    if (input.freeTextBox) assertSeparated(box, { target: 'free text', ...input.freeTextBox });
  }
  for (let index = 0; index < boxes.length; index += 1) {
    for (const other of boxes.slice(index + 1)) assertSeparated(boxes[index], other);
  }
  return layout;
}

for (const mode of ['single', 'two-products', 'combo']) {
  test(`Feed ${mode} fits products, offers and free text in the shorter canvas`, () => {
    const format = getArtworkFormat('feed');
    for (const aspects of [[1, 1], [0.25, 0.3], [3.5, 4], [0.25, 3.5], [3.5, 0.25], [0.65, 1.7]]) {
      assertUsableLayout(inputFor(mode, aspects, { format }));
      assertUsableLayout(inputFor(mode, aspects, {
        format, freeTextBox: { x: 220, y: 445, width: 640, height: 100 },
      }));
    }
  });

  test(`explicit Stories format preserves the original ${mode} layout`, () => {
    const input = inputFor(mode);
    assert.deepEqual(createAutoLayout({ ...input, format: getArtworkFormat('stories') }), createAutoLayout(input));
    createAutoLayout({ ...input, format: getArtworkFormat('feed') });
    assert.deepEqual(createAutoLayout(input), createAutoLayout({ ...input, format: getArtworkFormat('stories') }));
  });

  test(`${mode} preserves composition structure and safe spacing for different product shapes`, () => {
    for (const aspects of [[1, 1], [0.25, 0.3], [3.5, 4], [0.25, 3.5], [3.5, 0.25], [0.65, 1.7]]) {
      assertUsableLayout(inputFor(mode, aspects));
    }
  });

  test(`${mode} reserves existing free text without changing its position or dimensions`, () => {
    for (const freeTextBox of [
      { x: 220, y: 430, width: 640, height: 120 },
      { x: 210, y: 1690, width: 660, height: 130 },
      { x: 410, y: 1080, width: 260, height: 150 },
    ]) {
      const original = { ...freeTextBox };
      assertUsableLayout(inputFor(mode, [0.7, 1.5], { freeTextBox }));
      assert.deepEqual(freeTextBox, original);
    }
  });

  test(`${mode} measures long descriptions and larger price cards before placing them`, () => {
    const measureDetails = (target, width) => ({
      width: Math.max(184, width * (target === 'details-secondary' ? 0.96 : 0.82)),
      height: Math.max(180, width * (target === 'details-secondary' ? 0.92 : 0.66)),
    });
    assertUsableLayout(inputFor(mode, [0.8, 1.1], { measureDetails }));
  });
}

test('a single square product uses the available room at a useful display size', () => {
  const input = inputFor('single');
  const layout = assertUsableLayout(input);
  assert.ok(layout.products.product.width >= 600, 'the product should expand into the available space');
});

for (const formatName of ['stories', 'feed']) for (const orientation of ['vertical', 'horizontal']) {
  for (const mode of ['single', 'two-products', 'combo']) {
    test(formatName + ' ' + mode + ' ' + orientation + ' keeps readable offers above the footer', () => {
      const format = getArtworkFormat(formatName);
      for (const ratios of [[0.7, 1], [0.25, 3.5], [3.5, 0.25], [1, 1]]) {
        const input = inputFor(mode, ratios, { format, orientation });
        const layout = assertUsableLayout(input);
        assert.equal(layout.orientation, orientation);
        const boxes = visualBoxes(layout, input);
        for (const product of boxes.filter(box => box.target.startsWith('product'))) {
          const offer = boxes.find(box => box.target === (mode === 'two-products' && product.target.endsWith('secondary') ? 'details-secondary' : 'details'));
          if (orientation === 'vertical') assert.ok(product.y + product.height + GAP <= offer.y + EPSILON);
          else assert.ok(product.x + product.width + GAP <= offer.x + EPSILON);
        }
        assert.deepEqual(createAutoLayout(input), layout, 'reapplying an orientation does not shrink elements');
      }
    });
  }
  test(formatName + ' ' + orientation + ' respects free text and long descriptions', () => {
    for (const mode of ['single', 'two-products', 'combo']) {
      assertUsableLayout(inputFor(mode, [0.7, 1.2], {
        format: getArtworkFormat(formatName), orientation,
        freeTextBox: { x: 200, y: 430, width: 640, height: 80 },
        measureDetails: (target, width) => ({ width: width * 0.9, height: width * 0.55 }),
      }));
    }
  });
}

test('a portrait product and its offer form a compact, centered vertical group', () => {
  for (const formatName of ['stories', 'feed']) {
    const format = getArtworkFormat(formatName);
    const input = inputFor('single', [0.7], { format });
    const layout = assertUsableLayout(input);
    const [product, offer] = visualBoxes(layout, input);
    assert.ok(layout.details.details.width >= 650, 'offer text gets a readable size');
    assert.ok(Math.abs(offer.y - product.y - product.height - GAP) < EPSILON, 'no gap introduced by shrinking');
    assert.ok(Math.abs(product.x + product.width / 2 - format.width / 2) < EPSILON);
    assert.ok(Math.abs(offer.x + offer.width / 2 - format.width / 2) < EPSILON);
    const safeTop = format.safeTop + 24, safeBottom = format.height * 0.82;
    assert.ok(Math.abs((product.y + offer.y + offer.height) / 2 - (safeTop + safeBottom) / 2) < EPSILON);
  }
});

test('two-product measurements keep each price associated with its own card', () => {
  const measuredTargets = new Set();
  const input = inputFor('two-products', [0.6, 1.6], {
    measureDetails(target, width) {
      measuredTargets.add(target);
      return { width: width * 0.9, height: target === 'details' ? 140 : 310 };
    },
  });
  assertUsableLayout(input);
  assert.deepEqual([...measuredTargets].sort(), ['details', 'details-secondary']);
});

test('combo uses one shared price card and never measures a secondary price', () => {
  const input = inputFor('combo', [0.7, 1.4], {
    measureDetails(target, width) {
      assert.equal(target, 'details');
      return measureCards(target, width);
    },
  });
  const layout = assertUsableLayout(input);
  assert.equal(layout.details['details-secondary'], undefined);
});

test('identical inputs produce identical layouts without mutating supplied products', () => {
  const products = Object.freeze([
    Object.freeze({ target: 'product', aspectRatio: 0.5 }),
    Object.freeze({ target: 'product-secondary', aspectRatio: 1.8 }),
  ]);
  const freeTextBox = Object.freeze({ x: 120, y: 430, width: 840, height: 80 });
  const input = Object.freeze(inputFor('two-products', [], { products, freeTextBox }));
  const first = assertUsableLayout(input);
  const second = createAutoLayout(input);
  assert.deepEqual(second, first);
  assert.equal(input.products, products);
  assert.equal(input.freeTextBox, freeTextBox);
});

test('invalid or incomplete product compositions cannot generate a layout', () => {
  const cases = [
    undefined,
    null,
    {},
    inputFor('unknown'),
    inputFor('single', [], { products: [] }),
    inputFor('two-products', [], { products: [{ target: 'product', aspectRatio: 1 }] }),
    inputFor('combo', [], { products: [{ target: 'product', aspectRatio: 1 }] }),
    inputFor('single', [], { products: [{ target: 'unknown', aspectRatio: 1 }] }),
    inputFor('two-products', [], { products: [{ target: 'product', aspectRatio: 1 }, { target: 'product', aspectRatio: 1 }] }),
    ...[0, -1, NaN, Infinity, undefined].map((aspectRatio) => inputFor('single', [aspectRatio])),
    inputFor('single', [1], { measureDetails: undefined }),
  ];
  for (const input of cases) assert.equal(createAutoLayout(input), null);
});

test('invalid measurements and a completely occupied safe area return no layout', () => {
  for (const measurement of [
    { width: 0, height: 100 },
    { width: 100, height: -1 },
    { width: NaN, height: 100 },
    { width: 100, height: Infinity },
    { width: 2000, height: 2000 },
  ]) {
    assert.equal(createAutoLayout(inputFor('single', [1], { measureDetails: () => measurement })), null);
  }
  for (const mode of ['single', 'two-products', 'combo']) {
    assert.equal(createAutoLayout(inputFor(mode, [1, 1], {
      freeTextBox: { x: 56, y: 408, width: 968, height: 1456 },
    })), null);
  }
});

const editorSource = await readFile(new URL('../public/js/features/stories/editor.js', import.meta.url), 'utf8');
test('multi-product offer cards reserve equal space for short and long descriptions', () => {
  const context = vm.createContext({
    isMultiProductMode: () => true, detailTargets: () => ['details'],
    MIN_DETAILS_WIDTH: 260, STORY_WIDTH: 1080, DESCRIPTION_CARD_PADDING: 24,
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    getDetailsTextMetrics: () => ({ titleLines: ['Short'], supportingLines: ['300g'], titleWidth: 50, supportingWidth: 30 }),
    getDetailsPriceMetrics: () => ({ badgeWidth: 120 }),
  });
  const start = editorSource.indexOf('function getDetailsLayout(');
  vm.runInContext(editorSource.slice(start, editorSource.indexOf('\nfunction ', start + 1)), context);
  const short = context.getDetailsLayout({ x: 0, y: 0, width: 300 });
  context.getDetailsTextMetrics = () => ({ titleLines: ['Long product', 'second line'], supportingLines: ['Manufacturer'], titleWidth: 240, supportingWidth: 120 });
  const long = context.getDetailsLayout({ x: 0, y: 0, width: 300 });
  assert.equal(short.descriptionWidth, 300);
  assert.equal(short.cardHeight, long.cardHeight);
  assert.equal(short.priceY, long.priceY);
  assert.equal(short.priceY, short.descriptionHeight, 'price is joined to the description');
});

test('selecting each product applies the same reserved slots as automatic adjustment', () => {
  const state = { compositionMode: 'five-products', autoLayoutOrientation: 'horizontal' };
  const targets = ['product', 'product-secondary', 'product-3', 'product-4', 'product-5'];
  const ready = new Set([targets[0]]);
  const products = {}, details = {};
  const context = vm.createContext({
    state, elements: { autoLayoutStatus: { classList: { add() {}, remove() {} } }, autoLayout: {} },
    format: getArtworkFormat('encarte'), createAutoLayout,
    syncAutoLayoutAvailability: () => ready.size === 5, finishGesture() {},
    productTargets: () => targets, getProductAspectRatio: () => 2 / 3,
    getProductImage: target => ready.has(target),
    getDetailsProduct: target => ready.has(target.replace('details', 'product')),
    getFreeTextLayout: () => null,
    getDetailsLayout: ({ width }) => ({ descriptionWidth: width, cardHeight: 142 }),
    setDefaultProductWidth() {}, setDefaultDetailsWidth() {},
    setProductTransform: (target, transform) => { products[target] = transform; },
    setDetailsTransform: (target, transform) => { details[target] = transform; },
    clampProductTransform: t => t, clampDetailsTransform: t => t,
    isTwoProductsMode: () => true, syncProductEditor() {}, schedulePreview() {}, updateAvailability() {}, setStatus() {},
  });
  const start = editorSource.indexOf('function applyAutoLayout(');
  vm.runInContext(editorSource.slice(start, editorSource.indexOf('\nfunction ', start + 1)), context);
  assert.equal(context.applyAutoLayout({ toggle: false, allowPartial: true }), true);
  assert.equal(Object.keys(products).length, 1);
  assert.equal(Object.keys(details).length, 1);
  const first = structuredClone(products.product);
  for (const target of targets.slice(1)) {
    ready.add(target);
    assert.equal(context.applyAutoLayout({ toggle: false, allowPartial: true }), true);
    assert.deepEqual(products.product, first, 'existing product stays in its reserved slot');
  }
  const initial = structuredClone({ products, details });
  context.applyAutoLayout({ toggle: false });
  assert.deepEqual({ products, details }, initial);
});

test('auto-adjust clicks alternate vertical/horizontal and failed layouts preserve the last arrangement', () => {
  const state = createStoriesEditorState();
  const status = { textContent: '', classList: { add() {}, remove() {} } };
  const context = vm.createContext({
    state, elements: { autoLayoutStatus: status, autoLayout: {} },
    format: getArtworkFormat('feed'), createAutoLayout,
    syncAutoLayoutAvailability: () => true, finishGesture() {},
    productTargets: () => ['product'], getProductAspectRatio: () => 0.7,
    getProductImage: () => ({}), getDetailsProduct: () => ({}),
    getFreeTextLayout: () => null,
    getDetailsLayout: ({ width }) => ({ descriptionWidth: width * 0.88, cardHeight: width * 0.38 }),
    setDefaultProductWidth() {}, setDefaultDetailsWidth() {},
    setProductTransform: (_, transform) => { state.productTransform = transform; },
    setDetailsTransform: (_, transform) => { state.detailsTransform = transform; },
    clampProductTransform: t => t, clampDetailsTransform: t => t,
    isTwoProductsMode: () => false, syncProductEditor() {}, schedulePreview() {}, updateAvailability() {}, setStatus() {},
  });
  const start = editorSource.indexOf('function applyAutoLayout(');
  vm.runInContext(editorSource.slice(start, editorSource.indexOf('\nfunction ', start + 1)), context);
  assert.equal(context.applyAutoLayout(), true);
  assert.equal(state.autoLayoutOrientation, 'vertical');
  const first = structuredClone({ product: state.productTransform, details: state.detailsTransform });
  assert.equal(context.applyAutoLayout(), true);
  assert.equal(state.autoLayoutOrientation, 'horizontal');
  const horizontal = structuredClone({ product: state.productTransform, details: state.detailsTransform });
  context.applyAutoLayout({ toggle: false });
  assert.equal(state.autoLayoutOrientation, 'horizontal', 'format conversion preserves the alignment');
  assert.deepEqual({ product: state.productTransform, details: state.detailsTransform }, horizontal);
  context.getFreeTextLayout = () => ({ x: 0, y: 0, width: 1080, textWidth: 1080, height: 1350 });
  assert.equal(context.applyAutoLayout(), undefined);
  assert.equal(state.autoLayoutOrientation, 'horizontal', 'failure must not advance the cycle');
  assert.deepEqual({ product: state.productTransform, details: state.detailsTransform }, horizontal);
  context.getFreeTextLayout = () => null;
  assert.equal(context.applyAutoLayout(), true);
  assert.equal(state.autoLayoutOrientation, 'vertical');
  assert.deepEqual({ product: state.productTransform, details: state.detailsTransform }, first);
});
