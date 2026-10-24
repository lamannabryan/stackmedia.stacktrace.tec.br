import { MIN_DETAILS_WIDTH, STORY_HEIGHT, STORY_SAFE_TOP, STORY_SAFE_BOTTOM, STORY_WIDTH } from './constants.js';
import { COMPOSITION_COUNTS, compositionTargets } from './composition.js';

const GAP = 32;
const MARGIN = 56;
const EPSILON = 0.01;

function intersects(first, second) {
  return first.x < second.x + second.width - EPSILON
    && first.x + first.width > second.x + EPSILON
    && first.y < second.y + second.height - EPSILON
    && first.y + first.height > second.y + EPSILON;
}

function contains(area, box) {
  return box.x >= area.x - EPSILON && box.y >= area.y - EPSILON
    && box.x + box.width <= area.x + area.width + EPSILON
    && box.y + box.height <= area.y + area.height + EPSILON;
}

function availableAreas(obstacle, SAFE_AREA) {
  if (!obstacle || !intersects(SAFE_AREA, obstacle)) return [SAFE_AREA];
  const right = SAFE_AREA.x + SAFE_AREA.width;
  const bottom = SAFE_AREA.y + SAFE_AREA.height;
  return [
    { ...SAFE_AREA, height: obstacle.y - SAFE_AREA.y },
    { ...SAFE_AREA, y: obstacle.y + obstacle.height, height: bottom - obstacle.y - obstacle.height },
    { ...SAFE_AREA, width: obstacle.x - SAFE_AREA.x },
    { ...SAFE_AREA, x: obstacle.x + obstacle.width, width: right - obstacle.x - obstacle.width },
  ].filter((area) => area.width >= MIN_DETAILS_WIDTH && area.height > GAP);
}

function fitProduct(product, area, scale = 1) {
  const width = Math.min(area.width, area.height * product.aspectRatio) * scale;
  return {
    x: area.x + (area.width - width) / 2,
    y: area.y + area.height - width / product.aspectRatio,
    width,
  };
}

/**
 * Fits the current artwork without DOM, canvas or state mutations. Card sizes
 * come from the same text measurement used by the renderer, including prices.
 * A details transform stores its logical width; the painted card is centered
 * inside that width. The existing free text remains at its current position.
 */
