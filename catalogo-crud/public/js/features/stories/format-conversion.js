import { getArtworkFormat } from './formats.js';

export function otherArtworkFormat(name) {
  if (!['stories', 'feed', 'encarte'].includes(name)) throw new Error('Formato de arte inválido.');
  return name === 'feed' ? 'stories' : 'feed';
}

/** Scale positions and sizes uniformly inside the usable area, without stretching images. */
export function convertArtworkTransforms(transforms, sourceName, targetName) {
  otherArtworkFormat(sourceName);
  otherArtworkFormat(targetName);
  const source = getArtworkFormat(sourceName);
  const target = getArtworkFormat(targetName);
  const sourceHeight = source.height - source.safeTop - source.safeBottom;
  const targetHeight = target.height - target.safeTop - target.safeBottom;
  const scale = Math.min(target.width / source.width,
    targetHeight / sourceHeight);
  const offsetX = (target.width - source.width * scale) / 2;
  const offsetY = target.safeTop + (targetHeight - sourceHeight * scale) / 2;
  return Object.fromEntries(Object.entries(transforms).map(([key, transform]) => {
    if (!transform) return [key, null];
    if (![transform.x, transform.y, transform.width].every(Number.isFinite) || transform.width <= 0) {
      throw new Error('A posição de um elemento da arte é inválida.');
    }
    return [key, {
      x: offsetX + transform.x * scale,
      y: offsetY + (transform.y - source.safeTop) * scale,
      width: transform.width * scale,
    }];
  }));
}

function backgroundKey(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\.(png|jpe?g|webp)$/i, '').replace(/^gabarito[\s_-]+/i, '')
    .replace(/[\s_-]+(?:feed|stories|story|encarte)$/i, '').replace(/[\s_-]+/g, ' ').trim().toLowerCase();
}

/** Prefer the matching template; never silently replace a campaign with an unrelated one. */
export function findConvertedBackground(current, backgrounds) {
  if (!current) return null;
  for (const field of ['nome', 'arquivo']) {
    const key = backgroundKey(current[field]);
    if (!key) continue;
    const matches = backgrounds.filter(item => backgroundKey(item[field]) === key);
    if (matches.length === 1) return matches[0];
  }
  return null;
}
