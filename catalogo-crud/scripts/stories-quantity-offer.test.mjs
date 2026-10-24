import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { normalizeOfferQuantity, offerQuantity, quantityAspectRatio, quantityImageBoxes } from '../public/js/features/stories/quantity-offer.js';
import { createStoriesEditorState } from '../public/js/features/stories/state.js';
import { getArtworkFormat } from '../public/js/features/stories/formats.js';
import { createAutoLayout } from '../public/js/features/stories/auto-layout.js';
import { compositionTargets } from '../public/js/features/stories/composition.js';
import * as constants from '../public/js/features/stories/constants.js';

const source = await readFile(new URL('../public/js/features/stories/editor.js', import.meta.url), 'utf8');
function loadFunctions(sandbox, names) {
  for (const name of names) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    vm.runInContext(source.slice(start, source.indexOf('\nfunction ', start + 1)), sandbox);
  }
}

function fixture(formatName, quantity = 1) {
  const format = getArtworkFormat(formatName);
  const state = createStoriesEditorState();
  Object.assign(state, {
    offerQuantity: quantity, price: '19,90', selectedProduct: { nome: 'Produto de teste', subtitulo: 'Embalagem 500 ml' },
    productImage: { naturalWidth: 400, naturalHeight: 700 },
    productTransform: { x: 100, y: 400, width: 800 },
    detailsTransform: { x: 100, y: 800, width: 800 }, backgroundImage: {},
  });
  const painted = { images: [], texts: [] };
  const context = {
    font: '20px Arial',
    measureText(text) { return { width: String(text).length * Number(this.font.match(/([\d.]+)px/)?.[1] || 20) * .55 }; },
    fillText(text) { painted.texts.push(text); },
    drawImage(image, x, y, width, height) {
      if (!image.isGroupCanvas) painted.images.push({ image, x, y, width, height });
    },
    save() {}, restore() {}, fill() {}, beginPath() {}, roundRect() {},
    moveTo() {}, lineTo() {}, quadraticCurveTo() {}, arcTo() {}, closePath() {},
    setTransform() {}, clearRect() {},
  };
  const sandbox = vm.createContext({
    ...constants, state, formatName, format, STORY_WIDTH: format.width, STORY_HEIGHT: format.height,
    normalizeOfferQuantity, offerQuantity, quantityAspectRatio, quantityImageBoxes,
    document: { createElement: () => ({ isGroupCanvas: true, getContext: () => ({ ...context, globalCompositeOperation: 'source-over' }) }) },
    productTargets: () => compositionTargets(state.compositionMode),
    detailTargets: () => compositionTargets(state.compositionMode, 'details'),
    extraSlot: () => null, isMultiProductMode: () => false,
    isTwoProductsMode: () => state.compositionMode === 'two-products',
    getDetailsProducts: target => [target === 'details-secondary' ? state.secondaryProduct : state.selectedProduct].filter(Boolean),
    getDetailsProduct: target => target === 'details-secondary' ? state.secondaryProduct : state.selectedProduct,
    getDetailsMeasureContext: () => context,
    getFreeTextBox: () => null, drawImageCover() {},
    createExportCanvas: () => ({ canvas: {}, context }),
    finishGesture() {}, syncPriceInputs() {}, syncProductEditor() {},
    schedulePreview() {}, updateAvailability() {}, setStatus() {},
    resetProductTransform() {}, resetDetailsTransform() {}, applyAutoLayout() {},
  });
  loadFunctions(sandbox, ['clamp', 'parsePrice', 'hasPrice', 'getPriceForDetailsTarget', 'getProductImage',
    'getProductTransform', 'getProductAspectRatio', 'getProductBox', 'getDetailsTransform',
    'getOfferTitle', 'getOfferSupportingText', 'wrapText', 'getDetailsTextMetrics', 'getDetailsPriceMetrics',
    'getDetailsLayout', 'getDetailsBox', 'drawRoundedRect', 'drawProductImage', 'drawDetailsCard',
    'drawProductCopies', 'getCompositionLayers', 'drawComposition', 'captureVideoSnapshot', 'setOfferQuantity']);
  return { sandbox, state, context, painted, format };
}

test('quantity input is bounded to whole units, with unit offers as the default', () => {
  for (const value of [undefined, null, '', 0, -2, 'bad', Infinity]) assert.equal(normalizeOfferQuantity(value), 1);
  assert.equal(normalizeOfferQuantity('3'), 3);
  assert.equal(normalizeOfferQuantity(2.5), 2);
  assert.equal(normalizeOfferQuantity(1000000), 99);
  assert.equal(offerQuantity(createStoriesEditorState(), 'stories'), 1);
});

