import { readProductUpload } from './import-xlsx.mjs';

const PREVIEW_LIMIT = 100;

export function createProductImportService({ database, productService }) {
  function analyze({ sheet, columns, rows }) {
    const existing = new Set(database.prepare("SELECT ean FROM products WHERE ean IS NOT NULL AND ean != ''").all().map(row => String(row.ean).trim()));
    const seen = new Set(), products = [], issues = [];
    const summary = { total: rows.length, newProducts: 0, existing: 0, duplicates: 0, invalid: 0 };
    function skip(row, ean, kind, message) {
      summary[kind]++;
      if (issues.length < PREVIEW_LIMIT) issues.push({ row, ean: ean || '', message });
    }
    for (const { number: row, values: [ean, nome, fabricante] } of rows) {
      if (typeof ean !== 'string' || !/^(?:\d{8}|\d{12,14})$/.test(ean)) {
        skip(row, ean, 'invalid', `EAN inválido na coluna ${columns.ean} (code). Use 8, 12, 13 ou 14 dígitos, sem fórmulas.`); continue;
      }
      if (existing.has(ean)) { skip(row, ean, 'existing', 'EAN já cadastrado. O produto existente será mantido.'); continue; }
      if (seen.has(ean)) { skip(row, ean, 'duplicates', 'EAN repetido na planilha. Será usada a primeira linha válida.'); continue; }
      if (!nome || typeof nome !== 'string' || nome.length > 255) {
        skip(row, ean, 'invalid', `Nome ausente ou inválido na coluna ${columns.nome} (product_name_pt). Use texto com até 255 caracteres.`); continue;
      }
      if (typeof fabricante !== 'string' || fabricante.length > 255) {
        skip(row, ean, 'invalid', `Fabricante inválido na coluna ${columns.fabricante} (brands). Use texto com até 255 caracteres.`); continue;
      }
      seen.add(ean);
      products.push({ row, ean, nome, fabricante });
    }
    summary.newProducts = products.length;
    return { sheet, columns, summary, products, issues };
  }

  function report(analysis) {
    const { sheet, columns, summary, products, issues } = analysis;
    return { sheet, columns, summary, items: products.slice(0, PREVIEW_LIMIT), issues, previewLimit: PREVIEW_LIMIT };
  }

  return {
    async preview(payload) { return report(analyze(await readProductUpload(payload))); },
    async save(payload) {
      const parsed = await readProductUpload(payload);
      // Recheck EANs under the write lock: repeated or concurrent uploads cannot
      // insert duplicates, and any failure rolls back the entire batch.
      database.exec('BEGIN IMMEDIATE');
      try {
        const analysis = analyze(parsed);
        for (const { ean, nome, fabricante } of analysis.products) {
          productService.createProduct({ ean, nome, fabricante, status: 'ativo' });
        }
        database.exec('COMMIT');
        return { ...report(analysis), imported: analysis.products.length };
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
