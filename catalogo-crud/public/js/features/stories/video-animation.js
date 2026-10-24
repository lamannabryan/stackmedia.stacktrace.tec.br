import { drawEncarteItemSurface } from './encarte-items.js';

export const STORY_VIDEO_DURATION_SECONDS = 15;

const ENTRANCE_DURATION = 0.9;
const EXIT_START = 13.5;
const EXIT_DURATION = 0.9;

function smoothStep(value) {
  const progress = Math.max(0, Math.min(1, value));
  return progress * progress * (3 - 2 * progress);
}

/** Returns deterministic canvas transforms, with an unchanged reading interval. */
export function getStoryVideoLayerState(layer, seconds) {
  const time = Math.max(0, Math.min(STORY_VIDEO_DURATION_SECONDS, Number(seconds) || 0));
  const index = Math.max(0, Math.min(4, Number(layer.index) || 0));
  const direction = index % 2 ? 1 : -1;
  const kind = layer.kind;
  const delay = kind === 'product' ? 0 : kind === 'details' ? 0.22 : 0.46;
  const entrance = smoothStep((time - delay - index * 0.16) / ENTRANCE_DURATION);
  const exit = smoothStep((time - EXIT_START - delay * 0.5 - index * 0.08) / EXIT_DURATION);
  const entering = 1 - entrance;
  const product = kind === 'product';
  const details = kind === 'details';
  const horizontalDistance = product ? 52 * entering + 36 * exit : 0;

  return {
    opacity: entrance * (1 - exit),
    translateX: horizontalDistance === 0 ? 0 : direction * horizontalDistance,
    translateY: (product ? 42 : details ? 58 : 34) * entering - (product ? 38 : details ? 42 : 24) * exit,
    scale: 1 - (product ? 0.06 : details ? 0.02 : 0.03) * entering - 0.02 * exit,
  };
}

// Keep the whole flyer readable while each product and its offer take a turn.
export function getEncarteVideoLayerState(layer, seconds, itemCount) {
  const still = { opacity: 1, translateX: 0, translateY: 0, scale: 1, focus: 0 };
  if (!['product', 'details'].includes(layer.kind)) return still;
  const count = Math.max(1, Math.min(5, Number(itemCount) || 1));
  const time = Math.max(0, Math.min(STORY_VIDEO_DURATION_SECONDS, Number(seconds) || 0));
  const slotDuration = STORY_VIDEO_DURATION_SECONDS / count;
  // Crossfade adjacent highlights so the sequence never pauses with every item dimmed.
  const entrance = layer.index === 0 ? 1 : smoothStep((time - layer.index * slotDuration + 0.3) / 0.6);
  const exit = layer.index === count - 1 ? 1 : smoothStep(((layer.index + 1) * slotDuration - time + 0.3) / 0.6);
  const focus = entrance * exit;
  const emphasis = smoothStep(time / 0.6) * smoothStep((STORY_VIDEO_DURATION_SECONDS - time) / 0.6);
  if (count === 1) {
    return { ...still, scale: 0.94 + 0.06 * emphasis, focus };
  }
  return {
    ...still,
    scale: 1 - 0.1 * (1 - focus) * emphasis,
    opacity: 1 - 0.45 * (1 - focus) * emphasis,
    focus,
  };
}

/**
 * Draws full-size transparent layers over the fixed, opaque artwork background.
 * Layer bounds provide the animation pivot; painting order and blending are
 * preserved so the middle of the video matches the static artwork exactly.
 */
export function drawStoryVideoFrame(context, snapshot, seconds) {
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
    context.clearRect(0, 0, snapshot.width, snapshot.height);
    context.drawImage(snapshot.background, 0, 0);

    for (const layer of snapshot.layers) {
      const animation = snapshot.format === 'encarte'
        ? getEncarteVideoLayerState(layer, seconds, snapshot.itemCount)
        : getStoryVideoLayerState(layer, seconds);
      if (animation.opacity <= 0) continue;

      context.save();
      try {
        context.globalAlpha = animation.opacity;
        context.globalCompositeOperation = layer.compositeOperation || 'source-over';
        if (animation.translateX !== 0 || animation.translateY !== 0 || animation.scale !== 1) {
          const bounds = layer.animationBounds || layer.bounds;
          const centerX = bounds.x + bounds.width / 2;
          const centerY = bounds.y + bounds.height / 2;
          context.translate(centerX + animation.translateX, centerY + animation.translateY);
          context.scale(animation.scale, animation.scale);
          context.translate(-centerX, -centerY);
        }
        if (layer.kind === 'item-surface') {
          drawEncarteItemSurface(context, layer.bounds, layer.accent);
        } else {
          context.drawImage(layer.canvas, 0, 0);
        }
      } finally {
        context.restore();
      }
    }
  } finally {
    context.restore();
  }
}
