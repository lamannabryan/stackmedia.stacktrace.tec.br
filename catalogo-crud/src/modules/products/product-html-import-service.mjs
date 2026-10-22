import { HttpError } from '../../http/errors.mjs';
import { downloadPublicImage } from './google-image-search.mjs';
import { parseProductHtml, validateHtmlProduct } from './import-html.mjs';

class ExistingProduct extends Error {}

export function createProductHtmlImportService({ database, productService, imageUpload, download = downloadPublicImage }) {
  let active = 0;
  let existingQuery;
  const exists = ean => (existingQuery ||= database.prepare("SELECT id FROM products WHERE trim(ean) = ? LIMIT 1")).get(ean);
  const ignored = () => ({ status: 'ignored', image: false, message: 'EAN já cadastrado. Produto existente mantido.' });

  async function save(payload) {
    const { imagem_url: url, ...product } = validateHtmlProduct(payload);
    if (exists(product.ean)) return ignored();
    if (active >= 3) throw new HttpError(429, 'Há outras importações em andamento. Tente novamente em alguns segundos.');
    active++;
    try {
      function persist(values) {
        // Downloading is asynchronous. Recheck under a write lock to avoid races
        // with another import, including an XLSX import in a different process.
        database.exec('BEGIN IMMEDIATE');
        try {
          if (exists(product.ean)) throw new ExistingProduct();
          const saved = productService.createProduct({ ...values, status: 'ativo' });
          database.exec('COMMIT');
          return saved;
        } catch (error) { database.exec('ROLLBACK'); throw error; }
      }
      let saved;
      if (url) {
        let source;
        try { source = await download(url); }
        catch {
          return { status: 'error', image: false, message: 'Não foi possível baixar a imagem. Produto não cadastrado; tente importar novamente.' };
        }
        saved = await imageUpload.saveBuffer(source, product, persist, { removeBackground: true });
      } else {
        saved = persist(product);
      }
      return { status: 'imported', id: saved.id, image: Boolean(url), message: url
        ? 'Cadastrado com imagem.' : 'Cadastrado sem imagem: a origem não contém uma foto do produto.' };
    } catch (error) {
      if (error instanceof ExistingProduct) return ignored();
      if (error instanceof HttpError && error.statusCode === 400) {
        return { status: 'error', image: false, message: `${error.message} Produto não cadastrado.` };
      }
      throw error;
    } finally { active--; }
  }
  return { parse: parseProductHtml, save };
}
