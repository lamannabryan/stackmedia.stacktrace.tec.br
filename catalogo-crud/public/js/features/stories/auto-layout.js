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
  const bottomMargin = Math.max(MARGIN, safeBottom);
  if (![width, height, safeTop, safeBottom].every(Number.isFinite)
      || width <= MARGIN * 2 || safeTop < 0 || safeBottom < 0 || height <= safeTop + bottomMargin + 24) return null;
  const SAFE_AREA = {
    x: MARGIN, y: safeTop + 24,
    width: width - MARGIN * 2, height: height - bottomMargin - safeTop - 24,
  };
  const maximumDetailsWidth = width - 48;
  const { mode, products, measureDetails, freeTextBox = null } = options;
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
    const idealCardWidth = mode === 'two-products' ? 440 : 820;
    const textScore = detailTargets.reduce((sum, target) => sum + Math.min(1.2, candidate.details[target].width / idealCardWidth), 0) / detailTargets.length;
    const score = productScore + textScore * (mode === 'two-products' ? 0.25 : 0.2);
    if (score > bestScore + EPSILON / 100) {
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

  function rows(area, factor) {
    const height = (area.height - GAP) / 2;
    const width = area.width * factor;
    const productWidth = area.width - width - GAP;
    if (productWidth <= 0 || height <= 0) return;
    const candidate = { products: {}, details: {}, arrangement: 'rows' };
    for (const [index, product] of products.entries()) {
      const target = detailTargets[index];
      const size = measure(target, width);
      if (!size || size.height > height) return;
      const y = area.y + index * (height + GAP);
      const transform = fitProduct(product, { x: area.x, y, width: productWidth, height });
      transform.y = y + (height - transform.width / product.aspectRatio) / 2;
      candidate.products[product.target] = transform;
      candidate.details[target] = { x: area.x + productWidth + GAP, y: y + (height - size.height) / 2, width };
    }
    consider(candidate, area);
  }

  for (const area of availableAreas(obstacle, SAFE_AREA)) {
    if (count > 2) {
      const rows = Math.ceil(count / 2), cellWidth = (area.width - GAP) / 2;
      const cellHeight = (area.height - GAP * (rows - 1)) / rows;
      for (const factor of [1, 0.9, 0.8]) {
        const candidate = { products: {}, details: {}, arrangement: 'grid' };
        let fits = true;
        products.forEach((product, index) => {
          const target = detailTargets[index], width = cellWidth * factor, size = measure(target, width);
          const imageHeight = cellHeight - (size?.height || cellHeight) - GAP;
          if (!size || imageHeight < 48) { fits = false; return; }
          const x = area.x + (count % 2 && index === count - 1 ? (area.width - cellWidth) / 2 : index % 2 * (cellWidth + GAP));
          const y = area.y + Math.floor(index / 2) * (cellHeight + GAP);
          candidate.products[product.target] = fitProduct(product, { x, y, width: cellWidth, height: imageHeight });
          candidate.details[target] = { x: x + (cellWidth - width) / 2, y: y + imageHeight + GAP, width };
        });
        if (fits) consider(candidate, area);
      }
      // In the shorter Feed canvas, putting the image beside its offer keeps
      // tall packaging visible even with three rows of products.
      for (const factor of [0.56, 0.6]) {
        const candidate = { products: {}, details: {}, arrangement: 'grid-rows' };
        const width = Math.max(MIN_DETAILS_WIDTH, cellWidth * factor);
        const imageWidth = cellWidth - width - GAP;
        if (imageWidth < 48) continue;
        let fits = true;
        products.forEach((product, index) => {
          const target = detailTargets[index], size = measure(target, width);
          if (!size || size.height > cellHeight) { fits = false; return; }
          const x = area.x + (count % 2 && index === count - 1 ? (area.width - cellWidth) / 2 : index % 2 * (cellWidth + GAP));
          const y = area.y + Math.floor(index / 2) * (cellHeight + GAP);
          const transform = fitProduct(product, { x, y, width: imageWidth, height: cellHeight });
          transform.y = y + (cellHeight - transform.width / product.aspectRatio) / 2;
          candidate.products[product.target] = transform;
          candidate.details[target] = { x: x + imageWidth + GAP, y: y + (cellHeight - size.height) / 2, width };
        });
        if (fits) consider(candidate, area);
      }
      continue;
    }
    // Text wrapping can change abruptly with width, so evaluate several sizes
    // instead of assuming that a narrower card is always shorter.
    for (const factor of [1, 0.9, 0.8, 0.7, 0.6]) {
      vertical(area, factor);
      if (mode === 'combo') {
        vertical(area, factor, 'balanced');
        vertical(area, factor, 'stack');
      }
    }
    if (mode === 'two-products') {
      // Reserve at least half the row for the offer so the product image
      // does not overwhelm its description and price.
      for (const factor of [0.5, 0.55, 0.6]) rows(area, factor);
    }
  }
  // Reduce fitted images and offers once, preserving their visual centers.
  // Repeated auto-adjusts recompute the layout rather than shrinking it again.
  if (best) {
    for (const product of products) {
      const transform = best.products[product.target];
      const inset = transform.width * 0.1;
      transform.x += inset;
      transform.y += inset / product.aspectRatio;
      transform.width *= 0.8;
    }
    for (const target of detailTargets) {
      const transform = best.details[target];
      const original = measure(target, transform.width);
      // Remeasure wrapped descriptions and respect the editor's readable minimum.
      // If wrapping adds height, use the nearest smaller size that still fits.
      for (const factor of [0.8, 0.85, 0.9, 0.95]) {
        const width = Math.max(MIN_DETAILS_WIDTH, transform.width * factor);
        const size = measure(target, width);
        if (!size || size.width > original.width || size.height > original.height) continue;
        transform.x += (transform.width - width) / 2;
        transform.y += (original.height - size.height) / 2;
        transform.width = width;
        break;
      }
    }
  }
  return best;
}
