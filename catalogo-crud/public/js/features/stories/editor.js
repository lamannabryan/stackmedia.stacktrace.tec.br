import { COMPOSITION_COUNTS, compositionModes, compositionTargets, compositionCell } from './composition.js';
import {
  DEFAULT_FREE_TEXT_WIDTH,
  DESCRIPTION_CARD_PADDING,
  FREE_TEXT_LETTER_SPACING_RATIO,
  MIN_DETAILS_WIDTH,
  MIN_FREE_TEXT_WIDTH,
  MIN_PRODUCT_WIDTH,
  PRODUCT_PAGE_SIZE,
} from './constants.js';
import { getArtworkFormat } from './formats.js';
import { otherArtworkFormat, convertArtworkTransforms, findConvertedBackground } from './format-conversion.js';
import { getStoriesEditorElements } from './dom.js';
import { createStoriesEditorState } from './state.js';
import { createAutoLayout } from './auto-layout.js';
import { bindPriceInput, suggestedMagazinePrice } from './price-input.js';
import { normalizeOfferQuantity, offerQuantity, quantityAspectRatio, quantityImageBoxes } from './quantity-offer.js';
import { drawStoryVideoFrame } from './video-animation.js';
import { resolveMagazineBackground } from '../magazines/background.js';
import { selectedProductIds, loadSelectedProducts } from '../magazines/selection.js';
import { getEncarteItemBounds, drawEncarteItemSurface } from './encarte-items.js';
import { initStoriesMobileEditor } from './mobile-editor.js';

let formatName = document.body.dataset.artworkFormat || 'stories';
let format = getArtworkFormat(formatName);
let {
  width: STORY_WIDTH, height: STORY_HEIGHT, safeTop: STORY_SAFE_TOP, safeBottom: STORY_SAFE_BOTTOM,
  productArea: DEFAULT_PRODUCT_AREA, twoProductAreas: DEFAULT_TWO_PRODUCT_AREAS,
  detailsWidth: DEFAULT_DETAILS_WIDTH,
} = format;
const state = createStoriesEditorState(format.maxProducts || 2);
const elements = getStoriesEditorElements();

let searchTimer;
let detailsMeasureContext;
let videoDownloadUrl;
let mobileEditor;
let artworkReady = false;
let previewTask = null;
let formatConverting = false;
let productSelectionRequest = null;

let COMPOSITION_MODES = new Set(compositionModes(formatName));
const extraControls = new Map();
function productTargets() { return compositionTargets(state.compositionMode); }
function detailTargets() { return compositionTargets(state.compositionMode, 'details'); }
function extraSlot(target) { return typeof target === 'string' ? state.extraProducts[Number(target.split('-').at(-1)) - 3] : undefined; }
function selectedProducts() { return [state.selectedProduct, state.secondaryProduct, ...state.extraProducts.map(slot => slot.product)].slice(0, getCompositionProductLimit()); }
function isMultiProductMode() { return getCompositionProductLimit() > 2; }
function allImagesReady() { return selectedProducts().every((product, i) => product && getProductImage(productTargets()[i]) && (i < 2 ? (i ? state.secondaryProductImageUrl : state.productImageUrl) : state.extraProducts[i - 2].imageUrl) === product.imagem_local_url); }


function createElement(tagName, className, textContent) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (textContent !== undefined && textContent !== null) element.textContent = textContent;
  return element;
}

async function requestJson(url, { signal, cache } = {}) {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal, cache });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar os dados.');
  return payload;
}

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle('is-error', isError);
  mobileEditor?.sync();
}

function setPanelCollapsed({ section, content, toggle, selection, name, isComplete, summary }, collapsed) {
  if (!section || !content || !toggle) return;
  // Mobile dialogs keep their shared controls expanded while they are open.
  if (document.body.classList.contains('is-mobile-editor')) collapsed = false;

  const complete = isComplete();
  const restoreFocus = collapsed && content.contains(document.activeElement);
  section.classList.toggle('is-collapsed', collapsed);
  section.classList.toggle('is-complete', complete);
  content.hidden = collapsed;
  toggle.setAttribute('aria-expanded', String(!collapsed));
  toggle.setAttribute('aria-label', `${collapsed ? 'Expandir' : 'Recolher'} ${name}${complete ? ', etapa concluída' : ''}`);
  const icon = toggle.querySelector('i');
  icon?.classList.toggle('fa-chevron-down', collapsed);
  icon?.classList.toggle('fa-chevron-up', !collapsed);

  if (selection) {
    selection.hidden = !collapsed;
    selection.textContent = `${complete ? 'Concluído · ' : ''}${summary()}`;
  }
  if (restoreFocus) toggle.focus({ preventScroll: true });
}

function togglePanel(panel) {
  const collapsed = !panel.section.classList.contains('is-collapsed');
  setPanelCollapsed(panel, collapsed);
}

function compositionLabel(value) {
  return {
    single: '1 produto',
    'two-products': '2 produtos',
    combo: 'Combo',
  }[normalizeCompositionMode(value)] || `${COMPOSITION_COUNTS[normalizeCompositionMode(value)]} produtos`;
}

const compositionPanel = Object.freeze({
  name: 'composição',
  isComplete: () => state.compositionChosen,
  summary: () => state.compositionChosen ? compositionLabel(state.compositionMode) : 'Escolha uma composição',
  section: elements.compositionSection,
  content: elements.compositionContent,
  toggle: elements.compositionToggle,
  selection: elements.compositionSelection,
});

const backgroundPanel = Object.freeze({
  name: 'fundo da arte',
  isComplete: () => state.backgroundChosen && Boolean(state.selectedBackground),
  summary: () => state.backgroundChosen ? state.selectedBackground?.nome || 'Fundo selecionado' : 'Escolha um fundo',
  section: elements.backgroundSection,
  content: elements.backgroundContent,
  toggle: elements.backgroundToggle,
  selection: elements.backgroundSelection,
});

const productPanel = Object.freeze({
  name: 'produto',
  isComplete: () => selectedProducts().every(Boolean),
  summary: () => productPanel.isComplete()
    ? selectedProducts().filter(Boolean).map((product) => product.nome).join(' + ')
    : getCompositionSelectionProgress(),
  section: elements.productSection,
  content: elements.productContent,
  toggle: elements.productToggle,
  selection: elements.productSelectionSummary,
});

function syncProductPanel({ collapseWhenComplete = false } = {}) {
  const collapsed = productPanel.isComplete()
    && (collapseWhenComplete || productPanel.section?.classList.contains('is-collapsed'));
  setPanelCollapsed(productPanel, collapsed);
  [
    [elements.removeProduct, state.selectedProduct, '1'],
    [elements.removeSecondaryProduct, state.secondaryProduct, '2'],
  ].forEach(([button, product, number]) => {
    button.disabled = !product;
    button.title = product ? `Remover produto ${number}: ${product.nome}` : `Nenhum produto ${number} selecionado`;
  });
  elements.removeAllProducts.disabled = !state.selectedProduct && !state.secondaryProduct;
}

function setProductRemovalStatus(message = '') {
  elements.productRemovalStatus.textContent = message;
  elements.productRemovalStatus.hidden = !message;
}

function parsePrice(value) {
  const cleanValue = String(value || '').trim().replace(/^R\$\s*/i, '').replace(/\s+/g, '');
  if (!cleanValue) return null;

  const numericValue = cleanValue
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  const amount = Number(numericValue);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function getPriceForDetailsTarget(target = 'details') {
  if (extraSlot(target)) return extraSlot(target).price;
  return target === 'details-secondary' ? state.secondaryPrice : state.price;
}

function hasPrice(target = 'details') {
  return parsePrice(getPriceForDetailsTarget(target)) !== null;
}

function normalizeCompositionMode(value) {
  if (value === 'two') return 'two-products';
  return COMPOSITION_MODES.has(value) ? value : 'single';
}

function isTwoProductsMode() {
  return state.compositionMode === 'two-products' || isMultiProductMode();
}

function isComboMode() {
  return state.compositionMode === 'combo';
}

function compositionRequiresSecondaryProduct() {
  return isTwoProductsMode() || isComboMode();
}

function getCompositionProductLimit() {
  return COMPOSITION_COUNTS[state.compositionMode] || 1;
}

function getDetailsProduct(target = 'details') {
  if (extraSlot(target)) return extraSlot(target).product;
  return target === 'details-secondary' ? state.secondaryProduct : state.selectedProduct;
}

function getDetailsProducts(target = 'details') {
  const product = getDetailsProduct(target);
  if (!product) return [];

  return target === 'details' && isComboMode()
    ? [state.selectedProduct, state.secondaryProduct].filter(Boolean)
    : [product];
}

function updateAvailability() {
  syncAutoLayoutAvailability();
  const secondaryProductReady = !compositionRequiresSecondaryProduct()
    || Boolean(
      state.secondaryProduct
        && state.secondaryProductImage
        && state.secondaryProductImageUrl === state.secondaryProduct.imagem_local_url
        && state.secondaryProductTransform,
    );
  const detailsReady = Boolean(
    state.detailsTransform
      && (!isTwoProductsMode() || state.secondaryDetailsTransform),
  );
  const pricesReady = detailTargets().every(target => hasPrice(target));
  const ready = Boolean(
    !productSelectionRequest
      && state.selectedBackground
      && state.selectedProduct
      && state.backgroundImage
      && state.backgroundImageUrl === state.selectedBackground.url
      && state.productImage
      && state.productImageUrl === state.selectedProduct.imagem_local_url
      && state.productTransform
      && detailsReady
      && secondaryProductReady
      && pricesReady && allImagesReady() && detailTargets().every(target => getDetailsTransform(target)),
  );
  const exporting = state.pngExporting || Boolean(state.videoExportController);
  artworkReady = ready;
  elements.download.disabled = !ready || exporting || formatConverting;
  elements.downloadVideo.disabled = !ready || exporting || formatConverting;
  if (elements.convertFormat) {
    elements.convertFormat.disabled = exporting || formatConverting || isMultiProductMode() || !state.selectedProduct
      || !state.productTransform || state.productImageUrl !== state.selectedProduct.imagem_local_url
      || !state.backgroundImage || state.backgroundImageUrl !== state.selectedBackground?.url;
    elements.convertFormat.title = isMultiProductMode()
      ? 'O Feed aceita até 2 produtos. Escolha uma composição de 1 ou 2 produtos para converter.' : '';
  }

  if (!state.selectedBackground) {
    setStatus('Carregando backgrounds disponíveis...');
  } else if (!state.backgroundImage || state.backgroundImageUrl !== state.selectedBackground.url) {
    setStatus('Carregando o fundo da arte...');
  } else if (!state.selectedProduct) {
    setStatus('Escolha um produto com imagem para começar a composição.');
  } else if (!state.selectedProduct.imagem_local_url) {
    setStatus('Este produto ainda não possui uma imagem disponível para a arte.', true);
  } else if (!state.productImage || state.productImageUrl !== state.selectedProduct.imagem_local_url) {
    setStatus('Carregando a imagem do produto...');
  } else if (compositionRequiresSecondaryProduct() && !state.secondaryProduct) {
    setStatus('Selecione o segundo produto para completar esta composição.');
  } else if (!secondaryProductReady) {
    setStatus('Carregando o segundo produto...');
  } else if (!selectedProducts().every(Boolean)) {
    setStatus(getCompositionSelectionProgress());
  } else if (!allImagesReady()) {
    setStatus('Carregando as imagens dos produtos?');
  } else if (!detailsReady) {
    setStatus('Preparando as descrições da oferta...');
  } else if (!hasPrice()) {
    setStatus('Informe o preço para finalizar a arte.');
  } else if (isTwoProductsMode() && !hasPrice('details-secondary')) {
    setStatus('Informe o preço do segundo produto para finalizar a arte.');
  } else if (!pricesReady) {
    setStatus('Informe o pre?o de todos os produtos para finalizar a arte.');
  } else {
    setStatus('Arte pronta. Baixe em PNG ou em MP4 animado de 15 segundos.');
  }
}

function loadImage(source) {
  if (!source) return Promise.reject(new Error('Imagem indisponível.'));
  if (state.imageCache.has(source)) return state.imageCache.get(source);

  const promise = new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    const timeout = setTimeout(() => finish(new Error('O carregamento da imagem demorou demais. Selecione o fundo novamente.')), 20000);
    function finish(error) {
      clearTimeout(timeout);
      image.onload = image.onerror = null;
      if (error) {
        image.src = '';
        reject(error);
      } else resolve(image);
    }
    image.onload = () => finish();
    image.onerror = () => finish(new Error('Não foi possível carregar uma imagem da arte.'));
    image.src = source;
  });

  state.imageCache.set(source, promise);
  promise.catch(() => {
    if (state.imageCache.get(source) === promise) state.imageCache.delete(source);
  });
  // Avoid retaining every decoded product/background for the whole editing session.
  if (state.imageCache.size > 8) state.imageCache.delete(state.imageCache.keys().next().value);
  return promise;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function getDetailsMeasureContext() {
  if (!detailsMeasureContext) {
    const measureCanvas = document.createElement('canvas');
    detailsMeasureContext = measureCanvas.getContext('2d');
  }
  return detailsMeasureContext;
}

function getProductImage(target = 'product') {
  if (extraSlot(target)) return extraSlot(target).image;
  return target === 'product-secondary' ? state.secondaryProductImage : state.productImage;
}

function getProductTransform(target = 'product') {
  if (extraSlot(target)) return extraSlot(target).productTransform;
  return target === 'product-secondary' ? state.secondaryProductTransform : state.productTransform;
}

function setProductTransform(target, transform) {
  if (extraSlot(target)) { extraSlot(target).productTransform = transform; return; }
  if (target === 'product-secondary') state.secondaryProductTransform = transform;
  else state.productTransform = transform;
}

function getDefaultProductWidth(target = 'product') {
  if (extraSlot(target)) return extraSlot(target).defaultProductWidth;
  return target === 'product-secondary'
    ? state.defaultSecondaryProductWidth
    : state.defaultProductWidth;
}

function setDefaultProductWidth(target, width) {
  if (extraSlot(target)) { extraSlot(target).defaultProductWidth = width; return; }
  if (target === 'product-secondary') state.defaultSecondaryProductWidth = width;
  else state.defaultProductWidth = width;
}

function getProductAspectRatio(target = 'product') {
  const productImage = getProductImage(target);
  if (!productImage) return 1;
  return quantityAspectRatio(productImage.naturalWidth / productImage.naturalHeight, offerQuantity(state, formatName, target));
}

function getProductWidthLimits(target = 'product') {
  const ratio = getProductAspectRatio(target);
  const absoluteMaximum = Math.min(STORY_WIDTH, (STORY_HEIGHT - STORY_SAFE_TOP - STORY_SAFE_BOTTOM) * ratio);
  return {
    // Automatic fitting may need a narrower image for very tall packaging.
    minimum: Math.min(MIN_PRODUCT_WIDTH, getDefaultProductWidth(target) || MIN_PRODUCT_WIDTH, absoluteMaximum),
    maximum: absoluteMaximum,
  };
}

function getProductBox(transform, target = 'product') {
  const productTransform = transform ?? getProductTransform(target);
  if (!productTransform || !getProductImage(target)) return null;
  return {
    x: productTransform.x,
    y: productTransform.y,
    width: productTransform.width,
    height: productTransform.width / getProductAspectRatio(target),
  };
}

function clampProductTransform(transform, target = 'product') {
  if (!getProductImage(target)) return null;

  const { minimum, maximum } = getProductWidthLimits(target);
  const width = clamp(transform.width, minimum, maximum);
  const height = width / getProductAspectRatio(target);
  return {
    x: clamp(transform.x, 0, STORY_WIDTH - width),
    y: clamp(transform.y, STORY_SAFE_TOP, STORY_HEIGHT - STORY_SAFE_BOTTOM - height),
    width,
  };
}

function getDetailsTransform(target = 'details') {
  if (extraSlot(target)) return extraSlot(target).detailsTransform;
  return target === 'details-secondary'
    ? state.secondaryDetailsTransform
    : state.detailsTransform;
}

function setDetailsTransform(target, transform) {
  if (extraSlot(target)) { extraSlot(target).detailsTransform = transform; return; }
  if (target === 'details-secondary') state.secondaryDetailsTransform = transform;
  else state.detailsTransform = transform;
}

function getDefaultDetailsWidth(target = 'details') {
  if (extraSlot(target)) return extraSlot(target).defaultDetailsWidth;
  return target === 'details-secondary'
    ? state.defaultSecondaryDetailsWidth
    : state.defaultDetailsWidth;
}

function setDefaultDetailsWidth(target, width) {
  if (extraSlot(target)) { extraSlot(target).defaultDetailsWidth = width; return; }
  if (target === 'details-secondary') state.defaultSecondaryDetailsWidth = width;
  else state.defaultDetailsWidth = width;
}

function getOfferTitle(target = 'details') {
  return getDetailsProducts(target)
    .map((product) => product.nome)
    .filter(Boolean)
    .join(' + ');
}

function getOfferSupportingText(target = 'details') {
  const quantity = offerQuantity(state, formatName, target);
  const productDescriptions = getDetailsProducts(target)
    .map((product) => product.subtitulo || product.fabricante)
    .filter(Boolean);
  const description = productDescriptions.join(' + ') || 'Produto selecionado';
  return quantity > 1 ? `${description} • ${quantity} unidades pelo preço anunciado` : description;
}

