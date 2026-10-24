export function normalizeOfferQuantity(value) {
  const quantity = Number(value);
  return Number.isFinite(quantity) ? Math.max(1, Math.min(99, Math.trunc(quantity))) : 1;
}

export function offerQuantity(state, formatName, target = 'product') {
  if (!['feed', 'stories'].includes(formatName) || !['single', 'two-products'].includes(state.compositionMode)) return 1;
  return normalizeOfferQuantity(target.endsWith('-secondary') ? state.secondaryOfferQuantity : state.offerQuantity);
}

function quantityStack(quantity) {
  const count = normalizeOfferQuantity(quantity);
  // Keep a compact stack even for large offers, with every copy still offset.
  const depth = Math.min(count - 1, 4);
  return { count, horizontalSpread: depth * 0.32, verticalSpread: depth * 0.08 };
}

export function quantityAspectRatio(imageRatio, quantity) {
  const { horizontalSpread, verticalSpread } = quantityStack(quantity);
  return imageRatio * (1 + horizontalSpread) / (1 + verticalSpread);
}

// Paint back to front: the rear units peek out above and to the right of the
// foreground product. The complete stack stays inside the editable group box.
export function quantityImageBoxes(bounds, quantity) {
  const { count, horizontalSpread, verticalSpread } = quantityStack(quantity);
  if (count === 1) return [{ ...bounds }];
  const width = bounds.width / (1 + horizontalSpread);
  const height = bounds.height / (1 + verticalSpread);
  return Array.from({ length: count }, (_, index) => {
    const progress = index / (count - 1);
    return {
      x: bounds.x + (bounds.width - width) * (1 - progress),
      y: bounds.y + (bounds.height - height) * progress,
      width,
      height,
    };
  });
}
