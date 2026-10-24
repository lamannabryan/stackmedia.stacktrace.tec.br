import { DEFAULT_THEME_COLOR } from './palette.js';

export const INDOOR_WIDTH = 1920;
export const INDOOR_HEIGHT = 1080;
export const INDOOR_DURATION = 15;
export const INDOOR_PRODUCT_COUNT = 5;

const TRANSITION_DURATION = 0.35;
// Center the complete offer (image + card) in the frame, with equal side margins.
const CONTENT_WIDTH = 1240;
const CONTENT_LEFT = (INDOOR_WIDTH - CONTENT_WIDTH) / 2;
const SAFE_LEFT = CONTENT_LEFT - 24;
const SAFE_RIGHT = CONTENT_LEFT + CONTENT_WIDTH + 16;
const SAFE_TOP = 84;
const SAFE_BOTTOM = INDOOR_HEIGHT - 84;
const SLIDE_WIDTH = SAFE_RIGHT - SAFE_LEFT;
const FONT_FAMILY = 'Arial, Helvetica, sans-serif';
const PRODUCT_BOX = { x: CONTENT_LEFT, y: 120, width: 540, height: 840 };
const CARD = { x: CONTENT_LEFT + 580, y: 220, width: 660, height: 640 };

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

/** A deterministic, seamless 15-second loop, divided equally among the products. */
export function getCarouselState(seconds, productCount = INDOOR_PRODUCT_COUNT) {
  if (!Number.isInteger(productCount) || productCount < 2 || productCount > INDOOR_PRODUCT_COUNT) {
    throw new RangeError('O vídeo para TV precisa de 2 a 5 produtos.');
  }
  const slotDuration = INDOOR_DURATION / productCount;
  const input = Number(seconds);
  const time = Number.isFinite(input) ? Math.max(0, input) % INDOOR_DURATION : 0;
  const index = Math.floor(time / slotDuration);
  const nextIndex = (index + 1) % productCount;
  const localTime = time - index * slotDuration;
  const progress = clamp((localTime - (slotDuration - TRANSITION_DURATION)) / TRANSITION_DURATION, 0, 1);
  const eased = progress * progress * (3 - 2 * progress);
  const slides = [{ index, offsetX: eased === 0 ? 0 : -SLIDE_WIDTH * eased, opacity: 1 }];
  if (progress > 0) slides.push({ index: nextIndex, offsetX: SLIDE_WIDTH * (1 - eased), opacity: 1 });
  return { index, nextIndex, progress, localTime, slotDuration, transition: progress > 0, slides };
}

const easeOut = value => 1 - (1 - clamp(value, 0, 1)) ** 3;

// Incoming slides start their choreography during the carousel transition. Adding
// that lead-in to the active slide keeps every layer continuous at slot boundaries.
export function getProductMotion(age, index = 0) {
  const enter = easeOut(age / 0.85);
  const direction = index % 2 ? -1 : 1;
  const drift = Math.sin(Math.max(0, age - 0.85) * 1.5);
  return {
    imageScale: 0.88 + enter * 0.12,
    imageY: (1 - enter) * 44 + drift * 9,
    imageRotation: direction * ((1 - enter) * 0.075 + drift * 0.012),
    cardX: direction * (1 - easeOut(age / 0.7)) * 48,
    cardAlpha: 0.35 + 0.65 * enter,
    title: easeOut((age - 0.12) / 0.55),
    subtitle: easeOut((age - 0.24) / 0.55),
    price: easeOut((age - 0.38) / 0.6),
    shine: clamp((age - 1.05) / 0.85, 0, 1),
    drift,
  };
}

function mixColor(color, target, amount) {
  const channels = color.slice(1).match(/../g).map(value => parseInt(value, 16));
  return `rgb(${channels.map(value => Math.round(value + (target - value) * amount)).join(', ')})`;
}