function getDetailsTextMetrics(
  availableWidth,
  cardPadding,
  nameFontSize,
  subtitleFontSize,
  target = 'details',
) {
  const measureContext = getDetailsMeasureContext();
  const textWidth = availableWidth - (cardPadding * 2);
  const productName = getOfferTitle(target);

  measureContext.font = `800 ${nameFontSize}px Arial, sans-serif`;
  const titleLines = productName ? wrapText(measureContext, productName, textWidth) : [''];
  if (isMultiProductMode()) truncateLines(titleLines, 2, measureContext, textWidth);
  const titleWidth = Math.max(0, ...titleLines.map((line) => measureContext.measureText(line).width));

  const supportingText = getOfferSupportingText(target);
  measureContext.font = `700 ${subtitleFontSize}px Arial, sans-serif`;
  const supportingLines = wrapText(measureContext, supportingText, textWidth);
  if (isMultiProductMode()) truncateLines(supportingLines, 1, measureContext, textWidth);
  const supportingWidth = Math.max(
    0,
    ...supportingLines.map((line) => measureContext.measureText(line).width),
  );

  return {
    titleLines,
    titleWidth,
    supportingLines,
    supportingWidth,
  };
}

function getDetailsPriceMetrics(availableWidth, priceHeight, target = 'details') {
  const quantity = offerQuantity(state, formatName, target);
  const currencyLabel = quantity > 1 ? `${quantity} por R$` : 'R$';
  const displayedPrice = hasPrice(target) ? getPriceForDetailsTarget(target) : '—';
  const currencyFontSize = priceHeight * (quantity > 1 ? 0.22 : 0.3);
  let priceFontSize = priceHeight * 0.56;
  const horizontalPadding = priceHeight * 0.3;
  const contentGap = priceHeight * 0.12;

  const measureContext = getDetailsMeasureContext();
  measureContext.font = `800 ${currencyFontSize}px Arial, sans-serif`;
  const currencyWidth = measureContext.measureText(currencyLabel).width;
  measureContext.font = `900 ${priceFontSize}px Arial, sans-serif`;
  let priceWidth = measureContext.measureText(displayedPrice).width;
  const maxPriceWidth = Math.max(
    1,
    availableWidth - (horizontalPadding * 2) - currencyWidth - contentGap,
  );

  if (priceWidth > maxPriceWidth) {
    priceFontSize *= maxPriceWidth / priceWidth;
    measureContext.font = `900 ${priceFontSize}px Arial, sans-serif`;
    priceWidth = measureContext.measureText(displayedPrice).width;
  }

  return {
    displayedPrice,
    currencyLabel,
    currencyFontSize,
    priceFontSize,
    horizontalPadding,
    contentGap,
    currencyWidth,
    priceWidth,
    badgeWidth: Math.min(
      availableWidth,
      (horizontalPadding * 2) + currencyWidth + contentGap + priceWidth,
    ),
  };
}

function getDetailsLayout(transform, target = 'details') {
  transform = transform ?? getDetailsTransform(target);
  if (!transform) return null;

  const includesPrice = detailTargets().includes(target);
  const compact = isMultiProductMode();
  const availableWidth = clamp(transform.width, MIN_DETAILS_WIDTH, STORY_WIDTH - 48);
  const cardPadding = isMultiProductMode() ? 12 : DESCRIPTION_CARD_PADDING;
  const nameFontSize = compact
    ? clamp(availableWidth * 0.078, 25, 68)
    : clamp(availableWidth * 0.062, 20, 68);
  const lineHeight = nameFontSize * 1.1;
  const subtitleFontSize = clamp(availableWidth * 0.042, 14, 42);
  const subtitleLineHeight = subtitleFontSize * 1.22;
  const basePriceHeight = clamp(availableWidth * 0.18, isMultiProductMode() ? 38 : 64, 176);
  const priceHeight = includesPrice ? basePriceHeight * (compact ? 1.4 : 1.3) : 0;
  const priceGap = includesPrice ? (compact ? 0 : clamp(availableWidth * 0.045, 16, 42)) : 0;
  const detailGap = clamp(availableWidth * 0.012, 5, 12);
  const textMetrics = getDetailsTextMetrics(
    availableWidth,
    cardPadding,
    nameFontSize,
    subtitleFontSize,
    target,
  );
  const priceMetrics = includesPrice
    ? getDetailsPriceMetrics(availableWidth, priceHeight, target)
    : {
      displayedPrice: '',
      currencyFontSize: 0,
      priceFontSize: 0,
      horizontalPadding: 0,
      contentGap: 0,
      currencyWidth: 0,
      priceWidth: 0,
      badgeWidth: 0,
    };
  const titleLineCount = compact ? 2 : Math.max(1, textMetrics.titleLines.length);
  const supportingLineCount = Math.max(1, textMetrics.supportingLines.length);
  const descriptionHeight = cardPadding
    + nameFontSize
    + ((titleLineCount - 1) * lineHeight)
    + (compact ? 0 : detailGap + subtitleFontSize + ((supportingLineCount - 1) * subtitleLineHeight))
    + cardPadding;
  const descriptionWidth = compact ? availableWidth : Math.min(
    availableWidth,
    Math.max(
      textMetrics.titleWidth + (cardPadding * 2),
      textMetrics.supportingWidth + (cardPadding * 2),
      // Preserve the description's existing width when enlarging the price.
      includesPrice ? getDetailsPriceMetrics(availableWidth, basePriceHeight, target).badgeWidth : 0,
    ),
  );
  const descriptionX = transform.x + ((availableWidth - descriptionWidth) / 2);
  const cardHeight = descriptionHeight + priceGap + priceHeight;
  const priceY = includesPrice ? transform.y + descriptionHeight + priceGap : null;

  return {
    compact,
    x: transform.x,
    y: transform.y,
    target,
    includesPrice,
    width: availableWidth,
    availableWidth,
    cardHeight,
    descriptionHeight,
    descriptionWidth,
    descriptionX,
    cardPadding,
    nameFontSize,
    lineHeight,
    subtitleFontSize,
    subtitleLineHeight,
    detailGap,
    titleLineCount,
    titleLines: textMetrics.titleLines,
    supportingLines: compact ? [] : textMetrics.supportingLines,
    priceHeight,
    priceY,
    badgeX: includesPrice
      ? descriptionX + ((descriptionWidth - priceMetrics.badgeWidth) / 2)
      : null,
    ...priceMetrics,
  };
}

function getDetailsBox(transform, target = 'details') {
  const layout = getDetailsLayout(transform ?? getDetailsTransform(target), target);
  if (!layout) return null;
  return {
    x: layout.descriptionX,
    y: layout.y,
    width: layout.descriptionWidth,
    height: layout.cardHeight,
  };
}

function getDetailsWidthLimits() {
  return { minimum: MIN_DETAILS_WIDTH, maximum: STORY_WIDTH - 48 };
}

function clampDetailsTransform(transform, target = 'details') {
  const { minimum, maximum } = getDetailsWidthLimits();
  const width = clamp(transform.width, minimum, maximum);
  const layout = getDetailsLayout({ x: 0, y: 0, width }, target);
  const horizontalInset = (layout.width - layout.descriptionWidth) / 2;
  return {
    x: clamp(
      transform.x,
      -horizontalInset,
      STORY_WIDTH - layout.descriptionWidth - horizontalInset,
    ),
    y: clamp(transform.y, STORY_SAFE_TOP, STORY_HEIGHT - STORY_SAFE_BOTTOM - layout.cardHeight),
    width,
  };
}

function getDetailsTransformFromVisualBox(box, width, target = 'details') {
  const layout = getDetailsLayout({ x: 0, y: 0, width }, target);
  const horizontalInset = (layout.width - layout.descriptionWidth) / 2;
  return clampDetailsTransform({
    x: box.x - horizontalInset,
    y: box.y,
    width,
  }, target);
}

function getFreeTextWidthLimits() {
  return { minimum: MIN_FREE_TEXT_WIDTH, maximum: STORY_WIDTH - 48 };
}

function getTrackedTextWidth(context, text, letterSpacing) {
  const characterCount = Array.from(text).length;
  return context.measureText(text).width + Math.max(0, characterCount - 1) * letterSpacing;
}

function wrapTrackedText(context, text, maxWidth, letterSpacing) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';

  words.forEach((word) => {
    const candidate = line ? line + ' ' + word : word;
    if (!line || getTrackedTextWidth(context, candidate, letterSpacing) <= maxWidth) {
      line = candidate;
      return;
    }
    lines.push(line);
    line = word;
  });

  if (line) lines.push(line);
  return lines;
}

function getFreeTextLayout(transform = state.freeTextTransform) {
  const text = state.freeText.trim().toUpperCase();
  if (!transform || !text) return null;

  const { minimum, maximum } = getFreeTextWidthLimits();
  const width = clamp(transform.width, minimum, maximum);
  const fontSize = clamp(width * 0.12, 40, 116);
  const lineHeight = fontSize * 0.92;
  const letterSpacing = fontSize * FREE_TEXT_LETTER_SPACING_RATIO;
  const measureContext = getDetailsMeasureContext();
  measureContext.font = 'italic 700 ' + fontSize + 'px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
  const lines = wrapTrackedText(measureContext, text, width, letterSpacing);
  const textWidth = Math.max(
    1,
    ...lines.map((line) => getTrackedTextWidth(measureContext, line, letterSpacing)),
  );

  return {
    x: transform.x,
    y: transform.y,
    width,
    height: Math.max(fontSize, lines.length * lineHeight),
    fontSize,
    lineHeight,
    letterSpacing,
    textWidth,
    lines,
  };
}

function getFreeTextBox(transform = state.freeTextTransform) {
  const layout = getFreeTextLayout(transform);
  if (!layout) return null;
  return {
    x: layout.x,
    y: layout.y,
    width: layout.width,
    height: layout.height,
  };
}

function clampFreeTextTransform(transform) {
  if (!state.freeText.trim()) return null;
  const { minimum, maximum } = getFreeTextWidthLimits();
  const width = clamp(transform.width, minimum, maximum);
  const layout = getFreeTextLayout({ x: 0, y: 0, width });
  return {
    x: clamp(transform.x, 0, STORY_WIDTH - layout.width),
    y: clamp(transform.y, STORY_SAFE_TOP, STORY_HEIGHT - STORY_SAFE_BOTTOM - layout.height),
    width,
  };
}

function makeDefaultFreeTextTransform() {
  if (!state.freeText.trim()) return null;
  const { minimum, maximum } = getFreeTextWidthLimits();
  const width = clamp(DEFAULT_FREE_TEXT_WIDTH, minimum, maximum);
  const layout = getFreeTextLayout({ x: 0, y: 0, width });
  return clampFreeTextTransform({
    x: (STORY_WIDTH - layout.width) / 2,
    y: STORY_SAFE_TOP + 68,
    width,
  });
}

function resetFreeTextTransform() {
  state.freeTextTransform = makeDefaultFreeTextTransform();
  state.defaultFreeTextWidth = state.freeTextTransform?.width || null;
  syncProductEditor();
  schedulePreview();
}

function setFreeTextWidth(width, centerX, centerY) {
  if (!state.freeTextTransform || !state.freeText.trim()) return;
  const currentBox = getFreeTextBox();
  const nextCenterX = centerX ?? currentBox.x + (currentBox.width / 2);
  const nextCenterY = centerY ?? currentBox.y + (currentBox.height / 2);
  const nextLayout = getFreeTextLayout({ x: 0, y: 0, width });
  state.freeTextTransform = clampFreeTextTransform({
    x: nextCenterX - (nextLayout.width / 2),
    y: nextCenterY - (nextLayout.height / 2),
    width,
  });
}

function getDefaultProductArea(target = 'product') {
  if (isMultiProductMode()) {
    const cell = compositionCell(format, getCompositionProductLimit(), productTargets().indexOf(target));
    const card = getDetailsLayout({ x: 0, y: 0, width: cell.width }, target.replace('product', 'details'));
    return { ...cell, height: Math.max(48, cell.height - card.cardHeight - 32) };
  }
  return state.secondaryProductImage
    ? DEFAULT_TWO_PRODUCT_AREAS[target]
    : DEFAULT_PRODUCT_AREA;
}

function getAllProductBoxes() {
  return productTargets()
    .map((target) => getProductBox(undefined, target))
    .filter(Boolean);
}

function makeDefaultProductTransform(target = 'product') {
  if (!getProductImage(target)) return null;

  const area = getDefaultProductArea(target);
  const ratio = getProductAspectRatio(target);
  const { minimum, maximum } = getProductWidthLimits(target);
  const width = clamp(
    Math.min(area.width, area.height * ratio),
    isMultiProductMode() ? Math.min(minimum, area.width, area.height * ratio) : minimum,
    maximum,
  );
  if (isMultiProductMode()) setDefaultProductWidth(target, width);
  const height = width / ratio;
  return clampProductTransform({
    x: area.x + (area.width - width) / 2,
    y: area.y + (area.height - height) / 2,
    width,
  }, target);
}

function makeDefaultDetailsTransform(target = 'details') {
  if (isMultiProductMode()) {
    const cell = compositionCell(format, getCompositionProductLimit(), detailTargets().indexOf(target));
    const card = getDetailsLayout({ x: 0, y: 0, width: cell.width }, target);
    return { x: cell.x, y: cell.y + cell.height - card.cardHeight, width: cell.width };
  }
  const { minimum, maximum } = getDetailsWidthLimits();
  if (isTwoProductsMode()) {
    const productTarget = target === 'details-secondary' ? 'product-secondary' : 'product';
    const productBox = getProductBox(undefined, productTarget);
    const productArea = DEFAULT_TWO_PRODUCT_AREAS[productTarget] || DEFAULT_PRODUCT_AREA;
    const width = clamp(Math.min(440, productArea.width), minimum, maximum);
    const provisionalLayout = getDetailsLayout({ x: 0, y: 0, width }, target);
    const centerX = productBox
      ? productBox.x + (productBox.width / 2)
      : productArea.x + (productArea.width / 2);
    const productBottom = productBox
      ? productBox.y + productBox.height
      : productArea.y + productArea.height;
    const desiredY = Math.max(format.detailsTop, productBottom + 48);
    return getDetailsTransformFromVisualBox({
      x: centerX - (provisionalLayout.descriptionWidth / 2),
      y: Math.min(desiredY, STORY_HEIGHT - provisionalLayout.cardHeight - 56),
    }, width, target);
  }

  const width = clamp(DEFAULT_DETAILS_WIDTH, minimum, maximum);
  const productBottom = Math.max(
    0,
    ...getAllProductBoxes().map((productBox) => productBox.y + productBox.height),
  );
  const provisionalLayout = getDetailsLayout({ x: 0, y: 0, width }, target);
  const desiredY = Math.max(format.detailsTop, productBottom + 64);
  return getDetailsTransformFromVisualBox({
    x: (STORY_WIDTH - provisionalLayout.descriptionWidth) / 2,
    y: Math.min(desiredY, STORY_HEIGHT - provisionalLayout.cardHeight - 56),
  }, width, target);
}

function resetProductTransform(target = 'product') {
  const productTransform = makeDefaultProductTransform(target);
  setProductTransform(target, productTransform);
  setDefaultProductWidth(target, productTransform?.width || null);
  syncProductEditor();
  schedulePreview();
}

function resetDetailsTransform(target = 'details') {
  const detailsTransform = makeDefaultDetailsTransform(target);
  setDetailsTransform(target, detailsTransform);
  setDefaultDetailsWidth(target, detailsTransform?.width || null);
  syncProductEditor();
  schedulePreview();
}

function syncAutoLayoutAvailability() {
  let reason = '';
  if (!state.selectedProduct) {
    reason = 'Selecione um produto para ajustar a arte.';
  } else if (compositionRequiresSecondaryProduct() && !state.secondaryProduct) {
    reason = 'Selecione os dois produtos para ajustar esta composição.';
  } else if (!state.backgroundImage || state.backgroundImageUrl !== state.selectedBackground?.url
    || !state.productImage || state.productImageUrl !== state.selectedProduct.imagem_local_url
    || (compositionRequiresSecondaryProduct() && (!state.secondaryProductImage
      || state.secondaryProductImageUrl !== state.secondaryProduct.imagem_local_url))) {
    reason = 'Aguarde o carregamento das imagens para ajustar a arte.';
  }
  if (isMultiProductMode() && (!selectedProducts().every(Boolean) || !allImagesReady())) reason = 'Selecione todos os produtos e aguarde as imagens.';
  const wasDisabled = elements.autoLayout.disabled;
  elements.autoLayout.disabled = Boolean(reason);
  elements.autoLayout.title = `Ajuste automático: próximo alinhamento ${state.autoLayoutOrientation === 'vertical' ? 'horizontal' : 'vertical'}`;
  if (reason || wasDisabled) {
    elements.autoLayoutStatus.textContent = reason || 'Organiza produto e oferta. Clique novamente para alternar entre vertical e horizontal.';
    elements.autoLayoutStatus.classList.remove('is-error');
  }
  return !reason;
}

