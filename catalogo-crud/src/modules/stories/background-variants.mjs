import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { fileVersion } from '../../http/file-version.mjs';
import { resolveStaticFile } from '../../http/static-files.mjs';
import { HttpError } from '../../http/errors.mjs';

// One conversion at a time across all formats, rather than one per thumbnail.
let queue = Promise.resolve();
const pending = new Map();
sharp.cache({ memory: 16, files: 0, items: 16 });

export async function backgroundVariant({ rootDirectory, urlPath, variant, cacheDirectory, format }) {
  if (!['thumb-v1', 'render-v1'].includes(variant)) throw new HttpError(400, 'Versão de fundo inválida.');
  const source = resolveStaticFile(rootDirectory, urlPath);
  if (!source) throw new HttpError(403, 'Caminho não permitido.');
  let info;
  try { info = await fs.stat(source); } catch (error) {
    if (error.code === 'ENOENT') throw new HttpError(404, 'Fundo não encontrado.');
    throw error;
  }
  if (!info.isFile()) throw new HttpError(404, 'Fundo não encontrado.');
  const version = fileVersion(info);
  const hash = (value) => createHash('sha256').update(value).digest('hex').slice(0, 24);
  const prefix = `${hash(`${source}:${format}:${variant}`)}-`;
  const filename = `${prefix}${hash(version)}.webp`;
  const output = path.join(cacheDirectory, filename);
  const result = { rootDirectory: cacheDirectory, urlPath: filename, cacheVersion: version };
  try { await fs.access(output); return result; } catch { /* Generate on demand. */ }
  if (!pending.has(output)) {
    if (pending.size >= 64) throw new HttpError(503, 'Preparando fundos. Tente novamente em instantes.', { expose: true });
    const job = queue.catch(() => {}).then(async () => {
      await fs.mkdir(cacheDirectory, { recursive: true });
      const temporary = `${output}.${randomUUID()}.tmp`;
      const bounds = variant === 'thumb-v1' ? [240, 240]
        : format === 'indoor-h' ? [1920, 1080] : format === 'feed' ? [1080, 1350] : [1080, 1920];
      try {
        await sharp(source, { limitInputPixels: 64_000_000, sequentialRead: true })
          .rotate().resize(bounds[0], bounds[1], { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: variant === 'thumb-v1' ? 72 : 92 })
          .toFile(temporary);
        await fs.rename(temporary, output);
        // Discard only older generated versions of this exact source/variant.
        for (const name of await fs.readdir(cacheDirectory)) {
          if (name.startsWith(prefix) && name.endsWith('.webp') && name !== filename) {
            await fs.unlink(path.join(cacheDirectory, name)).catch(() => {});
          }
        }
      } catch (error) {
        await fs.unlink(temporary).catch(() => {});
        throw new HttpError(422, 'Não foi possível preparar este fundo. Verifique o arquivo da imagem.', { cause: error });
      }
      return result;
    });
    pending.set(output, job);
    queue = job;
    job.finally(() => pending.delete(output)).catch(() => {});
  }
  return pending.get(output);
}
