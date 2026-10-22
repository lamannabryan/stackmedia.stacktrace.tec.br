export const INDOOR_WIDTH = 1920;
export const INDOOR_HEIGHT = 1080;
export const INDOOR_DURATION = 15;
export const INDOOR_PRODUCT_COUNT = 5;

const SLOT_DURATION = INDOOR_DURATION / INDOOR_PRODUCT_COUNT;
const TRANSITION_DURATION = 0.35;
// The supplied TV templates place their campaign marks in the left 28% or less.
// Reserve 30% throughout the animation, including the wider contraceptive banner.
const SAFE_LEFT = 576;
const SAFE_RIGHT = INDOOR_WIDTH - 64;
const SAFE_TOP = 84;
const SAFE_BOTTOM = INDOOR_HEIGHT - 84;
const SLIDE_WIDTH = SAFE_RIGHT - SAFE_LEFT;
const FONT_FAMILY = 'Arial, Helvetica, sans-serif';
const PRODUCT_BOX = { x: 600, y: 120, width: 540, height: 840 };
const CARD = { x: 1180, y: 220, width: 660, height: 640 };

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

/** A deterministic, seamless 15-second loop. Each product owns a three-second slot. */
export function getCarouselState(seconds) {
  const input = Number(seconds);
  const time = Number.isFinite(input) ? Math.max(0, input) % INDOOR_DURATION : 0;
  const index = Math.floor(time / SLOT_DURATION);
  const nextIndex = (index + 1) % INDOOR_PRODUCT_COUNT;
  const localTime = time - index * SLOT_DURATION;
  const progress = clamp((localTime - (SLOT_DURATION - TRANSITION_DURATION)) / TRANSITION_DURATION, 0, 1);
  const eased = progress * progress * (3 - 2 * progress);
  const slides = [{ index, offsetX: eased === 0 ? 0 : -SLIDE_WIDTH * eased, opacity: 1 }];
  if (progress > 0) slides.push({ index: nextIndex, offsetX: SLIDE_WIDTH * (1 - eased), opacity: 1 });
  return { index, nextIndex, progress, transition: progress > 0, slides };
}

function imageSize(image) {
  if (!image) return null;
  const width = Number(image.naturalWidth ?? image.videoWidth ?? image.width);
  const height = Number(image.naturalHeight ?? image.videoHeight ?? image.height);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height }
    : null;
}

function drawBackground(context, background) {
  context.fillStyle = '#edf3fa';
  context.fillRect(0, 0, INDOOR_WIDTH, INDOOR_HEIGHT);
  const size = imageSize(background);
  if (!size) return;
  const scale = Math.max(INDOOR_WIDTH / size.width, INDOOR_HEIGHT / size.height);
  const sourceWidth = INDOOR_WIDTH / scale;
  const sourceHeight = INDOOR_HEIGHT / scale;
  context.drawImage(background,
    (size.width - sourceWidth) / 2, (size.height - sourceHeight) / 2, sourceWidth, sourceHeight,
    0, 0, INDOOR_WIDTH, INDOOR_HEIGHT);
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, 1200);
}

function ellipsize(context, text, width) {
  if (context.measureText(text).width <= width) return text;
  const characters = Array.from(text);
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = `${characters.slice(0, middle).join('').trimEnd()}…`;
    if (context.measureText(candidate).width <= width) low = middle;
    else high = middle - 1;
  }
  return `${characters.slice(0, low).join('').trimEnd()}…`;
}

function wrapText(context, value, width, maximumLines) {
  const text = cleanText(value);
  if (!text) return [];
  const words = text.split(' ');
  const lines = [];
  while (words.length && lines.length < maximumLines) {
    if (lines.length === maximumLines - 1) {
      lines.push(ellipsize(context, words.join(' '), width));
      break;
    }
    let line = words.shift();
    while (words.length && context.measureText(`${line} ${words[0]}`).width <= width) {
      line += ` ${words.shift()}`;
    }
    lines.push(ellipsize(context, line, width));
  }
  return lines;
}