function applyAutoLayout({ toggle = true, allowPartial = false } = {}) {
  if (!allowPartial && !syncAutoLayoutAvailability()) return;
  finishGesture();
  const targets = productTargets();
  const freeText = getFreeTextLayout();
  // Tracked text can paint beyond its logical box when a word is very long.
  const textWidth = freeText ? Math.max(freeText.width, freeText.textWidth) : 0;
  const orientation = toggle
    ? (state.autoLayoutOrientation === 'vertical' ? 'horizontal' : 'vertical')
    : (state.autoLayoutOrientation || 'vertical');
  const layout = createAutoLayout({
    format,
    orientation,
    mode: state.compositionMode,
    products: targets.map((target) => ({ target, aspectRatio: getProductImage(target) ? getProductAspectRatio(target) : 2 / 3 })),
    measureDetails: (target, width) => {
      const card = getDetailsLayout({ x: 0, y: 0, width }, target);
      return { width: card.descriptionWidth, height: card.cardHeight };
    },
    freeTextBox: freeText ? {
      x: freeText.x + (freeText.width - textWidth) / 2,
      y: freeText.y,
      width: textWidth,
      height: freeText.height,
    } : null,
  });
  if (!layout) {
    elements.autoLayoutStatus.textContent = freeText
      ? 'Não há espaço suficiente. Reduza ou mova o texto livre e tente novamente.'
      : 'Os textos desta composição ocupam a área disponível. Revise as descrições dos produtos e tente novamente.';
    elements.autoLayoutStatus.classList.add('is-error');
    return;
  }

  // Commit only the complete, measured layout. Linked elements and the export
  // use these same transforms, while each size control starts at the new 100%.
  for (const [target, transform] of Object.entries(layout.products)) {
    if (!getProductImage(target)) continue;
    setDefaultProductWidth(target, transform.width);
    setProductTransform(target, clampProductTransform(transform, target));
  }
  for (const [target, transform] of Object.entries(layout.details)) {
    if (!getDetailsProduct(target)) continue;
    setDefaultDetailsWidth(target, transform.width);
    setDetailsTransform(target, clampDetailsTransform(transform, target));
  }
  if (!isTwoProductsMode()) {
    state.secondaryDetailsTransform = null;
    state.defaultSecondaryDetailsWidth = null;
  }
  state.autoLayoutOrientation = orientation;
  state.itemAreas = layout.itemAreas || {};
  state.activeEditor = null;
  syncProductEditor();
  schedulePreview();
  updateAvailability();
  const nextOrientation = orientation === 'vertical' ? 'horizontal' : 'vertical';
  const message = `Ajuste ${orientation} aplicado. Clique novamente para organizar na ${nextOrientation}.`;
  elements.autoLayout.title = `Ajuste automático: próximo alinhamento ${nextOrientation}`;
  elements.autoLayoutStatus.textContent = message;
  elements.autoLayoutStatus.classList.remove('is-error');
  setStatus(message);
  return true;
}

function setConversionNotice(message, isError = false) {
  const dismiss = createElement('button', 'story-conversion-dismiss', '×');
  dismiss.type = 'button';
  dismiss.setAttribute('aria-label', 'Fechar aviso de conversão');
  dismiss.addEventListener('click', () => { elements.conversionStatus.hidden = true; });
  elements.conversionStatus.replaceChildren(createElement('span', null, message), dismiss);
  elements.conversionStatus.hidden = false;
  elements.conversionStatus.classList.toggle('is-error', isError);
}

function syncArtworkFormat() {
  const feed = formatName === 'feed';
  const encarte = formatName === 'encarte';
  const label = encarte ? 'Encarte' : feed ? 'Feed' : 'Stories';
  const dimensions = `${STORY_WIDTH} × ${STORY_HEIGHT}`;
  document.body.dataset.artworkFormat = formatName;
  document.body.dataset.tourPage = formatName;
  document.body.classList.toggle('feed-page', feed);
  document.body.classList.toggle('encarte-page', encarte);
  document.body.style.setProperty('--artwork-aspect-ratio', STORY_WIDTH + ' / ' + STORY_HEIGHT);
  document.body.style.setProperty('--artwork-width-ratio', STORY_WIDTH / STORY_HEIGHT);
  COMPOSITION_MODES = new Set(compositionModes(formatName));
  for (const input of elements.compositionModes) {
    input.disabled = !COMPOSITION_MODES.has(input.value);
    input.closest('label').hidden = input.disabled;
  }
  document.title = 'StackMedia';
  elements.canvas.width = STORY_WIDTH;
  elements.canvas.height = STORY_HEIGHT;
  elements.canvas.setAttribute('aria-label', `Prévia editável da arte para ${label}`);
  const badge = document.querySelector('.stories-format');
  if (badge) {
    badge.textContent = `${label} · ${dimensions}`;
    badge.setAttribute('aria-label', `${label}, ${STORY_WIDTH} por ${STORY_HEIGHT} pixels`);
  }
  const heading = document.querySelector('.story-mobile-context h1');
  const ratio = document.querySelector('.story-mobile-context > span');
  if (heading) heading.textContent = label;
  if (ratio) ratio.textContent = encarte ? '3:4 · Vertical' : `${feed ? '4:5' : '9:16'} · Vertical`;
  const intro = document.querySelector('.story-mobile-export-intro p');
  if (intro) intro.textContent = `Baixe a imagem em PNG ou o vídeo animado de 15 segundos em MP4. ${label} vertical ${dimensions}.`;
  if (elements.convertFormatLabel) elements.convertFormatLabel.textContent = `Converter para ${otherArtworkFormat(formatName) === 'stories' ? 'Stories' : 'Feed'}`;
}

async function convertCurrentArtwork() {
  if (!elements.convertFormat || elements.convertFormat.disabled || formatConverting) return;
  const targetName = otherArtworkFormat(formatName);
  const targetFormat = getArtworkFormat(targetName);
  const label = targetName === 'feed' ? 'Feed' : 'Stories';
  const workspace = document.querySelector('.stories-shell');
  const wasInert = workspace?.inert;
  formatConverting = true;
  finishGesture();
  if (workspace) workspace.inert = true;
  elements.convertFormat.setAttribute('aria-busy', 'true');
  elements.convertFormatLabel.textContent = 'Convertendo…';
  setConversionNotice(`Preparando a versão para ${label}…`);
  updateAvailability();
  try {
    // Finish pending decodes and prepare the target background before changing the artwork.
    if (previewTask) await previewTask;
    const response = await requestJson(targetFormat.backgroundsUrl);
    if (!Array.isArray(response.items)) throw new Error('Não foi possível carregar os fundos do novo formato.');
    const backgrounds = response.items.map(item => ({ ...item, url: item.preview_url || item.url }));
    const equivalent = findConvertedBackground(state.selectedBackground, backgrounds);
    const background = equivalent || state.selectedBackground;
    const image = await loadImage(background.url);
    const transforms = convertArtworkTransforms({
      productTransform: state.productTransform, secondaryProductTransform: state.secondaryProductTransform,
      detailsTransform: state.detailsTransform, secondaryDetailsTransform: state.secondaryDetailsTransform,
      freeTextTransform: state.freeTextTransform,
    }, formatName, targetName);

    const extraTransforms = state.extraProducts.map(slot => convertArtworkTransforms({ productTransform: slot.productTransform, detailsTransform: slot.detailsTransform }, formatName, targetName));
    formatName = targetName;
    format = targetFormat;
    ({ width: STORY_WIDTH, height: STORY_HEIGHT, safeTop: STORY_SAFE_TOP, safeBottom: STORY_SAFE_BOTTOM,
      productArea: DEFAULT_PRODUCT_AREA, twoProductAreas: DEFAULT_TWO_PRODUCT_AREAS,
      detailsWidth: DEFAULT_DETAILS_WIDTH } = format);
    Object.assign(state, transforms);
    state.extraProducts.forEach((slot, index) => Object.assign(slot, extraTransforms[index]));
    state.backgrounds = equivalent ? backgrounds : [background, ...backgrounds];
    state.selectedBackground = background;
    state.backgroundImage = image;
    state.backgroundImageUrl = background.url;
    state.backgroundBadgeTheme = getBackgroundBadgeTheme(image);
    state.backgroundRequest = Promise.resolve(state.backgrounds);
    state.activeEditor = null;
    for (const target of productTargets()) {
      const transform = getProductTransform(target);
      if (transform) {
        setDefaultProductWidth(target, transform.width);
        setProductTransform(target, clampProductTransform(transform, target));
      }
    }
    for (const target of detailTargets()) {
      const transform = getDetailsTransform(target);
      if (transform) {
        setDefaultDetailsWidth(target, transform.width);
        setDetailsTransform(target, clampDetailsTransform(transform, target));
      }
    }
    if (state.freeTextTransform) {
      state.freeTextTransform = clampFreeTextTransform(state.freeTextTransform);
      state.defaultFreeTextWidth = state.freeTextTransform.width;
    }
    if (videoDownloadUrl) URL.revokeObjectURL(videoDownloadUrl);
    videoDownloadUrl = null;
    elements.videoDownloadLink.hidden = true;
    elements.videoDownloadLink.removeAttribute('href');
    elements.videoExportPanel.hidden = true;
    if (isMultiProductMode() && allImagesReady()) applyAutoLayout();
    syncArtworkFormat();
    renderBackgrounds();
    setPanelCollapsed(backgroundPanel, backgroundPanel.section.classList.contains('is-collapsed'));
    const arranged = applyAutoLayout({ toggle: false });
    drawPreviewNow();
    const url = new URL(window.location.href);
    url.pathname = `/artes/${formatName}`;
    window.history.replaceState(window.history.state, '', url);
    document.dispatchEvent(new CustomEvent('artwork:format-change'));
    setConversionNotice(`Arte convertida para ${label} (${STORY_WIDTH} × ${STORY_HEIGHT}). Produtos, preços e texto mantidos.`
      + (!equivalent ? ' O fundo original foi recortado para caber; revise-o ou escolha outro fundo.' : '')
      + (!arranged ? ' Revise a posição dos elementos na prévia.' : ''));
  } catch (error) {
    setConversionNotice(`Não foi possível converter a arte. ${error.message} Tente novamente.`, true);
  } finally {
    formatConverting = false;
    if (workspace) workspace.inert = wasInert;
    elements.convertFormat.removeAttribute('aria-busy');
    elements.convertFormatLabel.textContent = `Converter para ${formatName === 'feed' ? 'Stories' : 'Feed'}`;
    updateAvailability();
  }
}

function setProductWidth(width, centerX, centerY, target = 'product') {
  if (!getProductTransform(target) || !getProductImage(target)) return;
  const currentBox = getProductBox(undefined, target);
  const nextCenterX = centerX ?? currentBox.x + currentBox.width / 2;
  const nextCenterY = centerY ?? currentBox.y + currentBox.height / 2;
  const height = width / getProductAspectRatio(target);
  setProductTransform(target, clampProductTransform({
    x: nextCenterX - width / 2,
    y: nextCenterY - height / 2,
    width,
  }, target));
}

function setDetailsWidth(width, centerX, centerY, target = 'details') {
  const detailsTransform = getDetailsTransform(target);
  if (!detailsTransform) return;
  const currentBox = getDetailsBox(undefined, target);
  const nextCenterX = centerX ?? currentBox.x + currentBox.width / 2;
  const nextCenterY = centerY ?? currentBox.y + currentBox.height / 2;
  const nextLayout = getDetailsLayout({ x: 0, y: 0, width }, target);
  setDetailsTransform(target, getDetailsTransformFromVisualBox({
    x: nextCenterX - (nextLayout.descriptionWidth / 2),
    y: nextCenterY - (nextLayout.cardHeight / 2),
  }, width, target));
}

function drawRoundedRect(context, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
}

function drawImageCover(context, image, x, y, width, height) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawnWidth = image.naturalWidth * scale;
  const drawnHeight = image.naturalHeight * scale;
  context.drawImage(image, x + (width - drawnWidth) / 2, y + (height - drawnHeight) / 2, drawnWidth, drawnHeight);
}

function getBackgroundBadgeTheme(image) {
  const fallback = { fill: '#0e746c', text: '#ffffff' };
  if (!image) return fallback;

  try {
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = 72;
    sampleCanvas.height = 128;
    const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true });
    drawImageCover(sampleContext, image, 0, 0, sampleCanvas.width, sampleCanvas.height);
    const { data } = sampleContext.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height);
    const colors = new Map();

    for (let index = 0; index < data.length; index += 16) {
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const alpha = data[index + 3];
      if (alpha < 200) continue;

      const maximum = Math.max(red, green, blue);
      const minimum = Math.min(red, green, blue);
      const saturation = maximum === 0 ? 0 : (maximum - minimum) / maximum;
      const luminance = (red * 0.299) + (green * 0.587) + (blue * 0.114);
      if (saturation < 0.08 && luminance > 238) continue;

      const bucketRed = Math.round(red / 24) * 24;
      const bucketGreen = Math.round(green / 24) * 24;
      const bucketBlue = Math.round(blue / 24) * 24;
      const key = `${bucketRed},${bucketGreen},${bucketBlue}`;
      const weight = 1 + (saturation * 2) + (luminance > 36 && luminance < 230 ? 0.45 : 0);
      const entry = colors.get(key) || { red: 0, green: 0, blue: 0, weight: 0 };
      entry.red += red * weight;
      entry.green += green * weight;
      entry.blue += blue * weight;
      entry.weight += weight;
      colors.set(key, entry);
    }

    const dominant = [...colors.values()].sort((left, right) => right.weight - left.weight)[0];
    if (!dominant) return fallback;

    const red = Math.round(dominant.red / dominant.weight);
    const green = Math.round(dominant.green / dominant.weight);
    const blue = Math.round(dominant.blue / dominant.weight);
    const luminance = (red * 0.299) + (green * 0.587) + (blue * 0.114);
    return {
      fill: `rgb(${red}, ${green}, ${blue})`,
      text: luminance > 155 ? '#0b2b33' : '#ffffff',
    };
  } catch {
    return fallback;
  }
}

function wrapText(context, text, maxWidth, maxLines = Infinity) {
  const words = String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((word) => {
      if (context.measureText(word).width <= maxWidth) return [word];

      const fragments = [];
      let fragment = '';
      for (const character of word) {
        const candidate = fragment + character;
        if (fragment && context.measureText(candidate).width > maxWidth) {
          fragments.push(fragment);
          fragment = character;
        } else {
          fragment = candidate;
        }
      }
      if (fragment) fragments.push(fragment);
      return fragments;
    });
  const lines = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
      continue;
    }

    lines.push(line);
    line = word;
    if (Number.isFinite(maxLines) && lines.length === maxLines - 1) break;
  }

  if (line && lines.length < maxLines) lines.push(line);
  if (
    Number.isFinite(maxLines)
    && words.length
    && lines.length === maxLines
    && lines.join(' ') !== words.join(' ')
  ) {
    let lastLine = lines.at(-1);
    while (lastLine.length > 1 && context.measureText(`${lastLine}…`).width > maxWidth) {
      lastLine = lastLine.slice(0, -1).trimEnd();
    }
    lines[lines.length - 1] = `${lastLine}…`;
  }
  return lines;
}

function drawDetailsCard(context, product, price, target = 'details') {
  if (!product?.nome || !getDetailsTransform(target)) return;

  const layout = getDetailsLayout(undefined, target);
  const {
    descriptionX,
    descriptionWidth,
    titleLines: lines,
    supportingLines,
  } = layout;

  if (formatName !== 'encarte') {
    context.save();
    context.shadowColor = 'rgba(7, 49, 48, 0.19)';
    context.shadowBlur = descriptionWidth * 0.045;
    context.shadowOffsetY = descriptionWidth * 0.026;
    context.fillStyle = '#ffffff';
    drawRoundedRect(
      context,
      descriptionX,
      layout.y,
      descriptionWidth,
      layout.compact ? layout.cardHeight : layout.descriptionHeight,
      Math.min(descriptionWidth * 0.055, descriptionWidth * 0.14),
    );
    context.fill();
    context.restore();
  }

  context.save();
  context.fillStyle = '#0b2b33';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = `800 ${layout.nameFontSize}px Arial, sans-serif`;
  const firstLineY = layout.y + layout.cardPadding + (layout.nameFontSize / 2);
  lines.forEach((line, index) => {
    context.fillText(line, descriptionX + (descriptionWidth / 2), firstLineY + (index * layout.lineHeight));
  });

  context.fillStyle = '#5f7379';
  context.font = `700 ${layout.subtitleFontSize}px Arial, sans-serif`;
  const supportingY = firstLineY
    + ((layout.titleLineCount - 1) * layout.lineHeight)
    + (layout.nameFontSize / 2)
    + layout.detailGap
    + (layout.subtitleFontSize / 2);
  supportingLines.forEach((line, index) => {
    context.fillText(
      line,
      descriptionX + (descriptionWidth / 2),
      supportingY + (index * layout.subtitleLineHeight),
    );
  });
  context.restore();

  if (!layout.includesPrice) return;

  const displayedPrice = price || '—';
  const currencyFontSize = layout.currencyFontSize;
  let priceFontSize = layout.priceHeight * 0.56;
  const horizontalPadding = layout.priceHeight * 0.3;
  const contentGap = layout.priceHeight * 0.12;
  const maxBadgeWidth = descriptionWidth;

  context.save();
  context.font = `800 ${currencyFontSize}px Arial, sans-serif`;
  const currencyWidth = context.measureText(layout.currencyLabel).width;
  context.font = `900 ${priceFontSize}px Arial, sans-serif`;
  let priceWidth = context.measureText(displayedPrice).width;
  const maxPriceWidth = maxBadgeWidth - (horizontalPadding * 2) - currencyWidth - contentGap;
  if (priceWidth > maxPriceWidth) {
    priceFontSize *= maxPriceWidth / priceWidth;
    context.font = `900 ${priceFontSize}px Arial, sans-serif`;
    priceWidth = context.measureText(displayedPrice).width;
  }

  const badgeWidth = layout.compact ? descriptionWidth : Math.min(
    maxBadgeWidth,
    (horizontalPadding * 2) + currencyWidth + contentGap + priceWidth,
  );
  const badgeX = descriptionX + ((descriptionWidth - badgeWidth) / 2);
  const badgeTheme = state.backgroundBadgeTheme || { fill: '#0e746c', text: '#ffffff' };
  context.fillStyle = price ? badgeTheme.fill : '#c9d5d2';
  drawRoundedRect(context, badgeX, layout.priceY, badgeWidth, layout.priceHeight, layout.priceHeight * 0.28);
  context.fill();

  context.fillStyle = price ? badgeTheme.text : '#ffffff';
  context.textBaseline = 'middle';
  context.textAlign = 'left';
  context.font = `800 ${currencyFontSize}px Arial, sans-serif`;
  const currencyX = layout.compact
    ? badgeX + (badgeWidth - currencyWidth - contentGap - priceWidth) / 2
    : badgeX + horizontalPadding;
  context.fillText(layout.currencyLabel, currencyX, layout.priceY + (layout.priceHeight / 2));
  context.font = `900 ${priceFontSize}px Arial, sans-serif`;
  context.fillText(
    displayedPrice,
    currencyX + currencyWidth + contentGap,
    layout.priceY + (layout.priceHeight / 2),
  );
  context.restore();
}

