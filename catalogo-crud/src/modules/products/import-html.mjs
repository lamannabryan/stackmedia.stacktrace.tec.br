import { load } from 'cheerio';
import { badRequest } from '../../http/errors.mjs';

export const PRODUCT_HTML_BODY_BYTES = 2 * 1024 * 1024;
export const PRODUCT_HTML_MAX_ITEMS = 500;
const text = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

function imageUrl(value) {
  if (!value) return '';
  if (typeof value !== 'string' || value.length > 2048) throw badRequest('Endereço da imagem inválido.');
  let url;
  try { url = new URL(value, 'https://cosmos.bluesoft.com.br'); }
  catch { throw badRequest('Endereço da imagem inválido.'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw badRequest('A imagem deve usar um endereço HTTPS público.');
  }
  // These are generic NCM illustrations / missing-photo icons, not product photos.
  if (/^\/assets\/(?:ncm\/|product-placeholder(?:[-.\/]|$))/i.test(url.pathname)) return '';
  url.hash = '';
  return url.href;
}

export function validateHtmlProduct(payload) {
  const ean = text(payload?.ean);
  const nome = text(payload?.nome);
  const fabricante = text(payload?.fabricante);
  if (!/^(?:\d{8}|\d{12,14})$/.test(ean)) throw badRequest('EAN inválido. Use 8, 12, 13 ou 14 dígitos.');
  if (!nome || nome.length > 255) throw badRequest('Nome ausente ou maior que 255 caracteres.');
  if (fabricante.length > 255) throw badRequest('Fabricante maior que 255 caracteres.');
  return { ean, nome, fabricante, imagem_url: imageUrl(payload?.imagem_url) };
}

export function parseProductHtml(payload) {
  if (typeof payload?.html !== 'string' || !payload.html.trim()) throw badRequest('Cole o HTML da lista de produtos.');
  if (Buffer.byteLength(payload.html, 'utf8') > 1024 * 1024) throw badRequest('O HTML deve ter até 1 MB.');
  if (payload.fabricante != null && typeof payload.fabricante !== 'string') throw badRequest('Informe o fabricante como texto.');
  const batchManufacturer = text(payload.fabricante);
  if (batchManufacturer.length > 255) throw badRequest('Fabricante maior que 255 caracteres.');
  const $ = load(payload.html, {}, false);
  // Parse as data only: scripts are never run and remote resources are never loaded.
  $('script, style, template, noscript').remove();
  const rows = $('#tbl-produtos > li.product-list-item');
  if (!rows.length) throw badRequest('Nenhum produto encontrado. Cole a lista completa <ul id="tbl-produtos"> com seus itens.');
  if (rows.length > PRODUCT_HTML_MAX_ITEMS) throw badRequest(`Importe até ${PRODUCT_HTML_MAX_ITEMS} produtos por vez.`);
  const items = rows.toArray().map((row, index) => {
    const item = $(row);
    const fields = item.find('.content > ul > li');
    const field = pattern => {
      const found = fields.toArray().find(node => pattern.test(text($(node).text())));
      return found ? text($(found).text()).replace(pattern, '').trim() : '';
    };
    const product = {
      // Use the explicit EAN field: image alt text can contain a padded, different code.
      ean: field(/^GTIN\s*\/\s*EAN\s*:\s*/i),
      nome: text(item.find('.content .item-title > a').first().text()),
      fabricante: batchManufacturer || field(/^Fabricante\s*:\s*/i),
      imagem_url: item.find('.picture img').first().attr('src')?.trim() || '',
    };
    try { return { position: index + 1, product: validateHtmlProduct(product), error: null }; }
    catch (error) { return { position: index + 1, product, error: error.message }; }
  });
  return { total: items.length, items };
}