export function createAutoLayout(options) {
  if (!options || typeof options !== 'object') return null;
  const { width = STORY_WIDTH, height = STORY_HEIGHT, safeTop = STORY_SAFE_TOP,
    safeBottom = options.format ? 0 : STORY_SAFE_BOTTOM } = options.format || {};
  // Keep offers above the decorative footer, including diagonal campaign bands.
  const bottomMargin = Math.max(MARGIN, safeBottom, height * (options.format?.footerRatio ?? 0.18));
  if (![width, height, safeTop, safeBottom].every(Number.isFinite)
      || width <= MARGIN * 2 || safeTop < 0 || safeBottom < 0 || height <= safeTop + bottomMargin + 24) return null;
  const encarte = options.format?.downloadPrefix === 'encarte';
  const sideMargin = encarte ? 40 : MARGIN;
  const SAFE_AREA = {
    x: sideMargin, y: safeTop + 24,
    width: width - sideMargin * 2, height: height - bottomMargin - safeTop - 24,
  };
  const maximumDetailsWidth = width - 48;
  const { mode, products, measureDetails, freeTextBox = null, orientation = 'vertical' } = options;
  if (!['vertical', 'horizontal'].includes(orientation)) return null;
  const count = COMPOSITION_COUNTS[mode];
  if (!count
    || !Array.isArray(products) || products.length !== count
    || typeof measureDetails !== 'function'
    || products.some((product, index) => !product
      || product.target !== compositionTargets(mode)[index]
      || !Number.isFinite(product.aspectRatio) || product.aspectRatio <= 0)) return null;

  if (freeTextBox && ['x', 'y', 'width', 'height'].some((key) => !Number.isFinite(freeTextBox[key]))) return null;
  if (freeTextBox && (freeTextBox.width < 0 || freeTextBox.height < 0)) return null;
  const obstacle = freeTextBox ? {
    x: freeTextBox.x - GAP,
    y: freeTextBox.y - GAP,
    width: freeTextBox.width + GAP * 2,
    height: freeTextBox.height + GAP * 2,
  } : null;
  const detailTargets = compositionTargets(mode, 'details');
  const measurements = new Map();
  let best = null;
  let bestScore = -Infinity;

  function measure(target, width) {
    if (width < MIN_DETAILS_WIDTH || width > maximumDetailsWidth) return null;
    const key = `${target}:${width}`;
    if (!measurements.has(key)) {
      const size = measureDetails(target, width);
      measurements.set(key, size && Number.isFinite(size.width) && Number.isFinite(size.height)
        && size.width > 0 && size.width <= width + EPSILON && size.height > 0 ? size : null);
    }
    return measurements.get(key);
  }

  function consider(candidate, area) {
    const boxes = products.map((product) => {
      const transform = candidate.products[product.target];
      return { ...transform, height: transform.width / product.aspectRatio };
    });
    const productAreas = boxes.map((box) => box.width * box.height);
    for (const target of detailTargets) {
      const transform = candidate.details[target];
      const size = measure(target, transform.width);
      if (!size) return;
      boxes.push({ x: transform.x + (transform.width - size.width) / 2, y: transform.y, ...size });
    }
    if (boxes.some((box) => !Number.isFinite(box.x + box.y + box.width + box.height)
      || box.width <= 0 || box.height <= 0 || !contains(area, box)
      || !contains(SAFE_AREA, box) || (obstacle && intersects(box, obstacle)))) return;
    if (boxes.some((box, index) => boxes.slice(index + 1).some((other) => intersects(box, other)))) return;

    // Reward visible product area and readable offers. A square root keeps a
    // very wide package from dominating a narrow bottle in the same campaign.
    const productScore = productAreas.reduce((sum, size) => sum + Math.sqrt(size / (SAFE_AREA.width * SAFE_AREA.height)), 0) / count;
    const idealCardWidth = orientation === 'horizontal' ? 560 : mode === 'two-products' ? 440 : 780;
    const textScore = detailTargets.reduce((sum, target) => sum + Math.min(1, candidate.details[target].width / idealCardWidth), 0) / detailTargets.length;
    const score = productScore * (count > 2 ? 2 : 1) + textScore * (orientation === 'horizontal' ? 0.9 : 0.65);
    if (score > bestScore + EPSILON / 100) {
      if (encarte && !candidate.itemAreas) {
        candidate.itemAreas = {};
        products.forEach((product, index) => {
          const columns = orientation === 'vertical' ? count : 1;
          const rows = orientation === 'horizontal' ? count : 1;
          candidate.itemAreas[product.target] = {
            x: area.x + (index % columns) * area.width / columns,
            y: area.y + Math.floor(index / columns) * area.height / rows,
            width: area.width / columns, height: area.height / rows,
          };
        });
      }
      best = candidate;
      bestScore = score;
    }
  }

  function vertical(area, factor, pairArrangement = 'row') {
    const separate = mode === 'two-products';
    const cellWidth = separate ? (area.width - GAP) / 2 : area.width;
    const width = cellWidth * factor;
    const sizes = detailTargets.map((target) => measure(target, width));
    if (sizes.some((size) => !size)) return;
    const detailsHeight = Math.max(...sizes.map((size) => size.height));
    const productHeight = area.height - detailsHeight - GAP;
    if (productHeight <= 0) return;
    const candidate = { products: {}, details: {}, arrangement: separate ? 'columns' : mode === 'single' ? 'single' : `combo-${pairArrangement}` };
    let usedHeight;

    if (mode === 'single' || separate) {
      products.forEach((product, index) => {
        candidate.products[product.target] = fitProduct(product, {
          x: area.x + index * (cellWidth + GAP), y: 0, width: cellWidth, height: productHeight,
        }, separate ? 0.9 : 1);
      });
      usedHeight = Math.max(...products.map((product) => candidate.products[product.target].width / product.aspectRatio));
    } else if (pairArrangement === 'stack') {
      const width = Math.min(area.width, (productHeight - GAP) / products.reduce((sum, product) => sum + 1 / product.aspectRatio, 0));
      if (width <= 0) return;
      let y = 0;
      products.forEach((product) => {
        candidate.products[product.target] = { x: area.x + (area.width - width) / 2, y, width };
        y += width / product.aspectRatio + GAP;
      });
      usedHeight = y - GAP;
    } else if (pairArrangement === 'balanced') {
      const cellWidth = (area.width - GAP) / 2;
      products.forEach((product, index) => {
        candidate.products[product.target] = fitProduct(product, {
          x: area.x + index * (cellWidth + GAP), y: 0, width: cellWidth, height: productHeight,
        });
      });
      usedHeight = Math.max(...products.map((product) => candidate.products[product.target].width / product.aspectRatio));
    } else {
      const height = Math.min(productHeight, (area.width - GAP) / products.reduce((sum, product) => sum + product.aspectRatio, 0));
      const groupWidth = products.reduce((sum, product) => sum + height * product.aspectRatio, GAP);
      let x = area.x + (area.width - groupWidth) / 2;
      products.forEach((product) => {
        const width = height * product.aspectRatio;
        candidate.products[product.target] = { x, y: 0, width };
        x += width + GAP;
      });
      usedHeight = height;
    }

    const top = area.y + (area.height - usedHeight - GAP - detailsHeight) / 2;
    products.forEach((product) => {
      const transform = candidate.products[product.target];
      transform.y = pairArrangement === 'stack' && mode === 'combo'
        ? top + transform.y : top + usedHeight - transform.width / product.aspectRatio;
    });
    detailTargets.forEach((target, index) => {
      candidate.details[target] = {
        x: area.x + index * (cellWidth + GAP) + (cellWidth - width) / 2,
        y: top + usedHeight + GAP,
        width,
      };
    });
    consider(candidate, area);
  }

  function horizontal(area, factor) {
    const rows = mode === 'two-products' ? 2 : 1;
    const rowHeight = (area.height - GAP * (rows - 1)) / rows;
    const cardWidth = area.width * factor;
    const imageWidth = area.width - cardWidth - GAP;
    if (imageWidth <= 0 || rowHeight <= 0) return;
    const candidate = { products: {}, details: {}, arrangement: mode === 'combo' ? 'combo-horizontal' : 'rows' };
    for (let index = 0; index < rows; index++) {
      const target = detailTargets[index];
      const size = measure(target, cardWidth);
      if (!size || size.height > rowHeight) return;
      const y = area.y + index * (rowHeight + GAP);
      const group = mode === 'combo' ? products : [products[index]];
      // Two combo products share one offer. Stack them in the image column
      // using equal widths and preserve each package's aspect ratio.
      const imageHeight = rowHeight - GAP * (group.length - 1);
      const width = Math.min(imageWidth, imageHeight / group.reduce((sum, product) => sum + 1 / product.aspectRatio, 0));
      const groupHeight = group.reduce((sum, product) => sum + width / product.aspectRatio, GAP * (group.length - 1));
      let top = y + (rowHeight - groupHeight) / 2;
      for (const product of group) {
        candidate.products[product.target] = { x: area.x + (imageWidth - width) / 2, y: top, width };
        top += width / product.aspectRatio + GAP;
      }
      candidate.details[target] = { x: area.x + imageWidth + GAP, y: y + (rowHeight - size.height) / 2, width: cardWidth };
    }
    consider(candidate, area);
  }

  function grid(area, factor) {
    const columns = orientation === 'horizontal' ? 2 : count === 5 ? 3 : 2;
    const rows = Math.ceil(count / columns);
    const gap = encarte ? 0 : 24;
    const inset = encarte ? 14 : 0;
    const outerWidth = (area.width - gap * (columns - 1)) / columns;
    const outerHeight = (area.height - gap * (rows - 1)) / rows;
    const cellWidth = outerWidth - inset * 2;
    const cellHeight = outerHeight - inset * 2;
    const cardWidth = cellWidth * factor;
    const candidate = { products: {}, details: {}, itemAreas: {}, arrangement: 'grid' };
    const sizes = detailTargets.map(target => measure(target, cardWidth));
    if (sizes.some(size => !size)) return;
    const detailsHeight = Math.max(...sizes.map(size => size.height));
    for (let index = 0; index < count; index++) {
      const size = sizes[index];
      if (!size || size.height >= cellHeight) return;
      const rowCount = Math.min(columns, count - Math.floor(index / columns) * columns);
      // The last row spans the same total width; its contents retain the common size.
      const slotWidth = encarte ? area.width / rowCount : outerWidth;
      const slotX = encarte ? area.x + (index % columns) * slotWidth
        : area.x + (area.width - (rowCount * outerWidth + (rowCount - 1) * gap)) / 2
          + (index % columns) * (outerWidth + gap);
      const slotY = area.y + Math.floor(index / columns) * (outerHeight + gap);
      candidate.itemAreas[products[index].target] = { x: slotX, y: slotY, width: slotWidth, height: outerHeight };
      const x = slotX + (slotWidth - cellWidth) / 2;
      const y = slotY + inset;
      const horizontal = orientation === 'horizontal';
      const imageArea = { x, y, width: horizontal ? cellWidth - cardWidth - 12 : cellWidth,
        height: horizontal ? cellHeight - 24 : cellHeight - detailsHeight - 20 };
      if (imageArea.width <= 0 || imageArea.height <= 0) return;
      candidate.products[products[index].target] = fitProduct(products[index], imageArea);
      if (horizontal) {
        const product = candidate.products[products[index].target];
        product.y = y + (cellHeight - product.width / products[index].aspectRatio) / 2;
      }
      candidate.details[detailTargets[index]] = {
        x: horizontal ? x + cellWidth - cardWidth : x + (cellWidth - cardWidth) / 2,
        y: horizontal ? y + (cellHeight - detailsHeight) / 2 : y + cellHeight - detailsHeight,
        width: cardWidth,
      };
    }
    consider(candidate, area);
  }

  for (const area of availableAreas(obstacle, SAFE_AREA)) {
    if (count > 2) {
      for (const factor of orientation === 'horizontal' ? [0.56] : [1]) grid(area, factor);
      continue;
    }
    // Remeasure each candidate: wrapping and price badges affect its height.
    if (orientation === 'vertical') {
      for (const factor of [1, 0.9, 0.8, 0.7, 0.6]) {
        vertical(area, factor);
        if (mode === 'combo') {
          vertical(area, factor, 'balanced');
          vertical(area, factor, 'stack');
        }
      }
    } else {
      for (const factor of [0.5, 0.55, 0.6]) horizontal(area, factor);
    }
  }
  // Sizes and positions are solved together, so there is no post-layout
  // shrinking that separates a product from its offer or makes text tiny.
  return best ? { ...best, orientation } : null;
}