function drawFreeText(context) {
  const layout = getFreeTextLayout();
  if (!layout) return;

  context.save();
  context.font = 'italic 700 ' + layout.fontSize + 'px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  context.lineWidth = clamp(layout.fontSize * 0.055, 2, 7);
  context.strokeStyle = 'rgba(8, 43, 50, 0.48)';
  context.fillStyle = (state.backgroundBadgeTheme || { fill: '#0e746c' }).fill;
  context.shadowColor = 'rgba(6, 42, 46, 0.38)';
  context.shadowBlur = layout.fontSize * 0.12;
  context.shadowOffsetY = layout.fontSize * 0.055;

  const centerX = layout.x + (layout.width / 2);
  const firstLineY = layout.y + (layout.fontSize / 2);
  layout.lines.forEach((line, index) => {
    const lineY = firstLineY + (index * layout.lineHeight);
    let characterX = centerX - (getTrackedTextWidth(context, line, layout.letterSpacing) / 2);
    Array.from(line).forEach((character) => {
      context.strokeText(character, characterX, lineY);
      context.fillText(character, characterX, lineY);
      characterX += context.measureText(character).width + layout.letterSpacing;
    });
  });
  context.restore();
}

function drawPlaceholder(context) {
  context.save();
  context.fillStyle = '#e8f0ed';
  context.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT);
  context.fillStyle = '#0b2b33';
  context.font = '800 44px Arial, sans-serif';
  context.textAlign = 'center';
  context.fillText('Carregando background…', STORY_WIDTH / 2, STORY_HEIGHT / 2);
  context.restore();
}

function drawProductImage(context, image, bounds) {
  if (formatName === 'encarte') {
    context.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height);
    return;
  }
  // Use artwork pixels so the shadow scales with the product in preview and exports.
  const size = Math.min(bounds.width, bounds.height);
  const blur = size * 0.025;
  const offset = size * 0.025;
  const color = 'rgba(0, 0, 0, 0.24)';
  context.save();
  if ('filter' in context) {
    context.filter = `drop-shadow(0px ${offset}px ${blur}px ${color})`;
  } else {
    // Canvas shadows also follow image alpha on browsers without Canvas filters.
    context.shadowColor = color;
    context.shadowBlur = blur * 2;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = offset;
  }
  context.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height);
  context.restore();
}

function drawProductCopies(context, image, bounds, quantity) {
  if (quantity === 1) { drawProductImage(context, image, bounds); return; }
  // Compose opaque foreground products before blending the complete group with
  // the artwork, so overlapping packaging does not multiply and darken itself.
  const padding = Math.ceil(Math.min(bounds.width, bounds.height) * 0.1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(bounds.width) + padding * 2;
  canvas.height = Math.ceil(bounds.height) + padding * 2;
  const group = canvas.getContext('2d');
  group.imageSmoothingEnabled = true;
  group.imageSmoothingQuality = 'high';
  quantityImageBoxes({ ...bounds, x: padding, y: padding }, quantity)
    .forEach(copy => drawProductImage(group, image, copy));
  context.drawImage(canvas, bounds.x - padding, bounds.y - padding);
}

function getCompositionLayers() {
  const layers = [];
  productTargets().forEach((target, index) => {
    const productImage = getProductImage(target);
    const bounds = getProductBox(undefined, target);
    if (!productImage || !bounds) return;
    layers.push({
      kind: 'product', index, bounds, compositeOperation: 'multiply',
      draw: (context) => drawProductCopies(context, productImage, bounds, offerQuantity(state, formatName, target)),
    });
  });
  const detailsTargets = detailTargets();
  detailsTargets.forEach((target, index) => {
    const product = getDetailsProduct(target);
    const bounds = getDetailsBox(undefined, target);
    if (!product || !bounds) return;
    layers.push({
      kind: 'details', index, bounds, compositeOperation: 'source-over',
      draw: (context) => drawDetailsCard(context, product, hasPrice(target) ? getPriceForDetailsTarget(target) : '', target),
    });
  });
  if (formatName === 'encarte') {
    const frames = layers.filter(layer => layer.kind === 'product').map(product => {
      const details = layers.find(layer => layer.kind === 'details' && layer.index === product.index);
      const bounds = state.itemAreas?.[productTargets()[product.index]]
        || getEncarteItemBounds(product.bounds, details?.bounds, STORY_WIDTH, STORY_HEIGHT);
      // Image and price share a pivot; the surface stays fixed throughout the video.
      product.animationBounds = bounds;
      if (details) details.animationBounds = bounds;
      const accent = state.backgroundBadgeTheme?.fill || '#0e746c';
      return {
        kind: 'item-surface', index: product.index, bounds, accent, compositeOperation: 'source-over',
        draw: context => drawEncarteItemSurface(context, bounds, accent),
      };
    });
    layers.unshift(...frames);
  }
  const textBounds = getFreeTextBox();
  if (textBounds) {
    layers.push({
      kind: 'text', index: 0, bounds: textBounds, compositeOperation: 'source-over', draw: drawFreeText,
    });
  }
  return layers;
}

function drawComposition(context) {
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, STORY_WIDTH, STORY_HEIGHT);

  if (!state.backgroundImage) {
    drawPlaceholder(context);
    context.restore();
    return;
  }

  drawImageCover(context, state.backgroundImage, 0, 0, STORY_WIDTH, STORY_HEIGHT);

  getCompositionLayers().forEach((layer) => {
    context.save();
    context.globalCompositeOperation = layer.compositeOperation;
    layer.draw(context);
    context.restore();
  });

  context.restore();
}

function drawPreviewNow() {
  const context = elements.canvas.getContext('2d', { alpha: false });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  drawComposition(context);
  syncProductEditor();
}

function schedulePreview() {
  if (state.animationFrame) return;
  state.animationFrame = requestAnimationFrame(() => {
    state.animationFrame = null;
    drawPreviewNow();
  });
}

function setPreviewZoom(value) {
  const minimum = Number(elements.zoom.min) || 70;
  const maximum = Number(elements.zoom.max) || 130;
  const step = Number(elements.zoom.step) || 5;
  const zoom = clamp(Math.round(Number(value) / step) * step, minimum, maximum);

  state.previewZoom = zoom;
  elements.zoom.value = String(zoom);
  elements.zoomOutput.value = `${zoom}%`;
  elements.zoomOutput.textContent = `${zoom}%`;
  elements.canvasWrap.style.setProperty('--story-preview-zoom', String(zoom / 100));
}

function setThirdsGridVisible(visible) {
  state.thirdsGridVisible = visible;
  elements.thirdsGrid.hidden = !visible;
  elements.thirdsGridToggle.classList.toggle('is-active', visible);
  elements.thirdsGridToggle.setAttribute('aria-pressed', String(visible));
  elements.thirdsGridToggle.setAttribute(
    'aria-label',
    visible ? 'Ocultar grade de terços' : 'Mostrar grade de terços',
  );
  elements.thirdsGridToggle.title = visible ? 'Ocultar grade de terços' : 'Mostrar grade de terços';
}

function createSecondaryDetailsSelection() {
  if (elements.secondaryDetailsSelection || !elements.detailsSelection) return;

  const selection = elements.detailsSelection.cloneNode(true);
  selection.id = 'story-secondary-details-selection';
  selection.dataset.editTarget = 'details-secondary';
  selection.hidden = true;
  selection.setAttribute(
    'aria-label',
    'Segunda descrição selecionada. Arraste para mover; arraste os cantos para redimensionar; use as setas do teclado para mover.',
  );
  elements.detailsSelection.after(selection);
  elements.secondaryDetailsSelection = selection;
}

function createSecondaryDetailsPositionControls() {
  if (elements.secondaryDetailsPositionSection || !elements.detailsPositionSection) return;

  const section = elements.detailsPositionSection.cloneNode(true);
  const heading = section.querySelector('.story-section-heading');
  const headingTitle = heading?.querySelector('h2');
  const headingDescription = heading?.querySelector('p');
  const scaleLabel = section.querySelector('label[for="story-details-scale"]');
  const scale = section.querySelector('#story-details-scale');
  const scaleOutput = section.querySelector('#story-details-scale-output');
  const center = section.querySelector('#center-details-button');
  const reset = section.querySelector('#reset-details-button');

  section.id = 'story-secondary-details-position-section';
  section.hidden = true;
  if (headingTitle) headingTitle.textContent = 'Ajuste a segunda descrição';
  if (headingDescription) headingDescription.textContent = 'Arraste ou redimensione a descrição do segundo produto na prévia.';
  if (scaleLabel) scaleLabel.htmlFor = 'story-secondary-details-scale';
  if (scale) scale.id = 'story-secondary-details-scale';
  if (scaleOutput) {
    scaleOutput.id = 'story-secondary-details-scale-output';
    scaleOutput.htmlFor = 'story-secondary-details-scale';
  }
  if (center) {
    center.id = 'center-secondary-details-button';
    center.textContent = 'Centralizar';
  }
  if (reset) {
    reset.id = 'reset-secondary-details-button';
    reset.textContent = 'Redefinir cartão';
  }

  elements.detailsPositionSection.after(section);
  elements.secondaryDetailsPositionSection = section;
  elements.secondaryDetailsScale = scale;
  elements.secondaryDetailsScaleOutput = scaleOutput;
  elements.centerSecondaryDetails = center;
  elements.resetSecondaryDetails = reset;
}

function ensureSecondaryDetailsControls() {
  createSecondaryDetailsSelection();
  createSecondaryDetailsPositionControls();
}

function syncSelection(selection, box, visible, target) {
  if (!selection) return;
  selection.hidden = !visible;
  selection.tabIndex = visible && !isMobilePreviewLocked() ? 0 : -1;
  selection.classList.toggle('is-active', visible && state.activeEditor === target);
  if (!visible) return;

  selection.style.left = `${(box.x / STORY_WIDTH) * 100}%`;
  selection.style.top = `${(box.y / STORY_HEIGHT) * 100}%`;
  selection.style.width = `${(box.width / STORY_WIDTH) * 100}%`;
  selection.style.height = `${(box.height / STORY_HEIGHT) * 100}%`;
}

function syncScaleControl(input, output, box, defaultWidth, limits, currentWidth = box.width) {
  const { minimum, maximum } = limits;
  const minimumPercent = Math.max(1, Math.round((minimum / defaultWidth) * 100));
  const maximumPercent = Math.max(minimumPercent, Math.round((maximum / defaultWidth) * 100));
  const currentPercent = clamp(Math.round((currentWidth / defaultWidth) * 100), minimumPercent, maximumPercent);
  input.min = String(minimumPercent);
  input.max = String(maximumPercent);
  input.value = String(currentPercent);
  output.value = `${currentPercent}%`;
  output.textContent = `${currentPercent}%`;
}

function syncPriceValidation() {
  const priceFields = [
    { input: elements.price, required: true },
    { input: elements.secondaryPrice, required: isTwoProductsMode() },
  ];

  priceFields.forEach(({ input, required }) => {
    const priceInput = input.closest('.story-price-input');
    const missing = required && parsePrice(input.value) === null;
    priceInput?.classList.toggle('is-missing', missing);
    input.setAttribute('aria-invalid', String(missing));
  });
  for (const [target, control] of extraControls) {
    if (!control.price) continue;
    const missing = detailTargets().includes(target) && !hasPrice(target);
    control.price.setAttribute('aria-invalid', String(missing));
    control.price.closest('.story-price-input')?.classList.toggle('is-missing', missing);
  }
}

function setOfferQuantity(value, target = 'product') {
  if (!['feed', 'stories'].includes(formatName) || !['single', 'two-products'].includes(state.compositionMode)) return;
  if (target === 'product-secondary' && !isTwoProductsMode()) return;
  const quantity = normalizeOfferQuantity(value);
  const key = target === 'product-secondary' ? 'secondaryOfferQuantity' : 'offerQuantity';
  if (state[key] === quantity) { syncPriceInputs(); return; }
  finishGesture();
  state[key] = quantity;
  // A unit price must never silently become the price of a bundle (or vice versa).
  state[target === 'product-secondary' ? 'secondaryPrice' : 'price'] = '';
  if (getProductImage(target)) {
    resetProductTransform(target);
    resetDetailsTransform(target === 'product-secondary' ? 'details-secondary' : 'details');
    applyAutoLayout({ toggle: false, allowPartial: true });
  }
  syncProductEditor();
  schedulePreview();
  updateAvailability();
  setStatus(quantity > 1 ? `Informe o preço total de ${quantity} unidades.` : 'Informe o preço de uma unidade.');
}

function syncPriceInputs() {
  const twoProducts = isTwoProductsMode();
  const quantity = offerQuantity(state, formatName);
  const secondaryQuantity = offerQuantity(state, formatName, 'product-secondary');
  elements.primaryPriceLabel.textContent = quantity > 1 ? `Preço total de ${quantity} unidades${twoProducts ? ' do produto 1' : ''}` : (twoProducts ? 'Preço do produto 1' : 'Preço da oferta');
  elements.secondaryPriceField.hidden = false;
  elements.secondaryPriceField.classList.toggle('is-disabled', !twoProducts);
  elements.secondaryPriceField.setAttribute('aria-disabled', String(!twoProducts));
  elements.price.required = true;
  elements.secondaryPrice.disabled = !twoProducts;
  elements.secondaryPrice.required = twoProducts;
  elements.secondaryPriceLabel.textContent = secondaryQuantity > 1 ? `Preço total de ${secondaryQuantity} unidades do produto 2` : 'Preço do produto 2';
  if (elements.offerQuantity) {
    elements.offerQuantity.value = quantity;
    elements.offerQuantity.disabled = state.compositionMode === 'combo';
    elements.secondaryOfferQuantity.value = secondaryQuantity;
    elements.secondaryOfferQuantity.disabled = !twoProducts;
    elements.secondaryOfferQuantity.closest('label').hidden = !twoProducts;
    elements.quantityHint.textContent = state.compositionMode === 'combo'
      ? 'O combo reúne dois produtos diferentes em um preço único. Para anunciar unidades do mesmo produto, escolha 1 produto ou 2 produtos.'
      : 'Use 1 para preço unitário, 2 para “2 por...” ou 3 para “3 por...”. Informe o preço total das unidades (de 1 a 99).';
  }

  if (elements.price.value !== state.price) elements.price.value = state.price;
  if (elements.secondaryPrice.value !== state.secondaryPrice) {
    elements.secondaryPrice.value = state.secondaryPrice;
  }
  syncPriceValidation();
}