function drawLayer(context, progress, paint) {
  context.save();
  try {
    context.globalAlpha *= progress;
    context.translate(0, (1 - progress) * 22);
    paint();
  } finally {
    context.restore();
  }
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

function drawDetails(context, entry, motion, themeColor) {
  const product = entry.product || {};
  const contentX = CARD.x + 44;
  const contentWidth = CARD.width - 88;

  context.save();
  try {
    context.translate(motion.cardX, 0);
    context.globalAlpha *= motion.cardAlpha;
    context.shadowColor = 'rgba(14, 29, 56, 0.16)';
    context.shadowBlur = 28;
    context.shadowOffsetY = 10;
    context.fillStyle = '#ffffff';
    roundedRectangle(context, CARD.x, CARD.y, CARD.width, CARD.height, 36);
    context.fill();
    context.shadowColor = 'transparent';
    context.shadowBlur = 0;
    context.shadowOffsetY = 0;
    context.fillStyle = themeColor;
    roundedRectangle(context, contentX, CARD.y + 26, 72, 6, 3);
    context.fill();
    context.textBaseline = 'top';
    context.textAlign = 'left';

    let titleY = CARD.y + 56;
    const manufacturer = cleanText(product.fabricante);
    if (manufacturer) {
      context.font = `600 28px ${FONT_FAMILY}`;
      context.fillStyle = mixColor(themeColor, 0, 0.45);
      drawLayer(context, motion.title, () => context.fillText(ellipsize(context, manufacturer, contentWidth), contentX, titleY));
      titleY += 56;
    }

    context.font = `700 60px ${FONT_FAMILY}`;
    context.fillStyle = '#142c54';
    const titleLines = wrapText(context, product.nome || 'Produto', contentWidth, 3);
    drawLayer(context, motion.title, () => {
      titleLines.forEach((line, index) => context.fillText(line, contentX, titleY + index * 70));
    });

    const subtitleY = titleY + titleLines.length * 70 + 22;
    context.font = `400 34px ${FONT_FAMILY}`;
    context.fillStyle = '#49566b';
    const subtitleLines = wrapText(context, product.subtitulo, contentWidth, 2);
    drawLayer(context, motion.subtitle, () => {
      subtitleLines.forEach((line, index) => context.fillText(line, contentX, subtitleY + index * 44));
    });

    // The controller supplies an already formatted Brazilian price; blank means no price.
    const price = cleanText(entry.price);
    if (price) {
      let fontSize = 112;
      context.font = `700 ${fontSize}px ${FONT_FAMILY}`;
      while (fontSize > 48 && context.measureText(price).width > contentWidth) {
        fontSize -= 2;
        context.font = `700 ${fontSize}px ${FONT_FAMILY}`;
      }
      drawLayer(context, 0.7 + motion.price * 0.3, () => {
        const priceY = CARD.y + CARD.height - 168;
        context.fillStyle = mixColor(themeColor, 255, 0.9);
        roundedRectangle(context, contentX - 16, priceY - 16, contentWidth + 32, 140, 24);
        context.fill();
        // A single light sweep draws attention to the price without flashing.
        context.save();
        try {
          context.clip();
          const shineX = contentX - 180 + motion.shine * (contentWidth + 360);
          const shine = context.createLinearGradient(shineX, 0, shineX + 140, 0);
          shine.addColorStop(0, 'rgba(255,255,255,0)');
          shine.addColorStop(0.5, 'rgba(255,255,255,0.75)');
          shine.addColorStop(1, 'rgba(255,255,255,0)');
          context.fillStyle = shine;
          context.fillRect(shineX, priceY - 16, 140, 140);
        } finally {
          context.restore();
        }
        context.fillStyle = mixColor(themeColor, 0, 0.42);
        context.fillText(ellipsize(context, price, contentWidth), contentX, priceY);
      });
    }
  } finally {
    context.restore();
  }
}

function drawProduct(context, entry, age, index, themeColor) {
  const motion = getProductMotion(age, index);
  const centerX = PRODUCT_BOX.x + PRODUCT_BOX.width / 2;
  const centerY = PRODUCT_BOX.y + PRODUCT_BOX.height / 2;
  // Soft light and two moving arcs give the product depth while leaving the
  // campaign artwork untouched outside the reserved product viewport.
  context.save();
  try {
    const halo = context.createRadialGradient(centerX, centerY, 40, centerX, centerY, 310);
    halo.addColorStop(0, mixColor(themeColor, 255, 0.84));
    halo.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = halo;
    context.fillRect(PRODUCT_BOX.x, centerY - 310, PRODUCT_BOX.width, 620);
    context.globalAlpha = 0.18;
    context.strokeStyle = themeColor;
    context.lineWidth = 3;
    for (let ring = 0; ring < 2; ring += 1) {
      context.beginPath();
      const angle = age * 0.35 + index + ring * Math.PI;
      context.ellipse(centerX, centerY, 238 + ring * 18, 300 + ring * 24, motion.drift * 0.04, angle, angle + Math.PI * 0.7);
      context.stroke();
    }
  } finally {
    context.restore();
  }
  const size = imageSize(entry.image);
  if (size) {
    const scale = Math.min((PRODUCT_BOX.width - 60) / size.width, (PRODUCT_BOX.height - 100) / size.height);
    const width = size.width * scale;
    const height = size.height * scale;
    context.save();
    try {
      context.translate(centerX, centerY + motion.imageY);
      context.rotate(motion.imageRotation);
      context.scale(motion.imageScale, motion.imageScale);
      context.shadowColor = 'rgba(14,29,56,0.15)';
      context.shadowBlur = 22;
      context.shadowOffsetY = 16;
      context.drawImage(entry.image, -width / 2, -height / 2, width, height);
    } finally {
      context.restore();
    }
  }
  drawDetails(context, entry, motion, themeColor);
}

function drawProgress(context, state, count, themeColor) {
  const gap = 12;
  const width = (CONTENT_WIDTH - gap * (count - 1)) / count;
  for (let index = 0; index < count; index += 1) {
    const x = CONTENT_LEFT + index * (width + gap);
    const fraction = index < state.index ? 1 : index === state.index ? state.localTime / state.slotDuration : 0;
    // A white surround keeps even dark or very light theme colors visible.
    context.fillStyle = 'rgba(255,255,255,0.9)';
    roundedRectangle(context, x - 2, 970, width + 4, 14, 7);
    context.fill();
    context.fillStyle = mixColor(themeColor, 255, 0.8);
    roundedRectangle(context, x, 972, width, 10, 5);
    context.fill();
    if (fraction <= 0) continue;
    context.fillStyle = themeColor;
    roundedRectangle(context, x, 972, width * fraction, 10, Math.min(5, width * fraction / 2));
    context.fill();
  }
}

/**
 * Paints directly into the supplied 1920×1080 canvas; no intermediate canvases or DOM.
 * products: two to five { product: { nome, subtitulo, fabricante }, image, price } entries.
 * background and image must be loaded CanvasImageSources. Missing images are skipped.
 * Returns the carousel state used, so preview controls can follow the same timeline.
 */
export function drawIndoorFrame(context, { background, products, themeColor = DEFAULT_THEME_COLOR }, seconds) {
  if (!Array.isArray(products) || products.length < 2 || products.length > INDOOR_PRODUCT_COUNT || products.some((entry) => !entry)) {
    throw new RangeError('O vídeo para TV precisa de 2 a 5 produtos.');
  }
  const state = getCarouselState(seconds, products.length);
  const accent = /^#[\da-f]{6}$/i.test(themeColor) ? themeColor : DEFAULT_THEME_COLOR;
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

    // Keep the moving content inside the centered viewport. The horizontal
    // travel matches its width, keeping consecutive slides adjacent.
    context.beginPath();
    context.rect(SAFE_LEFT, SAFE_TOP, SLIDE_WIDTH, SAFE_BOTTOM - SAFE_TOP);
    context.clip();
    for (const slide of state.slides) {
      context.save();
      try {
        context.translate(slide.offsetX, 0);
        const age = slide.index === state.index ? state.localTime + TRANSITION_DURATION : state.progress * TRANSITION_DURATION;
        drawProduct(context, products[slide.index], age, slide.index, accent);
      } finally {
        context.restore();
      }
    }
    drawProgress(context, state, products.length, accent);
  } finally {
    context.restore();
  }
  return state;
}
