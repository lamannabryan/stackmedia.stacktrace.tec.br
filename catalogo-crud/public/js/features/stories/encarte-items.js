// Frame the actual edited positions so manual moves and resizes remain enclosed.
export function getEncarteItemBounds(product, details, width, height) {
  const boxes = [product, details].filter(Boolean);
  if (!boxes.length) return null;
  const padding = 10;
  const x = Math.max(3, Math.min(...boxes.map(box => box.x)) - padding);
  const y = Math.max(3, Math.min(...boxes.map(box => box.y)) - padding);
  const right = Math.min(width - 3, Math.max(...boxes.map(box => box.x + box.width)) + padding);
  const bottom = Math.min(height - 3, Math.max(...boxes.map(box => box.y + box.height)) + padding);
  return { x, y, width: right - x, height: bottom - y };
}

export function drawEncarteItemSurface(context, bounds, accent = '#0e746c') {
  // Inset each surface within its reserved cell to separate items with whitespace.
  const inset = 6;
  const x = bounds.x + inset, y = bounds.y + inset;
  const width = Math.max(1, bounds.width - inset * 2), height = Math.max(1, bounds.height - inset * 2);
  const radius = Math.min(20, width / 2, height / 2);
  context.save();
  try {
    context.shadowColor = 'transparent';
    context.shadowBlur = 0;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 0;
    context.beginPath();
    context.moveTo(x + radius, y);
    context.arcTo(x + width, y, x + width, y + height, radius);
    context.arcTo(x + width, y + height, x, y + height, radius);
    context.arcTo(x, y + height, x, y, radius);
    context.arcTo(x, y, x + width, y, radius);
    context.closePath();
    context.fillStyle = '#ffffff';
    context.fill();
    context.globalAlpha *= 0.045;
    context.fillStyle = accent;
    context.fill();
  } finally {
    context.restore();
  }
}