function syncProductEditor() {
  syncAutoLayoutAvailability();
  const productBox = getProductBox();
  const secondaryProductBox = getProductBox(undefined, 'product-secondary');
  const detailsBox = getDetailsBox();
  const secondaryDetailsBox = getDetailsBox(undefined, 'details-secondary');
  const freeTextBox = getFreeTextBox();
  const productVisible = Boolean(productBox && state.selectedProduct);
  const secondaryProductVisible = Boolean(secondaryProductBox && state.secondaryProduct);
  const detailsVisible = Boolean(detailsBox && state.selectedProduct);
  const secondaryDetailsVisible = Boolean(
    isTwoProductsMode() && secondaryDetailsBox && state.secondaryProduct,
  );
  const freeTextVisible = Boolean(freeTextBox && state.freeText.trim());
  const anchorVisible = productVisible
    && detailsVisible
    && (!isTwoProductsMode() || (secondaryProductVisible && secondaryDetailsVisible));
  const visibleTargets = [
    ['product', productVisible], ['product-secondary', secondaryProductVisible],
    ['details', detailsVisible], ['details-secondary', secondaryDetailsVisible],
    ['free-text', freeTextVisible],
  ].filter(([, visible]) => visible).map(([target]) => target);
  visibleTargets.push(...syncExtraControls());
  if (!visibleTargets.includes(state.activeEditor)) {
    state.activeEditor = null;
  }
  syncPriceInputs();
  elements.positionSection.hidden = !productVisible;
  elements.secondaryPositionSection.hidden = !secondaryProductVisible;
  elements.detailsPositionSection.hidden = !detailsVisible;
  if (elements.secondaryDetailsPositionSection) {
    elements.secondaryDetailsPositionSection.hidden = !secondaryDetailsVisible;
  }
  elements.freeTextPositionSection.hidden = !freeTextVisible;
  elements.anchorSection.hidden = !anchorVisible;
  elements.anchorToggle.checked = anchorVisible && state.elementsAnchored;
  syncSelection(elements.selection, productBox, productVisible, 'product');
  syncSelection(
    elements.secondarySelection,
    secondaryProductBox,
    secondaryProductVisible,
    'product-secondary',
  );
  syncSelection(elements.detailsSelection, detailsBox, detailsVisible, 'details');
  syncSelection(
    elements.secondaryDetailsSelection,
    secondaryDetailsBox,
    secondaryDetailsVisible,
    'details-secondary',
  );
  syncSelection(elements.freeTextSelection, freeTextBox, freeTextVisible, 'free-text');

  if (productVisible) {
    syncScaleControl(
      elements.scale,
      elements.scaleOutput,
      productBox,
      state.defaultProductWidth || productBox.width,
      getProductWidthLimits('product'),
    );
  }

  if (secondaryProductVisible) {
    syncScaleControl(
      elements.secondaryScale,
      elements.secondaryScaleOutput,
      secondaryProductBox,
      getDefaultProductWidth('product-secondary') || secondaryProductBox.width,
      getProductWidthLimits('product-secondary'),
    );
  }

  if (detailsVisible) {
    syncScaleControl(
      elements.detailsScale,
      elements.detailsScaleOutput,
      detailsBox,
      state.defaultDetailsWidth || state.detailsTransform.width,
      getDetailsWidthLimits(),
      state.detailsTransform.width,
    );
  }

  if (secondaryDetailsVisible && elements.secondaryDetailsScale) {
    syncScaleControl(
      elements.secondaryDetailsScale,
      elements.secondaryDetailsScaleOutput,
      secondaryDetailsBox,
      getDefaultDetailsWidth('details-secondary') || state.secondaryDetailsTransform.width,
      getDetailsWidthLimits(),
      state.secondaryDetailsTransform.width,
    );
  }

  if (freeTextVisible) {
    syncScaleControl(
      elements.freeTextScale,
      elements.freeTextScaleOutput,
      freeTextBox,
      state.defaultFreeTextWidth || state.freeTextTransform.width,
      getFreeTextWidthLimits(),
      state.freeTextTransform.width,
    );
  }
  syncMobileEditControls(visibleTargets);
}

function syncMobileEditControls(visibleTargets) {
  const controls = [
    ['product', elements.positionSection],
    ['product-secondary', elements.secondaryPositionSection],
    ['details', elements.detailsPositionSection],
    ['details-secondary', elements.secondaryDetailsPositionSection],
    ['free-text', elements.freeTextPositionSection],
  ];
  controls.forEach(([target, section]) => {
    section?.classList.toggle('is-mobile-selected-control', state.activeEditor === target);
  });
  elements.mobileEditTargets.forEach((button) => {
    const target = button.dataset.mobileEditTarget;
    button.hidden = !visibleTargets.includes(target);
    button.setAttribute('aria-pressed', String(state.activeEditor === target));
    if (target === 'details') button.textContent = isTwoProductsMode() ? 'Oferta 1' : isComboMode() ? 'Oferta do combo' : 'Oferta';
  });
  const selected = visibleTargets.includes(state.activeEditor);
  [...elements.mobileNudges, elements.mobileCenter, ...elements.mobileScaleSteps].forEach((button) => {
    if (button) button.disabled = !selected;
  });
  if (elements.mobileScaleValue) {
    const value = selected ? `${getScaleInputForEditorTarget(state.activeEditor)?.value || 100}%` : '—';
    elements.mobileScaleValue.value = value;
    elements.mobileScaleValue.textContent = value;
  }
  if (elements.mobileEditHint) {
    elements.mobileEditHint.textContent = selected
      ? 'Toque no elemento. Arraste na prévia ou use os controles abaixo.'
      : 'Adicione um produto para ajustar a arte.';
  }
  mobileEditor?.sync();
}

function getMobileProgress() {
  const background = Boolean(state.backgroundImage && state.backgroundImageUrl === state.selectedBackground?.url);
  const primary = Boolean(state.productImage && state.productImageUrl === state.selectedProduct?.imagem_local_url);
  const secondary = !compositionRequiresSecondaryProduct()
    || Boolean(state.secondaryProductImage && state.secondaryProductImageUrl === state.secondaryProduct?.imagem_local_url);
  return {
    background,
    products: primary && secondary && allImagesReady(),
    offer: detailTargets().every(target => hasPrice(target)),
    ready: artworkReady,
    exporting: state.pngExporting || Boolean(state.videoExportController),
    selection: state.activeEditor,
  };
}

function renderPreview() {
  ++state.previewRequestId;
  updateAvailability();
  // Rapid taps only load the latest selection after the current decode finishes.
  // Ignoring stale results alone still decodes every intermediate full-size image.
  if (!previewTask) {
    previewTask = (async () => {
      let requestId;
      do {
        requestId = state.previewRequestId;
        await renderPreviewOnce(requestId);
      } while (requestId !== state.previewRequestId);
    })().finally(() => { previewTask = null; });
  }
  return previewTask;
}

async function renderPreviewOnce(requestId) {
  syncAutoLayoutAvailability();
  const backgroundUrl = state.selectedBackground?.url || null;
  const productUrl = state.selectedProduct?.imagem_local_url || null;
  const secondaryProductUrl = state.secondaryProduct?.imagem_local_url || null;
  const extraUrls = state.extraProducts.map(slot => slot.product?.imagem_local_url || null);
  updateAvailability();

  if (!backgroundUrl) {
    state.backgroundImage = null;
    state.backgroundImageUrl = null;
    state.backgroundBadgeTheme = null;
    state.productImage = null;
    state.productImageUrl = null;
    state.productTransform = null;
    state.defaultProductWidth = null;
    state.secondaryProductImage = null;
    state.secondaryProductImageUrl = null;
    state.secondaryProductTransform = null;
    state.defaultSecondaryProductWidth = null;
    state.detailsTransform = null;
    state.defaultDetailsWidth = null;
    state.secondaryDetailsTransform = null;
    state.defaultSecondaryDetailsWidth = null;
    state.elementsAnchored = false;
    drawPreviewNow();
    updateAvailability();
    return;
  }

  try {
    const [backgroundImage, productImage, secondaryProductImage, ...extraImages] = await Promise.all([
      loadImage(backgroundUrl),
      productUrl ? loadImage(productUrl) : Promise.resolve(null),
      secondaryProductUrl ? loadImage(secondaryProductUrl) : Promise.resolve(null),
      ...extraUrls.map(url => url ? loadImage(url) : Promise.resolve(null)),
    ]);

    if (requestId !== state.previewRequestId) return;

    const backgroundChanged = backgroundUrl !== state.backgroundImageUrl;
    const productChanged = productUrl !== state.productImageUrl;
    const secondaryProductChanged = secondaryProductUrl !== state.secondaryProductImageUrl;
    state.backgroundImage = backgroundImage;
    state.backgroundImageUrl = backgroundUrl;
    if (backgroundChanged) state.backgroundBadgeTheme = getBackgroundBadgeTheme(backgroundImage);
    state.productImage = productImage;
    state.productImageUrl = productUrl;
    state.secondaryProductImage = secondaryProductImage;
    state.secondaryProductImageUrl = secondaryProductUrl;

    const extraChanged = extraUrls.some((url, index) => url !== state.extraProducts[index].imageUrl);
    state.extraProducts.forEach((slot, index) => { slot.image = extraImages[index]; slot.imageUrl = extraUrls[index]; });
    if (productChanged || secondaryProductChanged || extraChanged) {
      state.productTransform = null;
      state.defaultProductWidth = null;
      state.secondaryProductTransform = null;
      state.defaultSecondaryProductWidth = null;
      state.detailsTransform = null;
      state.defaultDetailsWidth = null;
      state.secondaryDetailsTransform = null;
      state.defaultSecondaryDetailsWidth = null;
      state.elementsAnchored = false;
      if (productImage) {
        resetProductTransform('product');
        if (secondaryProductImage) resetProductTransform('product-secondary');
        resetDetailsTransform();
        if (isTwoProductsMode() && secondaryProductImage) {
          resetDetailsTransform('details-secondary');
        }
      }
    }

    if (isMultiProductMode() && (productChanged || secondaryProductChanged || extraChanged)) {
      for (const target of productTargets()) if (getProductImage(target)) resetProductTransform(target);
      for (const target of detailTargets()) if (getDetailsProduct(target)) resetDetailsTransform(target);
      applyAutoLayout({ toggle: false, allowPartial: true });
    }
    drawPreviewNow();
    updateAvailability();
  } catch (error) {
    if (requestId !== state.previewRequestId) return;
    elements.download.disabled = true;
    elements.downloadVideo.disabled = true;
    setStatus(error.message, true);
  }
}

function renderBackgrounds() {
  const options = state.backgrounds.map((background) => {
    const button = createElement('button', 'story-background-option');
    button.type = 'button';
    button.classList.toggle('is-selected', background.arquivo === state.selectedBackground?.arquivo);
    button.setAttribute('aria-pressed', String(background.arquivo === state.selectedBackground?.arquivo));
    button.setAttribute('aria-label', `Usar background ${background.nome}`);

    const image = new Image();
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.src = background.thumbnail_url || background.url;
    button.append(image, createElement('span', null, background.nome));
    button.addEventListener('click', () => {
      state.selectedBackground = background;
      state.backgroundChosen = true;
      setPanelCollapsed(backgroundPanel, true);
      for (const option of options) {
        option.classList.toggle('is-selected', option === button);
        option.setAttribute('aria-pressed', String(option === button));
      }
      renderPreview();
      mobileEditor?.selectionComplete('background');
    });
    return button;
  });

  elements.backgrounds.replaceChildren(...options);
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim();
}

function getProductSearchScore(product, query) {
  if (!query) return product.produto_destaque ? 0 : 10;

  const normalizedQuery = normalizeSearchText(query);
  const name = normalizeSearchText(product.nome);
  const ean = normalizeSearchText(product.ean);
  const manufacturer = normalizeSearchText(product.fabricante);
  const activeIngredient = normalizeSearchText(product.principio_ativo);
  const subtitle = normalizeSearchText(product.subtitulo);

  if (name === normalizedQuery || ean === normalizedQuery) return 0;
  if (name.startsWith(normalizedQuery)) return 1;
  if (name.includes(normalizedQuery)) return 2;
  if (manufacturer.startsWith(normalizedQuery) || activeIngredient.startsWith(normalizedQuery)) return 3;
  if (manufacturer.includes(normalizedQuery) || activeIngredient.includes(normalizedQuery)) return 4;
  if (subtitle.includes(normalizedQuery)) return 5;
  return 6;
}

function rankStoryProducts(products, query) {
  return [...products].sort((first, second) => {
    const scoreDifference = getProductSearchScore(first, query) - getProductSearchScore(second, query);
    if (scoreDifference !== 0) return scoreDifference;
    return String(first.nome || '').localeCompare(String(second.nome || ''), 'pt-BR');
  });
}

function getProductDescriptor(product) {
  const parts = [product.fabricante, product.subtitulo]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return [...new Set(parts)].join(' · ') || 'Produto disponível';
}

function getCompositionSelectionProgress() {
  const selectedCount = selectedProducts().filter(Boolean).length;
  const requiredCount = getCompositionProductLimit();

  if (requiredCount === 1) {
    return selectedCount ? '1 produto selecionado' : 'Selecione 1 produto';
  }

  return `${Math.min(selectedCount, requiredCount)} de ${requiredCount} produtos selecionados`;
}

function updateProductSearchContext({ loading = false, loadingMore = false } = {}) {
  const query = elements.search.value.trim();
  const compositionProgress = getCompositionSelectionProgress();
  elements.clearSearch.hidden = !query;

  if (loading) {
    elements.productSearchSummary.textContent = `Buscando produtos… · ${compositionProgress}`;
    return;
  }

  if (loadingMore) {
    elements.productSearchSummary.textContent = `Carregando mais produtos… · ${compositionProgress}`;
    return;
  }

  const total = state.productTotal || 0;
  const visible = state.productResults.length;
  if (!query) {
    elements.productSearchSummary.textContent = visible
      ? `Exibindo ${visible} de ${total} produtos · ${compositionProgress}`
      : `Produtos em destaque · ${compositionProgress}`;
    return;
  }

  const resultLabel = total === 1 ? 'produto encontrado' : 'produtos encontrados';
  elements.productSearchSummary.textContent = `${visible} de ${total} ${resultLabel} para “${query}” · ${compositionProgress}`;
}

function clearProductSearch() {
  clearTimeout(searchTimer);
  elements.search.value = '';
  updateProductSearchContext();
  loadProducts();
  elements.search.focus();
}

function queueProductSearch() {
  clearTimeout(searchTimer);
  updateProductSearchContext({ loading: true });
  searchTimer = setTimeout(loadProducts, 180);
}

function syncCompositionModeControls() {
  elements.compositionModes.forEach((input) => {
    input.checked = normalizeCompositionMode(input.value) === state.compositionMode;
  });
}

function setCompositionMode(value) {
  const nextMode = normalizeCompositionMode(value);
  state.compositionChosen = true;
  if (state.compositionMode === nextMode) {
    syncCompositionModeControls();
    setPanelCollapsed(compositionPanel, true);
    return;
  }

  const previousMode = state.compositionMode;
  productSelectionRequest = null;
  setProductRemovalStatus();
  state.compositionMode = nextMode;
  if (nextMode === 'combo' || previousMode === 'combo') {
    state.offerQuantity = 1;
    state.secondaryOfferQuantity = 1;
  }
  // A combo price describes the complete bundle, not either individual item.
  if (nextMode === 'combo') state.price = '';
  else if (previousMode === 'combo') state.price = suggestedMagazinePrice(state.selectedProduct);
  if (getCompositionProductLimit() === 1) {
    state.secondaryProduct = null;
    state.secondaryPrice = '';
    state.secondaryOfferQuantity = 1;
  } else if (isTwoProductsMode() && ['single', 'combo'].includes(previousMode)) {
    state.secondaryPrice = suggestedMagazinePrice(state.secondaryProduct);
  }
  state.extraProducts.forEach((slot, index) => { if (index + 2 >= getCompositionProductLimit()) { slot.product = null; slot.price = ''; } });
  resetProductCompositionState();
  syncCompositionModeControls();
  syncProductPanel();
  renderProducts();
  syncProductEditor();
  renderPreview();
  setPanelCollapsed(compositionPanel, true);
}

function resetProductCompositionState() {
  state.autoLayoutOrientation = null;
  state.itemAreas = {};
  for (const slot of state.extraProducts) Object.assign(slot, { image: null, imageUrl: null, productTransform: null, detailsTransform: null, defaultProductWidth: null, defaultDetailsWidth: null });
  state.productImage = null;
  state.productImageUrl = null;
  state.productTransform = null;
  state.defaultProductWidth = null;
  state.secondaryProductImage = null;
  state.secondaryProductImageUrl = null;
  state.secondaryProductTransform = null;
  state.defaultSecondaryProductWidth = null;
  state.detailsTransform = null;
  state.defaultDetailsWidth = null;
  state.secondaryDetailsTransform = null;
  state.defaultSecondaryDetailsWidth = null;
  state.elementsAnchored = false;
  state.activeEditor = null;
}

function refreshProductSelection({ collapseWhenComplete = false } = {}) {
  syncProductPanel({ collapseWhenComplete });
  resetProductCompositionState();
  renderProducts();
  // Clear obsolete images and disable export immediately, including during image loading.
  drawPreviewNow();
  updateAvailability();
  void renderPreview();
}

function removeProductFromComposition(position) {
  productSelectionRequest = null;
  if (isMultiProductMode()) {
    const entries = selectedProducts().map((product, index) => ({ product, price: getPriceForDetailsTarget(detailTargets()[index]) }));
    if (position === 'all') entries.length = 0;
    else entries.splice(position === 'primary' ? 0 : position === 'secondary' ? 1 : Number(position) - 1, 1);
    state.selectedProduct = entries[0]?.product || null; state.price = entries[0]?.price || '';
    state.secondaryProduct = entries[1]?.product || null; state.secondaryPrice = entries[1]?.price || '';
    state.extraProducts.forEach((slot, index) => { slot.product = entries[index + 2]?.product || null; slot.price = entries[index + 2]?.price || ''; });
    refreshProductSelection();
    setProductRemovalStatus('Seleção atualizada. Os preços acompanham os produtos.');
    return;
  }
  if (position === 'primary' && !state.selectedProduct) return;
  if (position === 'secondary' && !state.secondaryProduct) return;
  if (!state.selectedProduct && !state.secondaryProduct) return;

  const restoreFocus = elements.productContent.contains(document.activeElement);
  let message;
  if (position === 'all') {
    state.selectedProduct = null;
    state.secondaryProduct = null;
    state.price = '';
    state.secondaryPrice = '';
    state.offerQuantity = 1;
    state.secondaryOfferQuantity = 1;
    message = 'Todos os produtos foram removidos da arte.';
  } else if (position === 'primary') {
    const promoted = Boolean(state.secondaryProduct);
    state.selectedProduct = state.secondaryProduct;
    // A combo has one shared price; separate offers keep the remaining product's price.
    state.price = promoted ? (isTwoProductsMode() ? state.secondaryPrice : state.price) : '';
    state.offerQuantity = promoted ? state.secondaryOfferQuantity : 1;
    state.secondaryProduct = null;
    state.secondaryPrice = '';
    state.secondaryOfferQuantity = 1;
    message = promoted
      ? 'Produto 1 removido. O produto 2 agora ocupa a posição 1.'
      : 'Produto 1 removido da arte.';
  } else {
    state.secondaryProduct = null;
    state.secondaryPrice = '';
    state.secondaryOfferQuantity = 1;
    message = 'Produto 2 removido da arte.';
  }

  refreshProductSelection();
  setProductRemovalStatus(message);
  if (restoreFocus) elements.search.focus({ preventScroll: true });
}