test('copies overlap back to front without distortion and stay inside their group', () => {
  for (let quantity = 1; quantity <= 99; quantity++) {
    for (const imageRatio of [.2, 1, 3]) {
      const bounds = { x: 25, y: 50, width: 800, height: 800 / quantityAspectRatio(imageRatio, quantity) };
      const copies = quantityImageBoxes(bounds, quantity);
      assert.equal(copies.length, quantity);
      for (const [index, copy] of copies.entries()) {
        assert.ok(Math.abs(copy.width / copy.height - imageRatio) < .00001);
        assert.ok(copy.x >= bounds.x && copy.y >= bounds.y);
        assert.ok(copy.x + copy.width <= bounds.x + bounds.width + .001);
        assert.ok(copy.y + copy.height <= bounds.y + bounds.height + .001);
        const next = copies[index + 1];
        if (next) {
          assert.ok(next.x < copy.x && next.y > copy.y, 'front copy moves down and left');
          assert.ok(next.x + next.width > copy.x && copy.y + copy.height > next.y, 'adjacent units overlap');
        }
      }
      assert.equal(copies.at(-1).x, bounds.x, 'foreground product is painted last at the left edge');
      assert.equal(copies[0].y, bounds.y, 'rear product starts at the top edge');
    }
  }
});

for (const formatName of ['feed', 'stories']) {
  for (const quantity of [1, 2, 3, 5, 12, 99]) {
    test(`${formatName}: ${quantity} units paint the same images and total in preview, PNG composition and video snapshot`, () => {
      const { sandbox: f, state, context, painted, format } = fixture(formatName, quantity);
      const layout = createAutoLayout({
        format, mode: 'single', products: [{ target: 'product', aspectRatio: f.getProductAspectRatio() }],
        measureDetails: (target, width) => {
          const card = f.getDetailsLayout({ x: 0, y: 0, width }, target);
          return { width: card.descriptionWidth, height: card.cardHeight };
        },
      });
      assert.ok(layout, 'the group and its offer fit in the artwork');
      state.productTransform = layout.products.product;
      state.detailsTransform = layout.details.details;
      const priceLabel = quantity > 1 ? `${quantity} por R$` : 'R$';
      for (const render of [() => f.drawComposition(context), () => f.captureVideoSnapshot([])]) {
        painted.images.length = 0; painted.texts.length = 0;
        render();
        assert.equal(painted.images.length, quantity);
        assert.ok(painted.images.every(copy => copy.image === state.productImage));
        assert.ok(painted.texts.includes(priceLabel));
        assert.ok(painted.texts.includes('19,90'), 'the price is the total entered, without multiplication');
        if (quantity > 1) assert.ok(painted.texts.join(' ').includes(`${quantity} unidades pelo preço anunciado`));
        else assert.ok(!painted.texts.join(' ').includes('unidades pelo preço anunciado'));
      }
    });
  }

  test(`${formatName}: changing quantity clears only that offer's price and supports returning to one unit`, () => {
    const { sandbox: f, state } = fixture(formatName);
    state.compositionMode = 'two-products';
    state.secondaryPrice = '29,90';
    f.setOfferQuantity(2);
    assert.equal(state.offerQuantity, 2);
    assert.equal(state.price, '');
    assert.equal(state.secondaryPrice, '29,90');
    state.price = '17,50';
    f.setOfferQuantity(2);
    assert.equal(state.price, '17,50', 'normalizing the same quantity preserves the entered total');
    f.setOfferQuantity(3, 'product-secondary');
    assert.equal(state.secondaryOfferQuantity, 3);
    assert.equal(state.secondaryPrice, '');
    assert.equal(state.price, '17,50');
    f.setOfferQuantity(1);
    assert.equal(f.getDetailsPriceMetrics(800, 180).currencyLabel, 'R$');
    assert.equal(state.price, '');
  });
}

test('combo and Encarte keep the existing single-copy rendering and price semantics', () => {
  for (const [formatName, mode] of [['feed', 'combo'], ['stories', 'combo'], ['encarte', 'single']]) {
    const { sandbox: f, state } = fixture(formatName, 3);
    state.compositionMode = mode;
    f.setOfferQuantity(4);
    assert.equal(offerQuantity(state, formatName), 1);
    assert.equal(state.price, '19,90');
    assert.equal(f.getDetailsPriceMetrics(800, 180).currencyLabel, 'R$');
  }
});
