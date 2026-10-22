import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { badRequest } from '../../http/errors.mjs';

const MAX_LOGO_BYTES = 4 * 1024 * 1024;
export const PARTNER_BODY_BYTES = 6 * 1024 * 1024;

function partnerSlot(value) {
  if (!/^[123]$/.test(String(value))) throw badRequest('Escolha uma das três posições de destaque.');
  return Number(value);
}

async function decodeLogo(value) {
  if (typeof value !== 'string') throw badRequest('Envie um logotipo PNG, JPG ou WebP.');
  const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw badRequest('Envie um logotipo PNG, JPG ou WebP válido.');
  const buffer = Buffer.from(match[1], 'base64');
  if (!buffer.length || buffer.length > MAX_LOGO_BYTES) throw badRequest('O logotipo deve ter até 4 MB.');
  try {
    const input = sharp(buffer, { limitInputPixels: 16_000_000, failOn: 'warning' });
    const metadata = await input.metadata();
    if (!['png', 'jpeg', 'webp'].includes(metadata.format) || (metadata.pages || 1) !== 1) {
      throw new Error('Unsupported image');
    }
    // Decode and re-encode uploads: keep transparency, strip metadata and never
    // expose original filenames or executable/vector content as public assets.
    return await input.rotate().resize({ width: 1200, height: 800, fit: 'inside', withoutEnlargement: true })
      .webp({ lossless: true }).toBuffer();
  } catch {
    throw badRequest('Não foi possível ler o logotipo. Use uma imagem estática PNG, JPG ou WebP de até 16 megapixels.');
  }
}

export function createPartnerService({ database, logosDirectory }) {
  function listManufacturers() {
    return database.prepare(`
      SELECT TRIM(fabricante) AS nome, COUNT(*) AS total FROM products
      WHERE TRIM(COALESCE(fabricante, '')) != ''
      GROUP BY TRIM(fabricante) COLLATE NOCASE ORDER BY nome COLLATE NOCASE
    `).all();
  }

  function serialize(row) {
    return {
      slot: row.slot,
      fabricante: row.fabricante,
      logo_url: `/partner-logos/${row.logo_file}`,
      total: database.prepare('SELECT COUNT(*) AS total FROM products WHERE TRIM(fabricante) = ? COLLATE NOCASE')
        .get(row.fabricante).total,
    };
  }

  function listPartners() {
    return database.prepare('SELECT * FROM featured_partners ORDER BY slot').all().map(serialize);
  }

  async function removeLogo(filename) {
    if (filename && /^[\da-f-]{36}\.webp$/.test(filename)) {
      await fs.unlink(path.join(logosDirectory, filename)).catch(() => {});
    }
  }

  async function savePartner(slotValue, payload) {
    const slot = partnerSlot(slotValue);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof payload.fabricante !== 'string') {
      throw badRequest('Selecione um fabricante do catálogo.');
    }
    const manufacturer = database.prepare(`
      SELECT TRIM(fabricante) AS nome FROM products
      WHERE TRIM(fabricante) != '' AND TRIM(fabricante) = ? COLLATE NOCASE LIMIT 1
    `).get(payload.fabricante.trim());
    if (!manufacturer) throw badRequest('Selecione um fabricante existente no catálogo.');

    let newFile;
    try {
      if (Object.hasOwn(payload, 'logo')) {
        const buffer = await decodeLogo(payload.logo);
        await fs.mkdir(logosDirectory, { recursive: true });
        newFile = `${randomUUID()}.webp`;
        await fs.writeFile(path.join(logosDirectory, newFile), buffer, { flag: 'wx' });
      }
      // Re-read after asynchronous image work so concurrent saves cannot exceed
      // the three slots, reuse a removed logo or feature a manufacturer twice.
      const existing = database.prepare('SELECT * FROM featured_partners WHERE slot = ?').get(slot);
      const duplicate = database.prepare('SELECT slot FROM featured_partners WHERE fabricante = ? AND slot != ?')
        .get(manufacturer.nome, slot);
      if (duplicate) throw badRequest(`Este fabricante já está no destaque ${duplicate.slot}.`);
      if (!newFile && !existing) throw badRequest('Envie um logotipo para cadastrar este destaque.');
      const logoFile = newFile || existing.logo_file;
      database.prepare(`
        INSERT INTO featured_partners (slot, fabricante, logo_file, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(slot) DO UPDATE SET fabricante = excluded.fabricante,
          logo_file = excluded.logo_file, updated_at = excluded.updated_at
      `).run(slot, manufacturer.nome, logoFile, new Date().toISOString());
      const result = serialize({ slot, fabricante: manufacturer.nome, logo_file: logoFile });
      if (newFile && existing) await removeLogo(existing.logo_file);
      return result;
    } catch (error) {
      if (newFile) await removeLogo(newFile);
      throw error;
    }
  }

  async function deletePartner(slotValue) {
    const slot = partnerSlot(slotValue);
    const existing = database.prepare('SELECT logo_file FROM featured_partners WHERE slot = ?').get(slot);
    database.prepare('DELETE FROM featured_partners WHERE slot = ?').run(slot);
    if (existing) await removeLogo(existing.logo_file);
  }

  return { listManufacturers, listPartners, savePartner, deletePartner };
}