function selectProductForComposition(product) {
  if (isMultiProductMode()) {
    const selected = selectedProducts();
    const existing = selected.findIndex(item => item?.id === product.id);
    if (existing >= 0) { removeProductFromComposition(String(existing + 1)); return; }
    const index = selected.findIndex(item => !item);
    if (index < 0) { setStatus('Remova um produto selecionado antes de adicionar outro.'); return; }
    if (index === 0) { state.selectedProduct = product; state.price = suggestedMagazinePrice(product); }
    else if (index === 1) { state.secondaryProduct = product; state.secondaryPrice = suggestedMagazinePrice(product); }
    else { state.extraProducts[index - 2].product = product; state.extraProducts[index - 2].price = suggestedMagazinePrice(product); }
    setProductRemovalStatus();
    refreshProductSelection({ collapseWhenComplete: true });
    mobileEditor?.selectionComplete('products', productPanel.isComplete());
    return;
  }
  if (product.id === state.selectedProduct?.id) {
    removeProductFromComposition('primary');
    return;
  }
  if (product.id === state.secondaryProduct?.id) {
    removeProductFromComposition('secondary');
    return;
  }
  setProductRemovalStatus();
  if (!state.selectedProduct) {
    state.selectedProduct = product;
    state.price = state.compositionMode === 'combo' || offerQuantity(state, formatName) > 1 ? '' : suggestedMagazinePrice(product);
  } else if (getCompositionProductLimit() === 1) {
    state.selectedProduct = product;
    state.price = offerQuantity(state, formatName) > 1 ? '' : suggestedMagazinePrice(product);
  } else {
    state.secondaryProduct = product;
    state.secondaryPrice = isTwoProductsMode() && offerQuantity(state, formatName, 'product-secondary') === 1 ? suggestedMagazinePrice(product) : '';
  }

  refreshProductSelection({ collapseWhenComplete: true });
  mobileEditor?.selectionComplete('products', Boolean(state.selectedProduct
    && (!compositionRequiresSecondaryProduct() || state.secondaryProduct)));
}

function addProductToResults(product) {
  const productsById = new Map(state.productResults.map((item) => [item.id, item]));
  productsById.set(product.id, product);
  state.productResults = rankStoryProducts([...productsById.values()], elements.search.value.trim());
}

async function selectProductFromCatalogue(product) {
  if (productSelectionRequest) return;
  if (selectedProducts().some(item => item?.id === product.id)) {
    selectProductForComposition(product);
    return;
  }
  const request = {};
  productSelectionRequest = request;
  renderProducts();
  updateAvailability();
  setStatus('Carregando produto e preço…');
  try {
    // Reuse the link-selection lookup so an already open catalogue cannot supply an old offer.
    const [currentProduct] = await loadSelectedProducts([product.id], requestJson);
    if (productSelectionRequest !== request) return;
    if (!currentProduct.imagem_local_url) throw new Error('Este produto está sem imagem. Selecione outro produto.');
    addProductToResults(currentProduct);
    productSelectionRequest = null;
    selectProductForComposition(currentProduct);
  } catch (error) {
    if (productSelectionRequest === request) setStatus('Não foi possível carregar o produto e seu preço. Tente novamente.', true);
  } finally {
    if (productSelectionRequest === request) {
      productSelectionRequest = null;
      renderProducts();
      updateAvailability();
    }
  }
}

async function preselectProductFromLocation() {
  const ids = selectedProductIds(window.location.search, format.maxProducts || 2);
  if (!ids.length) return false;

  try {
    const products = await loadSelectedProducts(ids, requestJson);
    const product = products[0];
    state.compositionMode = compositionModes(formatName).find(mode => COMPOSITION_COUNTS[mode] === products.length);
    state.compositionChosen = true;
    syncCompositionModeControls();
    setPanelCollapsed(compositionPanel, true);

    state.selectedProduct = product;
    state.price = suggestedMagazinePrice(product);
    state.secondaryProduct = products[1] || null;
    state.secondaryPrice = suggestedMagazinePrice(state.secondaryProduct);
    state.extraProducts.forEach((slot, index) => {
      slot.product = products[index + 2] || null;
      slot.price = suggestedMagazinePrice(slot.product);
    });
    syncProductPanel({ collapseWhenComplete: true });
    resetProductCompositionState();
    products.forEach(addProductToResults);
    renderProducts();
    if (product.revista_background) {
      try {
        const background = await resolveMagazineBackground(product.revista_background, formatName, state.backgrounds, requestJson);
        if (!background) throw new Error('Fundo indisponível');
        if (!state.backgrounds.some(item => item.url === background.url)) state.backgrounds.unshift(background);
        state.selectedBackground = background;
        state.backgroundChosen = true;
        renderBackgrounds();
        setPanelCollapsed(backgroundPanel, true);
      } catch {
        state.selectedBackground = null;
        state.backgroundChosen = false;
        renderBackgrounds();
        setStatus('Não foi possível carregar o fundo da revista. Escolha um fundo para continuar.', true);
      }
    }
    return true;
  } catch {
    setStatus('Não foi possível carregar os produtos selecionados. Selecione os produtos novamente para continuar.', true);
    return false;
  }
}

function renderProducts() {
  updateProductSearchContext({
    loading: state.productLoading && !state.productResults.length,
    loadingMore: state.productLoading && Boolean(state.productResults.length),
  });
  const query = elements.search.value.trim();
  if (!state.productResults.length) {
    if (state.productLoading) {
      elements.products.replaceChildren(createElement('p', 'story-results-loading', 'Buscando produtos…'));
      return;
    }
    const message = query
      ? `Nenhum produto com imagem encontrado para “${query}”.`
      : 'Nenhum produto com imagem está disponível agora.';
    elements.products.replaceChildren(createElement('p', 'story-results-empty', message));
    return;
  }

  const cards = state.productResults.map((product) => {
    const button = createElement('button', 'story-product-option');
    button.type = 'button';
    const isPrimaryProduct = product.id === state.selectedProduct?.id;
    const isSecondaryProduct = product.id === state.secondaryProduct?.id;
    button.classList.toggle('is-selected', isPrimaryProduct);
    button.classList.toggle('is-secondary-selected', isSecondaryProduct);
    button.setAttribute('aria-pressed', String(isPrimaryProduct || isSecondaryProduct));
    button.setAttribute(
      'aria-label',
      isPrimaryProduct
        ? `${product.nome}, primeiro produto selecionado`
        : isSecondaryProduct
          ? `${product.nome}, segundo produto selecionado`
          : `Adicionar ${product.nome}`,
    );

    const imageWrap = createElement('span', 'story-product-option-image');
    if (product.imagem_local_url) {
      const image = new Image();
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.src = product.imagem_local_url;
      imageWrap.append(image);
    } else {
      imageWrap.append(createElement('span', 'story-product-option-placeholder', 'Sem imagem'));
    }

    const copy = createElement('span', 'story-product-option-copy');
    copy.append(
      createElement('strong', null, product.nome),
      createElement('small', null, getProductDescriptor(product)),
    );

    const selectedIndex = selectedProducts().findIndex(item => item?.id === product.id);
    if (selectedIndex >= 0) {
      button.classList.add('is-selected');
      button.setAttribute('aria-pressed', 'true');
      button.setAttribute('aria-label', `${product.nome}, produto ${selectedIndex + 1} selecionado`);
      copy.append(createElement('small', null, `Produto ${selectedIndex + 1}`));
    }
    button.disabled = Boolean(productSelectionRequest) || (isMultiProductMode() && selectedIndex < 0 && selectedProducts().every(Boolean));
    button.append(imageWrap, copy);
    button.addEventListener('click', () => selectProductFromCatalogue(product));
    return button;
  });

  const progress = createElement('p', 'story-results-progress');
  progress.setAttribute('aria-live', 'polite');
  if (state.productLoading) progress.textContent = 'Carregando mais produtos…';
  else if (state.productHasMore) progress.textContent = 'Role para carregar mais produtos';
  else progress.textContent = 'Todos os produtos foram exibidos';
  elements.products.replaceChildren(...cards, progress);
}

async function loadBackgrounds() {
  if (state.backgroundRequest) return state.backgroundRequest;

  state.backgroundRequest = requestJson(format.backgroundsUrl)
    .then((response) => {
      state.backgrounds = (response.items || []).map((item) => ({ ...item, url: item.preview_url || item.url }));
      state.selectedBackground = state.backgrounds[0] || null;
      renderBackgrounds();
      return state.backgrounds;
    })
    .catch((error) => {
      elements.backgrounds.replaceChildren(createElement('p', 'story-results-empty', error.message));
      setStatus(error.message, true);
      throw error;
    });

  return state.backgroundRequest;
}

async function loadProducts({ append = false } = {}) {
  const query = elements.search.value.trim();
  if (append) {
    if (state.productLoading || !state.productHasMore || state.productQuery !== query) return;
  } else {
    state.productSearchController?.abort();
    state.productPage = 0;
    state.productHasMore = true;
    state.productTotal = 0;
    state.productResults = [];
    state.productQuery = query;
    elements.products.scrollTop = 0;
  }

  const requestId = ++state.productRequestId;
  const controller = new AbortController();
  state.productSearchController = controller;
  const page = append ? state.productPage + 1 : 1;
  const parameters = new URLSearchParams({
    imagem: 'com',
    status: 'ativo',
    page: String(page),
    pageSize: String(PRODUCT_PAGE_SIZE),
  });
  if (query) parameters.set('q', query);

  state.productLoading = true;
  renderProducts();
  try {
    const response = await requestJson(`/api/products?${parameters.toString()}`, { signal: controller.signal });
    if (requestId !== state.productRequestId) return;
    const incomingProducts = response.items || [];
    const productsById = new Map(state.productResults.map((product) => [product.id, product]));
    incomingProducts.forEach((product) => productsById.set(product.id, product));
    state.productTotal = response.pagination?.total || 0;
    state.productPage = response.pagination?.page || page;
    state.productHasMore = state.productPage < (response.pagination?.totalPages || 1);
    state.productResults = rankStoryProducts([...productsById.values()], query);
    state.productLoading = false;
    renderProducts();
  } catch (error) {
    if (requestId !== state.productRequestId) return;
    if (error.name === 'AbortError') return;
    state.productLoading = false;
    if (!append) {
      state.productTotal = 0;
      state.productResults = [];
      updateProductSearchContext();
      elements.products.replaceChildren(createElement('p', 'story-results-empty', error.message));
    } else {
      state.productHasMore = false;
      renderProducts();
    }
  } finally {
    if (state.productSearchController === controller) {
      state.productSearchController = null;
      state.productLoading = false;
    }
  }
}

function loadMoreProductsOnScroll() {
  const remainingScroll = elements.products.scrollHeight
    - elements.products.scrollTop
    - elements.products.clientHeight;
  if (remainingScroll > 120) return;
  loadProducts({ append: true });
}

function artPointFromEvent(event) {
  const rect = elements.interactionLayer.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * STORY_WIDTH,
    y: ((event.clientY - rect.top) / rect.height) * STORY_HEIGHT,
  };
}

function getEditorTransform(target) {
  if (target.startsWith('details')) return getDetailsTransform(target);
  if (target === 'free-text') return state.freeTextTransform;
  return getProductTransform(target);
}

function getEditorBox(target, transform) {
  if (target.startsWith('details')) {
    return getDetailsBox(transform, target);
  }
  if (target === 'free-text') return getFreeTextBox(transform);
  return getProductBox(transform, target);
}

function getEditorWidthLimits(target) {
  if (target.startsWith('details')) return getDetailsWidthLimits();
  if (target === 'free-text') return getFreeTextWidthLimits();
  return getProductWidthLimits(target);
}

function clampEditorTransform(target, transform) {
  if (target.startsWith('details')) {
    return clampDetailsTransform(transform, target);
  }
  if (target === 'free-text') return clampFreeTextTransform(transform);
  return clampProductTransform(transform, target);
}

function setEditorTransform(target, transform) {
  if (target.startsWith('details')) {
    setDetailsTransform(target, transform);
  }
  else if (target === 'free-text') state.freeTextTransform = transform;
  else setProductTransform(target, transform);
}

function getEditorSelection(target) {
  if (extraControls.has(target)) return extraControls.get(target).selection;
  if (target === 'details') return elements.detailsSelection;
  if (target === 'details-secondary') return elements.secondaryDetailsSelection;
  if (target === 'free-text') return elements.freeTextSelection;
  return target === 'product-secondary' ? elements.secondarySelection : elements.selection;
}

function setActiveEditor(target = null) {
  if (state.activeEditor === target) return;
  state.activeEditor = target;
  syncProductEditor();
}

function getAnchoredEditorTargets() {
  const targets = ['product', 'details'];
  if (state.secondaryProductTransform) targets.push('product-secondary');
  if (isTwoProductsMode() && state.secondaryDetailsTransform) {
    targets.push('details-secondary');
  }
  for (const target of [...productTargets(), ...detailTargets()]) if (!targets.includes(target) && getEditorTransform(target)) targets.push(target);
  return targets;
}

function hasAnchoredEditors() {
  return Boolean(
    state.elementsAnchored
      && getAnchoredEditorTargets().every((target) => getEditorTransform(target)),
  );
}

function getClampedEditorMovement(target, transform, horizontal, vertical) {
  const nextTransform = clampEditorTransform(target, {
    x: transform.x + horizontal,
    y: transform.y + vertical,
    width: transform.width,
  });
  return {
    horizontal: nextTransform.x - transform.x,
    vertical: nextTransform.y - transform.y,
  };
}

function getSharedAxisMovement(requestedMovement, movements) {
  if (requestedMovement === 0) return 0;
  return requestedMovement > 0
    ? Math.min(...movements)
    : Math.max(...movements);
}

function moveAnchoredEditorsBy(horizontal, vertical, transforms = {}) {
  const targets = getAnchoredEditorTargets();
  const sourceTransforms = targets.map((target) => ({
    target,
    transform: transforms[target] || getEditorTransform(target),
  }));
  if (sourceTransforms.some(({ transform }) => !transform)) return false;

  const movements = sourceTransforms.map(({ target, transform }) => ({
    target,
    transform,
    movement: getClampedEditorMovement(target, transform, horizontal, vertical),
  }));
  const sharedHorizontal = getSharedAxisMovement(
    horizontal,
    movements.map(({ movement }) => movement.horizontal),
  );
  const sharedVertical = getSharedAxisMovement(
    vertical,
    movements.map(({ movement }) => movement.vertical),
  );

  sourceTransforms.forEach(({ target, transform }) => {
    setEditorTransform(target, clampEditorTransform(target, {
      x: transform.x + sharedHorizontal,
      y: transform.y + sharedVertical,
      width: transform.width,
    }));
  });
  return true;
}

function getDetailsVisualWidthLimits(target = 'details') {
  const { minimum, maximum } = getDetailsWidthLimits();
  const minimumWidth = getDetailsLayout({ x: 0, y: 0, width: minimum }, target).descriptionWidth;
  const maximumWidth = getDetailsLayout({ x: 0, y: 0, width: maximum }, target).descriptionWidth;
  return {
    minimum: Math.min(minimumWidth, maximumWidth),
    maximum: Math.max(minimumWidth, maximumWidth),
  };
}

function getDetailsLogicalWidthForVisualWidth(visualWidth, target = 'details') {
  const { minimum, maximum } = getDetailsWidthLimits();
  const visualLimits = getDetailsVisualWidthLimits(target);
  const targetWidth = clamp(visualWidth, visualLimits.minimum, visualLimits.maximum);
  let lowerWidth = minimum;
  let upperWidth = maximum;

  for (let step = 0; step < 24; step += 1) {
    const middleWidth = (lowerWidth + upperWidth) / 2;
    const middleLayout = getDetailsLayout({ x: 0, y: 0, width: middleWidth }, target);
    if (middleLayout.descriptionWidth < targetWidth) lowerWidth = middleWidth;
    else upperWidth = middleWidth;
  }

  const lowerLayout = getDetailsLayout({ x: 0, y: 0, width: lowerWidth }, target);
  const upperLayout = getDetailsLayout({ x: 0, y: 0, width: upperWidth }, target);
  return Math.abs(lowerLayout.descriptionWidth - targetWidth)
    <= Math.abs(upperLayout.descriptionWidth - targetWidth)
    ? lowerWidth
    : upperWidth;
}

function transformDetailsFromResizeGesture(handle, point, startTransform, target = 'details') {
  const startBox = getDetailsBox(startTransform, target);
  if (!startBox) return startTransform;

  const ratio = startBox.width / startBox.height;
  const corners = {
    nw: { anchorX: startBox.x + startBox.width, anchorY: startBox.y + startBox.height, signX: -1, signY: -1 },
    ne: { anchorX: startBox.x, anchorY: startBox.y + startBox.height, signX: 1, signY: -1 },
    sw: { anchorX: startBox.x + startBox.width, anchorY: startBox.y, signX: -1, signY: 1 },
    se: { anchorX: startBox.x, anchorY: startBox.y, signX: 1, signY: 1 },
  };
  const corner = corners[handle];
  const horizontal = point.x - corner.anchorX;
  const vertical = point.y - corner.anchorY;
  const requestedWidth = (
    (corner.signX * horizontal) + ((corner.signY * vertical) / ratio)
  ) / (1 + (1 / (ratio * ratio)));
  const logicalWidth = getDetailsLogicalWidthForVisualWidth(requestedWidth, target);
  const nextLayout = getDetailsLayout({ x: 0, y: 0, width: logicalWidth }, target);

  return getDetailsTransformFromVisualBox({
    x: corner.signX > 0 ? corner.anchorX : corner.anchorX - nextLayout.descriptionWidth,
    y: corner.signY > 0 ? corner.anchorY : corner.anchorY - nextLayout.cardHeight,
  }, logicalWidth, target);
}

