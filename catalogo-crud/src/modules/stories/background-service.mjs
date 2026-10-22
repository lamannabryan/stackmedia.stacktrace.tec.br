import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { badRequest, HttpError } from '../../http/errors.mjs';
import { fileVersion } from '../../http/file-version.mjs';

export const storyBackgroundExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp']);
export const BACKGROUND_BODY_BYTES = 15 * 1024 * 1024;

function makeStoryBackgroundUrl(backgroundFile, urlPrefix) {
  return `${urlPrefix}/${backgroundFile.split('/').map(encodeURIComponent).join('/')}`;
}

function storyBackgroundLabel(backgroundFile, format) {
  const formatSuffix = format === 'indoor-h'
    ? /(?:[_\s-]+indoor(?:[_\s-]+h(?:orizontal)?)?|[_\s-]+df\s*-\s*prec\s+tv)$/i
    : format === 'feed' ? /(?:[_\s-]+feed)$/i : /(?:[_\s-]+stories?)$/i;
  const name = path.basename(backgroundFile, path.extname(backgroundFile))
    .replace(/--[a-f0-9-]{36}$/, '')
    .replace(/^gabarito\s+/i, '')
    .replace(formatSuffix, '')
    .replace(/_/g, ' ')
    .replace(/\s+-\s+$/g, '')
    .trim()
    .toLocaleLowerCase('pt-BR');

  if (!name) {
    if (format === 'indoor-h') return 'Background para Indoor';
    return format === 'feed' ? 'Background para Feed' : 'Background para Story';
  }

  return name
    .split(' ')
    .map((word) => (word.length <= 2 ? word.toUpperCase() : `${word[0].toLocaleUpperCase('pt-BR')}${word.slice(1)}`))
    .join(' ');
}

export function isSupportedStoryBackground(filePath) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(filePath);
  } catch {
    return false;
  }

  return path.basename(decodedPath) === decodedPath
    && storyBackgroundExtensions.has(path.extname(decodedPath).toLowerCase());
}

export function createStoryBackgroundService({ storyBackgroundsDirectory, format = 'stories', urlPrefix = '/story-backgrounds' }) {
  async function listStoryBackgrounds() {
    if (!existsSync(storyBackgroundsDirectory)) return [];

    const entries = await fs.readdir(storyBackgroundsDirectory, { withFileTypes: true });
    const backgrounds = await Promise.all(entries
      .filter((entry) => entry.isFile() && isSupportedStoryBackground(entry.name))
      .map(async (entry) => {
        try {
          const info = await fs.stat(path.join(storyBackgroundsDirectory, entry.name));
          return {
            arquivo: entry.name,
            nome: storyBackgroundLabel(entry.name, format),
            url: `${makeStoryBackgroundUrl(entry.name, urlPrefix)}?v=${fileVersion(info)}`,
            thumbnail_url: `${makeStoryBackgroundUrl(entry.name, urlPrefix)}?v=${fileVersion(info)}&variant=thumb-v1`,
            preview_url: `${makeStoryBackgroundUrl(entry.name, urlPrefix)}?v=${fileVersion(info)}&variant=render-v1`,
          };
        } catch (error) {
          if (error.code === 'ENOENT') return null;
          throw error;
        }
      }));
    return backgrounds.filter(Boolean)
      .sort((first, second) => first.nome.localeCompare(second.nome, 'pt-BR'));
  }

  async function addBackground(payload) {
    if (!payload || typeof payload.nome !== 'string' || !payload.nome.trim() || payload.nome.trim().length > 80) {
      throw badRequest('Informe um nome de até 80 caracteres.');
    }
    const match = typeof payload.imagem === 'string' && /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(payload.imagem);
    if (!match) throw badRequest('Envie uma imagem PNG, JPG ou WebP.');
    const buffer = Buffer.from(match[1], 'base64');
    if (!buffer.length || buffer.length > 10 * 1024 * 1024) throw badRequest('A imagem deve ter até 10 MB.');
    let image;
    try {
      const input = sharp(buffer, { limitInputPixels: 40_000_000, failOn: 'warning' });
      const metadata = await input.metadata();
      if (!['png', 'jpeg', 'webp'].includes(metadata.format) || (metadata.pages || 1) !== 1) throw new Error('Invalid image');
      image = await input.rotate().webp({ quality: 95 }).toBuffer();
    } catch {
      throw badRequest('Use uma imagem estática PNG, JPG ou WebP de até 40 megapixels.');
    }
    const name = payload.nome.trim().normalize('NFC').replace(/[^\p{L}\p{N} -]/gu, '').trim();
    if (!name) throw badRequest('O nome deve conter letras ou números.');
    const filename = `${name}--${randomUUID()}.webp`;
    await fs.mkdir(storyBackgroundsDirectory, { recursive: true });
    await fs.writeFile(path.join(storyBackgroundsDirectory, filename), image, { flag: 'wx' });
    return (await listStoryBackgrounds()).find(item => item.arquivo === filename);
  }

  async function removeBackground(filename) {
    if (typeof filename !== 'string' || /[\\/%:\x00-\x1f]/.test(filename) || !isSupportedStoryBackground(filename)) {
      throw badRequest('Background inválido.');
    }
    const target = path.join(storyBackgroundsDirectory, filename);
    try {
      const info = await fs.lstat(target);
      if (!info.isFile() || info.isSymbolicLink()) throw badRequest('Background inválido.');
      await fs.unlink(target);
    } catch (error) {
      if (error.code === 'ENOENT') throw new HttpError(404, 'Background não encontrado.');
      throw error;
    }
  }

  return { listStoryBackgrounds, addBackground, removeBackground };
}
