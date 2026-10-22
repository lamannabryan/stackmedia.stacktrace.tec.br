import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { badRequest, HttpError } from '../../http/errors.mjs';
import { removeWhiteBackground } from './white-background.mjs';

export const PRODUCT_IMAGE_BODY_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export function createProductImageUpload({ imagesDirectory, imageSearch }) {
  let active = 0;
  async function withSlot(work) {
    if (active >= 3) throw new HttpError(429, 'Aguarde alguns segundos e tente salvar novamente.');
    active++;
    try { return await work(); } finally { active--; }
  }
  async function persistImage(source, payload, saveProduct, removeBackground = false) {
    if (!source.length || source.length > MAX_IMAGE_BYTES) throw badRequest('A imagem deve ter até 8 MB.');
    let buffer;
    try {
      const image = sharp(source, { limitInputPixels: 25_000_000, failOn: 'warning' });
      const metadata = await image.metadata();
      if (!['png', 'jpeg', 'webp'].includes(metadata.format) || (metadata.pages || 1) !== 1) throw new Error('Invalid image');
      const normalized = image.rotate().resize(2000, 2000, { fit: 'inside', withoutEnlargement: true });
      if (removeBackground) {
        const { data, info } = await normalized.toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const cutout = await removeWhiteBackground(data, info);
        buffer = await sharp(cutout, { raw: { width: info.width, height: info.height, channels: 4 } })
          .webp({ quality: 92, alphaQuality: 100 }).toBuffer();
      } else {
        buffer = await normalized.webp({ quality: 92 }).toBuffer();
      }
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw badRequest('Use uma imagem estática PNG, JPG ou WebP de até 25 megapixels.');
    }
    const filename = `imagens/produto-${randomUUID()}.webp`;
    const target = path.join(imagesDirectory, filename);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, buffer, { flag: 'wx' });
    try {
      const product = saveProduct({ ...payload, imagem_arquivo: filename });
      if (!product) throw new HttpError(404, 'Produto não encontrado.');
      return product;
    } catch (error) {
      await fs.unlink(target);
      throw error;
    }
  }
  async function saveWithImage(payload, saveProduct, owner) {
    if (payload?.imagem_busca_token && !imageSearch) throw badRequest('Atualize a página e busque as imagens novamente.');
    if (payload?.imagem_busca_token && payload?.imagem_upload) throw badRequest('Escolha apenas uma imagem.');
    if (!payload?.imagem_upload && !payload?.imagem_busca_token) return saveProduct(payload);
    return withSlot(async () => {
      const match = typeof payload.imagem_upload === 'string'
        && /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(payload.imagem_upload);
      if (!match && !payload.imagem_busca_token) throw badRequest('Envie uma imagem PNG, JPG ou WebP.');
      const source = payload.imagem_busca_token
        ? await imageSearch.resolveSelection(payload.imagem_busca_token, String(payload.ean || '').replace(/[\s-]/g, ''), owner)
        : Buffer.from(match[1], 'base64');
      return persistImage(source, payload, saveProduct, Boolean(payload.imagem_busca_token));
    });
  }
  return {
    saveWithImage,
    saveBuffer: (source, payload, saveProduct, { removeBackground = false } = {}) =>
      withSlot(() => persistImage(source, payload, saveProduct, removeBackground)),
  };
}