function roundedRectangle(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function drawDetails(context, entry) {
  const product = entry.product || {};
  const contentX = CARD.x + 44;
  const contentWidth = CARD.width - 88;

  context.save();
  try {
    context.shadowColor = 'rgba(14, 29, 56, 0.16)';
    context.shadowBlur = 28;
    context.shadowOffsetY = 10;
    context.fillStyle = '#ffffff';
    roundedRectangle(context, CARD.x, CARD.y, CARD.width, CARD.height, 36);
    context.fill();
    context.shadowColor = 'transparent';
    context.shadowBlur = 0;
    context.shadowOffsetY = 0;
    context.textBaseline = 'top';
    context.textAlign = 'left';

    let titleY = CARD.y + 56;
    const manufacturer = cleanText(product.fabricante);
    if (manufacturer) {
      context.font = `600 28px ${FONT_FAMILY}`;
      context.fillStyle = '#5b677d';
      context.fillText(ellipsize(context, manufacturer, contentWidth), contentX, titleY);
      titleY += 56;
    }

    context.font = `700 60px ${FONT_FAMILY}`;
    context.fillStyle = '#142c54';
    const titleLines = wrapText(context, product.nome || 'Produto', contentWidth, 3);
    titleLines.forEach((line, index) => context.fillText(line, contentX, titleY + index * 70));

    const subtitleY = titleY + titleLines.length * 70 + 22;
    context.font = `400 34px ${FONT_FAMILY}`;
    context.fillStyle = '#49566b';
    const subtitleLines = wrapText(context, product.subtitulo, contentWidth, 2);
    subtitleLines.forEach((line, index) => context.fillText(line, contentX, subtitleY + index * 44));

    // The controller supplies an already formatted Brazilian price; blank means no price.
    const price = cleanText(entry.price);
    if (price) {
      let fontSize = 112;
      context.font = `700 ${fontSize}px ${FONT_FAMILY}`;
      while (fontSize > 48 && context.measureText(price).width > contentWidth) {
        fontSize -= 2;
        context.font = `700 ${fontSize}px ${FONT_FAMILY}`;
      }
      context.fillStyle = '#cf2035';
      context.fillText(ellipsize(context, price, contentWidth), contentX, CARD.y + CARD.height - 168);
    }
  } finally {
    context.restore();
  }
}

function drawProduct(context, entry) {
  const size = imageSize(entry.image);
  if (size) {
    const scale = Math.min(PRODUCT_BOX.width / size.width, PRODUCT_BOX.height / size.height);
    const width = size.width * scale;
    const height = size.height * scale;
    context.drawImage(entry.image,
      PRODUCT_BOX.x + (PRODUCT_BOX.width - width) / 2,
      PRODUCT_BOX.y + (PRODUCT_BOX.height - height) / 2,
      width, height);
  }
  drawDetails(context, entry);
}

/**
 * Paints directly into the supplied 1920×1080 canvas; no intermediate canvases or DOM.
 * products: exactly five { product: { nome, subtitulo, fabricante }, image, price } entries.
 * background and image must be loaded CanvasImageSources. Missing images are skipped.
 * Returns the carousel state used, so preview controls can follow the same timeline.
 */
export function drawIndoorFrame(context, { background, products }, seconds) {
  if (!Array.isArray(products) || products.length !== INDOOR_PRODUCT_COUNT || products.some((entry) => !entry)) {
    throw new RangeError('O vídeo Indoor precisa de exatamente 5 produtos.');
  }
  const state = getCarouselState(seconds);
  context.save();
  try {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    context.filter = 'none';
    context.shadowColor = 'transparent';
    context.shadowBlur = 0;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 0;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    drawBackground(context, background);

    // Clip every moving layer so logos at the left remain unobstructed at all times.
    // The horizontal travel matches this viewport, keeping consecutive slides adjacent.
    context.beginPath();
    context.rect(SAFE_LEFT, SAFE_TOP, SLIDE_WIDTH, SAFE_BOTTOM - SAFE_TOP);
    context.clip();
    for (const slide of state.slides) {
      context.save();
      try {
        context.translate(slide.offsetX, 0);
        drawProduct(context, products[slide.index]);
      } finally {
        context.restore();
      }
    }
  } finally {
    context.restore();
  }
  return state;
}
