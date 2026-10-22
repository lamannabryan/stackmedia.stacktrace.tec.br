export const COMPOSITION_COUNTS = Object.freeze({ single: 1, 'two-products': 2, combo: 2,
  'three-products': 3, 'four-products': 4, 'five-products': 5 });

export function compositionTargets(mode, kind = 'product') {
  const count = kind === 'details' && mode === 'combo' ? 1 : COMPOSITION_COUNTS[mode] || 1;
  return Array.from({ length: count }, (_, index) => index === 0 ? kind : index === 1 ? `${kind}-secondary` : `${kind}-${index + 1}`);
}

export function compositionCell(format, count, index) {
  const columns = 2, rows = Math.ceil(count / columns), gap = 32;
  const width = (format.width - 112 - gap) / columns;
  const height = (format.height - Math.max(56, format.safeBottom || 0) - format.safeTop - 24 - gap * (rows - 1)) / rows;
  const lastSingle = count % 2 && index === count - 1;
  return { x: lastSingle ? (format.width - width) / 2 : 56 + (index % columns) * (width + gap),
    y: format.safeTop + 24 + Math.floor(index / columns) * (height + gap), width, height };
}