function transformFreeTextFromResizeGesture(handle, point, startTransform) {
  const startBox = getFreeTextBox(startTransform);
  if (!startBox) return startTransform;

  const ratio = startBox.width / startBox.height;
  const corners = {
    nw: { anchorX: startBox.x + startBox.width, anchorY: startBox.y + startBox.height, signX: -1, signY: -1 },
    ne: { anchorX: startBox.x, anchorY: startBox.y + startBox.height, signX: 1, signY: -1 },
    sw: { anchorX: startBox.x + startBox.width, anchorY: startBox.y, signX: -1, signY: 1 },
    se: { anchorX: startBox.x, anchorY: startBox.y, signX: 1, signY: 1 },
  };
  const corner = corners[handle];
  const horizontal = point.x - corner.anchorX;
  const vertical = point.y - corner.anchorY;
  const requestedWidth = (
    (corner.signX * horizontal) + ((corner.signY * vertical) / ratio)
  ) / (1 + (1 / (ratio * ratio)));
  const { minimum, maximum } = getFreeTextWidthLimits();
  const width = clamp(requestedWidth, minimum, maximum);
  const layout = getFreeTextLayout({ x: 0, y: 0, width });

  return clampFreeTextTransform({
    x: corner.signX > 0 ? corner.anchorX : corner.anchorX - layout.width,
    y: corner.signY > 0 ? corner.anchorY : corner.anchorY - layout.height,
    width,
  });
}

function transformFromResizeGesture(target, handle, point, startTransform) {
  if (target.startsWith('details')) {
    return transformDetailsFromResizeGesture(handle, point, startTransform, target);
  }
  if (target === 'free-text') {
    return transformFreeTextFromResizeGesture(handle, point, startTransform);
  }

  const startBox = getEditorBox(target, startTransform);
  const ratio = startBox.width / startBox.height;
  const corners = {
    nw: { anchorX: startBox.x + startBox.width, anchorY: startBox.y + startBox.height, signX: -1, signY: -1 },
    ne: { anchorX: startBox.x, anchorY: startBox.y + startBox.height, signX: 1, signY: -1 },
    sw: { anchorX: startBox.x + startBox.width, anchorY: startBox.y, signX: -1, signY: 1 },
    se: { anchorX: startBox.x, anchorY: startBox.y, signX: 1, signY: 1 },
  };
  const corner = corners[handle];
  const horizontal = point.x - corner.anchorX;
  const vertical = point.y - corner.anchorY;
  const width = (
    (corner.signX * horizontal) + ((corner.signY * vertical) / ratio)
  ) / (1 + (1 / (ratio * ratio)));
  const { minimum, maximum } = getEditorWidthLimits(target);
  const nextWidth = clamp(width, minimum, maximum);
  const nextHeight = nextWidth / ratio;

  return clampEditorTransform(target, {
    x: corner.signX > 0 ? corner.anchorX : corner.anchorX - nextWidth,
    y: corner.signY > 0 ? corner.anchorY : corner.anchorY - nextHeight,
    width: nextWidth,
  });
}

function isMobilePreviewLocked() {
  return document.body.classList.contains('is-mobile-editor') && document.body.classList.contains('story-mobile-modal-open');
}

let mobileCanvasSelection = null;
let lastCanvasTap = null;

function getMobileCanvasTargets(point) {
  // Match paint order, which differs from the order of the transparent DOM overlays.
  return ['free-text', ...detailTargets().reverse(), ...productTargets().reverse()].filter((target) => {
    const selection = getEditorSelection(target);
    const box = getEditorBox(target);
    return selection && !selection.hidden && box
      && point.x >= box.x && point.x <= box.x + box.width
      && point.y >= box.y && point.y <= box.y + box.height;
  });
}

function getResizeStartCorner(target, handle, transform) {
  const box = getEditorBox(target, transform);
  return {
    x: box.x + (handle.includes('e') ? box.width : 0),
    y: box.y + (handle.includes('s') ? box.height : 0),
  };
}

function beginGesture(event) {
  if (event.button !== 0 || state.gesture || event.isPrimary === false) return;
  if (isMobilePreviewLocked()) return;

  const mobile = document.body.classList.contains('is-mobile-editor');
  const handle = event.target.closest('[data-resize-handle]')?.dataset.resizeHandle || null;
  const startPoint = artPointFromEvent(event);
  const candidates = mobile && !handle ? getMobileCanvasTargets(startPoint) : [];
  // Keep a deliberately selected lower layer draggable until the user cycles again.
  const selectedTarget = mobileCanvasSelection === state.activeEditor && candidates.includes(mobileCanvasSelection)
    ? mobileCanvasSelection : candidates[0];
  const target = selectedTarget || event.currentTarget.dataset.editTarget;
  const transform = getEditorTransform(target);
  if (!transform) return;
  setActiveEditor(target);
  if (mobile) mobileCanvasSelection = target;
  else lastCanvasTap = null;
  const linkedStartTransforms = !handle && target !== 'free-text' && hasAnchoredEditors()
    ? Object.fromEntries(
      getAnchoredEditorTargets()
        .filter((editorTarget) => editorTarget !== target)
        .map((editorTarget) => [editorTarget, { ...getEditorTransform(editorTarget) }]),
    )
    : null;
  state.gesture = {
    pointerId: event.pointerId,
    target,
    type: handle ? 'resize' : 'move',
    handle,
    startPoint,
    startTransform: { ...transform },
    linkedStartTransforms,
    mobile,
    candidates,
    startClientPoint: { x: event.clientX, y: event.clientY },
    startedAt: performance.now(),
    moved: false,
    resizeStartCorner: mobile && handle ? getResizeStartCorner(target, handle, transform) : null,
  };
  const selection = getEditorSelection(target);
  selection.setPointerCapture(event.pointerId);
  selection.classList.add('is-dragging');
  selection.focus({ preventScroll: true });
  event.preventDefault();
}

function moveGesture(event) {
  const gesture = state.gesture;
  if (!gesture || gesture.pointerId !== event.pointerId) return;

  let point = artPointFromEvent(event);
  const distance = Math.hypot(event.clientX - gesture.startClientPoint.x, event.clientY - gesture.startClientPoint.y);
  gesture.moved ||= distance >= 5;
  if (gesture.mobile && gesture.type === 'move' && !gesture.moved) {
    event.preventDefault();
    return;
  }
  if (gesture.type === 'move') {
    const horizontal = point.x - gesture.startPoint.x;
    const vertical = point.y - gesture.startPoint.y;
    if (gesture.linkedStartTransforms) {
      moveAnchoredEditorsBy(horizontal, vertical, {
        ...gesture.linkedStartTransforms,
        [gesture.target]: gesture.startTransform,
      });
    } else {
      setEditorTransform(gesture.target, clampEditorTransform(gesture.target, {
        x: gesture.startTransform.x + horizontal,
        y: gesture.startTransform.y + vertical,
        width: gesture.startTransform.width,
      }));
    }
  } else {
    if (gesture.resizeStartCorner) {
      // A finger can land anywhere in the 44px handle. Preserve that grab offset.
      point = {
        x: gesture.resizeStartCorner.x + point.x - gesture.startPoint.x,
        y: gesture.resizeStartCorner.y + point.y - gesture.startPoint.y,
      };
    }
    setEditorTransform(
      gesture.target,
      transformFromResizeGesture(gesture.target, gesture.handle, point, gesture.startTransform),
    );
  }

  schedulePreview();
  event.preventDefault();
}

function finishGesture(event) {
  if (!state.gesture) {
    if (!event) {
      mobileCanvasSelection = null;
      lastCanvasTap = null;
    }
    return;
  }
  if (event && state.gesture.pointerId !== event.pointerId) return;
  const gesture = state.gesture;
  const pointerId = gesture.pointerId;
  const selection = getEditorSelection(gesture.target);
  state.gesture = null;
  selection.classList.remove('is-dragging');
  if (selection.hasPointerCapture(pointerId)) selection.releasePointerCapture(pointerId);
  const tap = gesture.mobile && gesture.type === 'move' && !gesture.moved
    && event?.type === 'pointerup' && performance.now() - gesture.startedAt < 350
    && Math.hypot(event.clientX - gesture.startClientPoint.x, event.clientY - gesture.startClientPoint.y) < 5;
  if (tap) {
    const repeated = lastCanvasTap && performance.now() - lastCanvasTap.time < 800
      && Math.hypot(event.clientX - lastCanvasTap.x, event.clientY - lastCanvasTap.y) < 12;
    if (repeated && gesture.candidates.length > 1) {
      const index = gesture.candidates.indexOf(gesture.target);
      mobileCanvasSelection = gesture.candidates[(index + 1) % gesture.candidates.length];
      setActiveEditor(mobileCanvasSelection);
      getEditorSelection(mobileCanvasSelection)?.focus({ preventScroll: true });
    }
    lastCanvasTap = { x: event.clientX, y: event.clientY, time: performance.now() };
  } else lastCanvasTap = null;
  syncProductEditor();
  updateAvailability();
}

function moveEditorBy(target, horizontal, vertical) {
  const transform = getEditorTransform(target);
  if (!transform) return;
  if (target !== 'free-text' && hasAnchoredEditors()) {
    moveAnchoredEditorsBy(horizontal, vertical);
  } else {
    setEditorTransform(target, clampEditorTransform(target, {
      x: transform.x + horizontal,
      y: transform.y + vertical,
      width: transform.width,
    }));
  }
  schedulePreview();
  updateAvailability();
}

function resizeEditorByPercentage(target, percentage) {
  const transform = getEditorTransform(target);
  const defaultWidth = (target.startsWith('details'))
    ? getDefaultDetailsWidth(target)
    : target === 'free-text'
      ? state.defaultFreeTextWidth
      : getDefaultProductWidth(target);
  if (!transform || !defaultWidth) return;
  const box = getEditorBox(target);
  const nextWidth = (defaultWidth * percentage) / 100;
  if (target.startsWith('details')) {
    setDetailsWidth(nextWidth, box.x + box.width / 2, box.y + box.height / 2, target);
  }
  else if (target === 'free-text') {
    setFreeTextWidth(nextWidth, box.x + box.width / 2, box.y + box.height / 2);
  }
  else setProductWidth(nextWidth, box.x + box.width / 2, box.y + box.height / 2, target);
  syncProductEditor();
  schedulePreview();
}

function centerEditor(target) {
  const box = getEditorBox(target);
  if (!box) return;

  if (target !== 'free-text' && hasAnchoredEditors()) {
    moveAnchoredEditorsBy(
      (STORY_WIDTH / 2) - (box.x + (box.width / 2)),
      (STORY_HEIGHT / 2) - (box.y + (box.height / 2)),
    );
    syncProductEditor();
    schedulePreview();
    return;
  }

  if (target.startsWith('details')) {
    setDetailsWidth(
      getDetailsTransform(target).width,
      STORY_WIDTH / 2,
      STORY_HEIGHT / 2,
      target,
    );
    syncProductEditor();
    schedulePreview();
    return;
  }

  if (target === 'free-text') {
    setFreeTextWidth(state.freeTextTransform.width, STORY_WIDTH / 2, STORY_HEIGHT / 2);
    syncProductEditor();
    schedulePreview();
    return;
  }

  setEditorTransform(target, clampEditorTransform(target, {
    x: (STORY_WIDTH - box.width) / 2,
    y: (STORY_HEIGHT - box.height) / 2,
    width: box.width,
  }));
  syncProductEditor();
  schedulePreview();
}

function updateDownloadLabel(label) {
  if (elements.downloadLabel) elements.downloadLabel.textContent = label;
  else elements.download.textContent = label;
}

function storyDownloadName(productName, extension) {
  const safeName = productName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'produto';
  return `${format.downloadPrefix}-${safeName}.${extension}`;
}

