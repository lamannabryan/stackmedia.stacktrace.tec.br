import JSZip from 'jszip';

// ExcelJS expects unprefixed SpreadsheetML tags. Some valid XLSX exporters use
// x: tags instead. Preserve the XML namespace while normalizing that spelling.
export async function normalizeSpreadsheetNamespaces(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  let changed = false;
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !name.startsWith('xl/') || !name.endsWith('.xml')) continue;
    const xml = await entry.async('string');
    const declaration = 'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
    if (!xml.includes(declaration)) continue;
    zip.file(name, xml.replaceAll(declaration, 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"').replace(/(<\/?)x:/g, '$1'));
    changed = true;
  }
  return changed ? zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) : buffer;
}
