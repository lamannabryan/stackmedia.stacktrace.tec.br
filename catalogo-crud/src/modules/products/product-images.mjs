import { statSync } from 'node:fs';
import path from 'node:path';
import { fileVersion } from '../../http/file-version.mjs';

export function productImageUrl(filename, imagesDirectory) {
  const url = `/assets/${filename.split('/').map(encodeURIComponent).join('/')}`;
  if (!imagesDirectory) return url;
  try {
    const info = statSync(path.join(imagesDirectory, filename));
    return info.isFile() ? `${url}?v=${fileVersion(info)}` : url;
  } catch {
    return url;
  }
}

function isUsableFile(filename) {
  try {
    const info = statSync(filename, { throwIfNoEntry: false });
    return Boolean(info?.isFile() && info.size > 0);
  } catch {
    return false;
  }
}

/** Resolve old catalogue paths without changing SQLite or the import manifest. */
export function resolveProductImage(imagesDirectory, filename) {
  if (typeof filename !== 'string' || !filename.startsWith('imagens/')) return null;
  if (filename.split('/').some((part) => !part || part.startsWith('.') || /[\\:\0]/.test(part))) return null;

  if (/\.png$/i.test(filename)) {
    const basename = filename.slice(0, -4);
    // Some batch converters append _resultado; the unchanged base name wins.
    for (const candidate of [`${basename}.webp`, `${basename}_resultado.webp`]) {
      if (isUsableFile(path.join(imagesDirectory, candidate))) return candidate;
    }
  }
  return filename;
}