function createExportCanvas(alpha = true) {
  const canvas = document.createElement('canvas');
  canvas.width = STORY_WIDTH;
  canvas.height = STORY_HEIGHT;
  const context = canvas.getContext('2d', { alpha });
  if (!context) throw new Error('Não foi possível preparar a arte para exportação.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  return { canvas, context };
}

function captureVideoSnapshot(canvases) {
  const background = createExportCanvas(false);
  canvases.push(background.canvas);
  drawImageCover(background.context, state.backgroundImage, 0, 0, STORY_WIDTH, STORY_HEIGHT);
  const layers = getCompositionLayers().map(({ draw, ...layer }) => {
    // Surfaces stay vector-based, avoiding an extra full-size canvas per item.
    if (layer.kind === 'item-surface') return layer;
    const { canvas, context } = createExportCanvas();
    canvases.push(canvas);
    // Rasterize synchronously, before awaiting the encoder or allowing edits.
    // Blending is applied when compositing, so white product backgrounds stay transparent visually.
    draw(context);
    return { ...layer, canvas };
  });
  return {
    width: STORY_WIDTH, height: STORY_HEIGHT, background: background.canvas, layers,
    format: formatName, itemCount: layers.filter(layer => layer.kind === 'product').length,
  };
}

async function downloadStoryVideo() {
  if (elements.downloadVideo.disabled) return;

  const controller = new AbortController();
  state.videoExportController = controller;
  updateAvailability();
  elements.downloadVideo.setAttribute('aria-busy', 'true');
  elements.downloadVideoLabel.textContent = 'Preparando MP4…';
  elements.videoExportPanel.hidden = false;
  elements.videoExportPanel.classList.remove('is-error');
  elements.videoExportStatus.textContent = 'Preparando vídeo de 15 segundos…';
  elements.videoProgress.value = 0;
  elements.videoProgress.hidden = false;
  elements.cancelVideo.disabled = false;
  elements.cancelVideo.hidden = false;
  elements.videoDownloadLink.hidden = true;
  elements.videoDownloadLink.removeAttribute('href');
  if (videoDownloadUrl) URL.revokeObjectURL(videoDownloadUrl);
  videoDownloadUrl = null;

  const canvases = [];
  let resultMessage;
  let failed = false;
  try {
    const filename = storyDownloadName(state.selectedProduct.nome, 'mp4');
    const snapshot = captureVideoSnapshot(canvases);
    const { canvas, context } = createExportCanvas(false);
    canvases.push(canvas);
    // Load the MP4 library only when requested; PNG and the editor stay independent.
    const { exportStoryVideo } = await import('./video-export.js');
    let lastPercent = -1;
    const blob = await exportStoryVideo({
      canvas,
      signal: controller.signal,
      renderFrame: (seconds) => drawStoryVideoFrame(context, snapshot, seconds),
      onProgress: (progress) => {
        const percent = Math.min(100, Math.max(0, Math.floor(progress * 100)));
        if (percent === lastPercent) return;
        lastPercent = percent;
        elements.videoProgress.value = percent;
        elements.downloadVideoLabel.textContent = `Gerando MP4 · ${percent}%`;
        // Announce coarse milestones without flooding screen readers on every frame.
        if (percent % 10 === 0) {
          elements.videoExportStatus.textContent = `Gerando vídeo de 15 segundos: ${percent}%.`;
        }
      },
    });
    controller.signal.throwIfAborted();
    videoDownloadUrl = URL.createObjectURL(blob);
    elements.videoDownloadLink.href = videoDownloadUrl;
    elements.videoDownloadLink.download = filename;
    elements.videoDownloadLink.hidden = false;
    elements.videoDownloadLink.click();
    resultMessage = formatName === 'encarte'
      ? 'MP4 pronto: 15 segundos, destacando cada produto em sequência. Se o download não iniciar, use o link abaixo.'
      : 'MP4 pronto: 15 segundos, com animações de entrada e saída. Se o download não iniciar, use o link abaixo.';
  } catch (error) {
    if (controller.signal.aborted || error.name === 'AbortError') {
      resultMessage = 'Exportação cancelada. Sua arte continua disponível no editor.';
    } else {
      failed = true;
      resultMessage = error.message || 'Não foi possível gerar o MP4. Tente novamente.';
    }
  } finally {
    // Release full-resolution pixel buffers even after unsupported codecs or cancellation.
    canvases.forEach((canvas) => { canvas.width = 0; canvas.height = 0; });
    state.videoExportController = null;
    elements.downloadVideo.removeAttribute('aria-busy');
    elements.downloadVideoLabel.textContent = 'Baixar MP4 · 15 s';
    elements.videoProgress.hidden = true;
    elements.cancelVideo.hidden = true;
    elements.videoExportPanel.classList.toggle('is-error', failed);
    elements.videoExportStatus.textContent = resultMessage;
    updateAvailability();
    setStatus(resultMessage, failed);
  }
}

function downloadStory(share = false) {
  if (elements.download.disabled) {
    updateAvailability();
    return;
  }

  // Keep the export name tied to this snapshot if products change while encoding.
  const productName = state.selectedProduct.nome;
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = STORY_WIDTH;
  exportCanvas.height = STORY_HEIGHT;
  const context = exportCanvas.getContext('2d', { alpha: false });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  drawComposition(context);

  state.pngExporting = true;
  updateAvailability();
  updateDownloadLabel('Preparando PNG…');
  exportCanvas.toBlob(async (blob) => {
    state.pngExporting = false;
    updateDownloadLabel('Baixar PNG');
    updateAvailability();
    if (!blob) {
      setStatus('Não foi possível gerar o PNG. Tente novamente.', true);
      return;
    }

    if (share === true) {
      const file = new File([blob], storyDownloadName(productName, 'png'), { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          setStatus('Escolha o Instagram no compartilhamento, se dispon?vel.');
          return;
        } catch (error) { if (error.name === 'AbortError') return; }
      }
      setStatus('Compartilhamento indispon?vel. PNG baixado para abrir no Instagram.');
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = storyDownloadName(productName, 'png');
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (share !== true) setStatus('PNG pronto. A arte foi baixada para o seu dispositivo.');
  }, 'image/png');
}

function getScaleInputForEditorTarget(target) {
  if (extraControls.has(target)) return extraControls.get(target).scale;
  if (target === 'details-secondary') return elements.secondaryDetailsScale;
  if (target === 'details') return elements.detailsScale;
  if (target === 'product-secondary') return elements.secondaryScale;
  if (target === 'free-text') return elements.freeTextScale;
  return elements.scale;
}

function handleSelectionKeydown(event) {
  if (isMobilePreviewLocked()) return;
  const target = event.currentTarget.dataset.editTarget;
  if (!getEditorTransform(target)) return;
  const moveStep = event.shiftKey ? 20 : 5;

  if (event.key === 'ArrowLeft') moveEditorBy(target, -moveStep, 0);
  else if (event.key === 'ArrowRight') moveEditorBy(target, moveStep, 0);
  else if (event.key === 'ArrowUp') moveEditorBy(target, 0, -moveStep);
  else if (event.key === 'ArrowDown') moveEditorBy(target, 0, moveStep);
  else if (event.key === '+' || event.key === '=') {
    const input = getScaleInputForEditorTarget(target);
    resizeEditorByPercentage(target, Number(input?.value || 100) + 5);
  } else if (event.key === '-' || event.key === '_') {
    const input = getScaleInputForEditorTarget(target);
    resizeEditorByPercentage(target, Number(input?.value || 100) - 5);
  } else if (event.key === 'Escape' && state.gesture) {
    const gesture = state.gesture;
    setEditorTransform(gesture.target, gesture.startTransform);
    Object.entries(gesture.linkedStartTransforms || {}).forEach(([linkedTarget, transform]) => {
      setEditorTransform(linkedTarget, transform);
    });
    finishGesture();
    schedulePreview();
  } else {
    return;
  }

  event.preventDefault();
}

function bindSelectionEvents(selection) {
  if (!selection || selection.dataset.storyEditorBound === 'true') return;
  selection.dataset.storyEditorBound = 'true';
  selection.addEventListener('pointerdown', beginGesture);
  selection.addEventListener('pointermove', moveGesture);
  selection.addEventListener('pointerup', finishGesture);
  selection.addEventListener('pointercancel', finishGesture);
  selection.addEventListener('lostpointercapture', finishGesture);
  selection.addEventListener('keydown', handleSelectionKeydown);
}

function bindSecondaryDetailsPositionControls() {
  if (!elements.secondaryDetailsPositionSection) return;
  if (elements.secondaryDetailsPositionSection.dataset.storyEditorBound === 'true') return;
  elements.secondaryDetailsPositionSection.dataset.storyEditorBound = 'true';

  elements.secondaryDetailsScale?.addEventListener('input', () => {
    resizeEditorByPercentage('details-secondary', Number(elements.secondaryDetailsScale.value));
  });
  elements.centerSecondaryDetails?.addEventListener('click', () => centerEditor('details-secondary'));
  elements.resetSecondaryDetails?.addEventListener('click', () => {
    resetDetailsTransform('details-secondary');
  });
}

function cloneControls(source, suffix) {
  const clone = source.cloneNode(true);
  const nodes = [clone, ...clone.querySelectorAll('*')];
  const ids = new Map(nodes.filter(node => node.id).map(node => [node.id, `${node.id}-${suffix}`]));
  for (const node of nodes) {
    if (node.id) node.id = ids.get(node.id);
    for (const attribute of ['for', 'aria-labelledby', 'aria-describedby', 'aria-controls']) {
      const value = node.getAttribute(attribute);
      if (value) node.setAttribute(attribute, value.split(' ').map(id => ids.get(id) || id).join(' '));
    }
    delete node.dataset.storyEditorBound;
  }
  clone.hidden = true;
  return clone;
}

function ensureExtraControls() {
  for (let number = 3; number <= (format.maxProducts || 2); number++) {
    for (const kind of ['product', 'details']) {
      const target = `${kind}-${number}`;
      const selection = cloneControls(kind === 'product' ? elements.selection : elements.detailsSelection, target);
      selection.dataset.editTarget = target;
      selection.setAttribute('aria-label', `${kind === 'product' ? 'Produto' : 'Oferta'} ${number}`);
      elements.interactionLayer.append(selection);
      bindSelectionEvents(selection);
      const section = cloneControls(kind === 'product' ? elements.positionSection : elements.detailsPositionSection, target);
      section.querySelector('h2').textContent = `Ajuste ${kind === 'product' ? 'o produto' : 'a oferta'} ${number}`;
      elements.rightSidebar.append(section);
      const scale = section.querySelector('input[type="range"]'), output = section.querySelector('output');
      const [center, reset] = section.querySelectorAll('button');
      scale.addEventListener('input', () => resizeEditorByPercentage(target, Number(scale.value)));
      center.addEventListener('click', () => centerEditor(target));
      reset.addEventListener('click', () => kind === 'product' ? resetProductTransform(target) : resetDetailsTransform(target));
      const control = { selection, section, scale, output };
      extraControls.set(target, control);
      const mobileSource = elements.mobileEditTargets.find(button => button.dataset.mobileEditTarget === kind);
      if (mobileSource) {
        const button = cloneControls(mobileSource, target);
        button.dataset.mobileEditTarget = target;
        button.textContent = `${kind === 'product' ? 'Produto' : 'Oferta'} ${number}`;
        mobileSource.parentElement.append(button);
        elements.mobileEditTargets.push(button);
      }
      if (kind === 'details') {
        const field = cloneControls(elements.secondaryPriceField, target);
        const label = field.querySelector('.story-price-field-label');
        label.textContent = `Preço do produto ${number}`;
        field.classList.remove('is-disabled');
        field.setAttribute('aria-disabled', 'false');
        const price = field.querySelector('input');
        elements.secondaryPriceField.parentElement.append(field);
        Object.assign(control, { field, price });
        bindPriceInput(price, value => {
          extraSlot(target).price = value;
          syncPriceValidation(); schedulePreview(); updateAvailability();
        });
        price.addEventListener('keydown', event => {
          if (event.key === 'Enter' && document.body.classList.contains('is-mobile-editor')) { event.preventDefault(); price.blur(); }
        });
        const remove = cloneControls(elements.removeSecondaryProduct, target);
        remove.textContent = `Remover produto ${number}`;
        remove.addEventListener('click', () => removeProductFromComposition(String(number)));
        elements.removeAllProducts.before(remove);
        control.remove = remove;
      }
    }
  }
}

function syncExtraControls() {
  const visibleTargets = [];
  for (const [target, control] of extraControls) {
    const details = target.startsWith('details');
    const enabled = (details ? detailTargets() : productTargets()).includes(target);
    const slot = extraSlot(target), box = getEditorBox(target);
    const visible = Boolean(enabled && slot.product && box);
    if (visible) visibleTargets.push(target);
    control.section.hidden = !visible;
    control.section.classList.toggle('is-mobile-selected-control', state.activeEditor === target);
    syncSelection(control.selection, box, visible, target);
    if (visible) syncScaleControl(control.scale, control.output, box,
      (details ? slot.defaultDetailsWidth : slot.defaultProductWidth) || box.width,
      getEditorWidthLimits(target), getEditorTransform(target).width);
    if (control.price) {
      control.field.hidden = !enabled;
      control.price.disabled = !enabled;
      control.price.required = enabled;
      if (control.price.value !== slot.price) control.price.value = slot.price;
      control.remove.hidden = !enabled;
      control.remove.disabled = !slot.product;
      control.remove.title = slot.product?.nome || `Nenhum produto ${target.split('-').at(-1)} selecionado`;
    }
  }
  return visibleTargets;
}

function bindEvents() {
  elements.offerQuantity?.addEventListener('change', event => setOfferQuantity(event.target.value));
  elements.secondaryOfferQuantity?.addEventListener('change', event => setOfferQuantity(event.target.value, 'product-secondary'));
  ensureSecondaryDetailsControls();
  ensureExtraControls();
  const activeMode = elements.compositionModes.find((input) => input.checked);
  state.compositionMode = normalizeCompositionMode(activeMode?.value);
  syncCompositionModeControls();
  compositionPanel.toggle?.addEventListener('click', () => togglePanel(compositionPanel));
  backgroundPanel.toggle?.addEventListener('click', () => togglePanel(backgroundPanel));
  productPanel.toggle?.addEventListener('click', () => togglePanel(productPanel));
  elements.removeProduct.addEventListener('click', () => removeProductFromComposition('primary'));
  elements.removeSecondaryProduct.addEventListener('click', () => removeProductFromComposition('secondary'));
  elements.removeAllProducts.addEventListener('click', () => removeProductFromComposition('all'));
  elements.compositionModes.forEach((input) => {
    // Confirming the initially checked option does not emit a change event.
    input.addEventListener('click', () => {
      if (input.checked && normalizeCompositionMode(input.value) === state.compositionMode) {
        setCompositionMode(input.value);
      }
    });
    input.addEventListener('change', () => {
      if (input.checked) setCompositionMode(input.value);
    });
  });

  document.addEventListener('pointerdown', (event) => {
    if (event.target.closest?.('[data-edit-target]')) return;
    if (document.body.classList.contains('is-mobile-editor')
      && !event.target.closest?.('.story-stage')) return;
    mobileCanvasSelection = null;
    lastCanvasTap = null;
    setActiveEditor();
  });

  elements.search.addEventListener('input', () => {
    queueProductSearch();
  });
  elements.search.addEventListener('search', queueProductSearch);
  elements.search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && document.body.classList.contains('is-mobile-editor')) {
      event.preventDefault();
      clearTimeout(searchTimer);
      void loadProducts();
      elements.search.blur();
      return;
    }
    if (event.key !== 'Escape' || !elements.search.value) return;
    event.preventDefault();
    clearProductSearch();
  });
  elements.clearSearch.addEventListener('click', clearProductSearch);
  elements.products.addEventListener('scroll', loadMoreProductsOnScroll, { passive: true });

  [[elements.price, 'price'], [elements.secondaryPrice, 'secondaryPrice']].forEach(([input, key]) => {
    bindPriceInput(input, (value) => {
      state[key] = value;
      syncPriceValidation();
      schedulePreview();
      updateAvailability();
    });
  });

  elements.freeText.addEventListener('input', () => {
    state.freeText = elements.freeText.value.trim();
    if (!state.freeText) {
      state.freeTextTransform = null;
      state.defaultFreeTextWidth = null;
      if (state.activeEditor === 'free-text') state.activeEditor = null;
      syncProductEditor();
      schedulePreview();
      return;
    }

    if (!state.freeTextTransform) {
      resetFreeTextTransform();
      return;
    }

    state.freeTextTransform = clampFreeTextTransform(state.freeTextTransform);
    syncProductEditor();
    schedulePreview();
  });

  elements.anchorToggle.addEventListener('change', () => {
    state.elementsAnchored = elements.anchorToggle.checked
      && getAnchoredEditorTargets().every((target) => getEditorTransform(target));
    syncProductEditor();
  });

  [
    elements.selection,
    elements.secondarySelection,
    elements.detailsSelection,
    elements.secondaryDetailsSelection,
    elements.freeTextSelection,
  ].forEach(bindSelectionEvents);

  elements.scale.addEventListener('input', () => resizeEditorByPercentage('product', Number(elements.scale.value)));
  elements.centerProduct.addEventListener('click', () => centerEditor('product'));
  elements.resetProduct.addEventListener('click', () => resetProductTransform());
  elements.secondaryScale.addEventListener(
    'input',
    () => resizeEditorByPercentage('product-secondary', Number(elements.secondaryScale.value)),
  );
  elements.centerSecondaryProduct.addEventListener('click', () => centerEditor('product-secondary'));
  elements.resetSecondaryProduct.addEventListener(
    'click',
    () => resetProductTransform('product-secondary'),
  );
  elements.detailsScale.addEventListener('input', () => resizeEditorByPercentage('details', Number(elements.detailsScale.value)));
  elements.centerDetails.addEventListener('click', () => centerEditor('details'));
  elements.resetDetails.addEventListener('click', () => resetDetailsTransform());
  bindSecondaryDetailsPositionControls();
  elements.freeTextScale.addEventListener(
    'input',
    () => resizeEditorByPercentage('free-text', Number(elements.freeTextScale.value)),
  );
  elements.centerFreeText.addEventListener('click', () => centerEditor('free-text'));
  elements.resetFreeText.addEventListener('click', resetFreeTextTransform);
  elements.zoom.addEventListener('input', () => setPreviewZoom(elements.zoom.value));
  elements.zoomOut.addEventListener('click', () => setPreviewZoom(state.previewZoom - Number(elements.zoom.step)));
  elements.zoomIn.addEventListener('click', () => setPreviewZoom(state.previewZoom + Number(elements.zoom.step)));
  elements.stage.addEventListener('wheel', (event) => {
    if (!event.deltaY) return;
    event.preventDefault();
    const step = Number(elements.zoom.step) || 5;
    setPreviewZoom(state.previewZoom - Math.sign(event.deltaY) * step);
  }, { passive: false });
  elements.thirdsGridToggle.addEventListener('click', () => {
    setThirdsGridVisible(!state.thirdsGridVisible);
  });
  elements.autoLayout.addEventListener('click', applyAutoLayout);
  elements.mobileEditTargets.forEach((button) => {
    button.addEventListener('click', () => setActiveEditor(button.dataset.mobileEditTarget));
  });
  elements.mobileNudges.forEach((button) => {
    button.addEventListener('click', () => {
      const movements = { up: [0, -8], down: [0, 8], left: [-8, 0], right: [8, 0] };
      const movement = movements[button.dataset.mobileNudge];
      if (state.activeEditor && movement) moveEditorBy(state.activeEditor, ...movement);
    });
  });
  elements.mobileCenter?.addEventListener('click', () => {
    if (state.activeEditor) centerEditor(state.activeEditor);
  });
  elements.mobileScaleSteps.forEach((button) => {
    button.addEventListener('click', () => {
      const input = state.activeEditor && getScaleInputForEditorTarget(state.activeEditor);
      if (!input) return;
      const value = clamp(Number(input.value) + Number(button.dataset.mobileScaleStep), Number(input.min), Number(input.max));
      resizeEditorByPercentage(state.activeEditor, value);
    });
  });
  [elements.price, elements.secondaryPrice, elements.freeText].forEach((input) => {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && document.body.classList.contains('is-mobile-editor')) {
        event.preventDefault();
        input.blur();
      }
    });
  });
  elements.download.addEventListener('click', () => downloadStory());
  document.getElementById('share-story-instagram')?.addEventListener('click', () => downloadStory(true));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') document.querySelectorAll('.artwork-share-menu[open]').forEach(menu => { menu.open = false; menu.querySelector('summary').focus(); });
  });
  document.addEventListener('click', (event) => {
    document.querySelectorAll('.artwork-share-menu[open]').forEach(menu => { if (!menu.contains(event.target)) menu.open = false; });
  });
  elements.convertFormat?.addEventListener('click', convertCurrentArtwork);
  elements.downloadVideo.addEventListener('click', downloadStoryVideo);
  elements.cancelVideo.addEventListener('click', () => {
    state.videoExportController?.abort();
    elements.cancelVideo.disabled = true;
    elements.videoExportStatus.textContent = 'Cancelando exportação…';
  });
  window.addEventListener('pagehide', () => {
    state.videoExportController?.abort();
    if (videoDownloadUrl) URL.revokeObjectURL(videoDownloadUrl);
    videoDownloadUrl = null;
    elements.videoDownloadLink.hidden = true;
    elements.videoDownloadLink.removeAttribute('href');
  });
}

export async function initStoriesEditor() {
  elements.canvas.width = STORY_WIDTH;
  elements.canvas.height = STORY_HEIGHT;
  bindEvents();
  mobileEditor = initStoriesMobileEditor({
    getProgress: getMobileProgress,
    onStepChange: () => {
      finishGesture();
      syncProductEditor();
    },
  });
  setPreviewZoom(state.previewZoom);
  setThirdsGridVisible(state.thirdsGridVisible);
  drawPreviewNow();
  try {
    await Promise.allSettled([loadBackgrounds(), loadProducts()]);
    await preselectProductFromLocation();
    await renderPreview();
    // The mobile canvas stays expanded even when a product arrives from the catalogue.
  } catch {
    // The individual loading functions already show a useful error in the interface.
  }
}

function truncateLines(lines, count, context, width) {
  if (lines.length <= count) return;
  lines.splice(count);
  let last = lines[count - 1];
  while (last.length && context.measureText(last + '…').width > width) last = last.slice(0, -1);
  lines[count - 1] = last.trimEnd() + '…';
}
