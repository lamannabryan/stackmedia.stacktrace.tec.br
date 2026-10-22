import { apiFetch, sessionReady } from '../../session.js';

const $ = id => document.getElementById(id);
const dialog = $('product-import-dialog');
const number = value => new Intl.NumberFormat('pt-BR').format(value);
let working = false, uploaded = null, preview = null;

function node(tag, text) {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}

function busy(value) {
  working = value;
  for (const id of ['product-import-file', 'analyze-product-import', 'close-product-import']) $(id).disabled = value;
  $('confirm-product-import').disabled = value || !uploaded || !preview?.summary.newProducts;
  dialog.setAttribute('aria-busy', String(value));
}

function reset() {
  uploaded = null;
  preview = null;
  $('product-import-preview').hidden = true;
  $('confirm-product-import').disabled = true;
  $('product-import-status').textContent = '';
}

async function request(url, file) {
  const response = await apiFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Não foi possível importar a planilha.');
  return result;
}

function render(result, saved = false) {
  const { summary: s, items, issues } = result;
  const skipped = s.existing + s.duplicates + s.invalid;
  $('product-import-preview').hidden = false;
  $('product-import-detected-columns').textContent = `Colunas identificadas: EAN em ${result.columns.ean}, Nome em ${result.columns.nome} e Fabricante em ${result.columns.fabricante}.`;
  $('product-import-summary').textContent = `Aba ${result.sheet}: ${number(s.total)} linha(s). ${number(s.newProducts)} produto(s) ${saved ? 'importado(s)' : 'novo(s)'}, ${number(s.existing)} já cadastrado(s), ${number(s.duplicates)} repetido(s) e ${number(s.invalid)} com dados inválidos.`;
  $('product-import-issues-section').hidden = !skipped;
  $('product-import-issues-title').textContent = `${number(skipped)} linha(s) ${saved ? 'ignorada(s)' : 'serão ignoradas'}`;
  $('product-import-issues').replaceChildren(...issues.map(issue => node('li', `Linha ${issue.row}${issue.ean ? ` · ${issue.ean}` : ''}: ${issue.message}`)));
  $('product-import-issues-limit').textContent = skipped > issues.length ? `Exibindo as primeiras ${number(issues.length)} ocorrências. Corrija a planilha e analise novamente para conferir as demais.` : '';
  $('product-import-items-title').textContent = saved ? 'Produtos importados' : 'Novos produtos';
  $('product-import-items').replaceChildren(...items.map(item => {
    const row = document.createElement('tr');
    row.append(...[item.row, item.ean, item.nome, item.fabricante || '—'].map(value => node('td', value)));
    return row;
  }));
  $('product-import-preview-limit').textContent = s.newProducts > items.length
    ? `Exibindo os primeiros ${number(items.length)} de ${number(s.newProducts)} produtos. ${saved ? 'Todos foram importados.' : 'Todos os novos produtos válidos serão importados.'}`
    : s.newProducts ? '' : 'Nenhum produto novo para importar.';
  $('confirm-product-import').hidden = saved || !s.newProducts;
  $('confirm-product-import').textContent = `Importar ${number(s.newProducts)} produto(s) novo(s)`;
}

$('import-products-button').addEventListener('click', () => dialog.showModal());
$('close-product-import').addEventListener('click', () => { if (!working) dialog.close(); });
dialog.addEventListener('cancel', event => { if (working) event.preventDefault(); });
$('product-import-file').addEventListener('change', reset);
$('product-import-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (working) return;
  const file = $('product-import-file').files[0];
  reset();
  if (!file || !/\.xlsx$/i.test(file.name) || file.size > 10 * 1024 * 1024) {
    $('product-import-status').textContent = 'Selecione um arquivo .xlsx de até 10 MB.'; return;
  }
  busy(true);
  $('product-import-status').textContent = 'Lendo a planilha e conferindo os EANs no catálogo…';
  try {
    const encoded = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reader.onabort = () => reject(new Error('Não foi possível ler o arquivo. Selecione a planilha novamente.'));
      reader.readAsDataURL(file);
    });
    preview = await request('/api/products/import/preview', encoded);
    uploaded = encoded;
    render(preview);
    $('product-import-status').textContent = preview.summary.newProducts
      ? 'Confira a prévia e clique em importar para adicionar os novos produtos.' : 'Análise concluída. Nenhum produto novo pode ser importado deste arquivo.';
    $('product-import-status').scrollIntoView({ block: 'start' });
  } catch (error) { reset(); $('product-import-status').textContent = error.message; }
  finally { busy(false); }
});

$('confirm-product-import').addEventListener('click', async () => {
  if (working || !uploaded || !preview?.summary.newProducts) return;
  busy(true);
  $('product-import-status').textContent = 'Adicionando os novos produtos ao catálogo…';
  try {
    const result = await request('/api/products/import', uploaded);
    uploaded = null;
    preview = null;
    render(result, true);
    $('product-import-status').textContent = `${number(result.imported)} produto(s) adicionado(s).${result.imported ? ' Feche esta janela para consultar o catálogo, agora filtrado por produtos sem imagem.' : ' Os EANs já cadastrados foram mantidos.'}`;
    $('product-import-status').scrollIntoView({ block: 'start' });
    if (result.imported) dialog.dispatchEvent(new CustomEvent('products-imported'));
  } catch (error) { $('product-import-status').textContent = error.message; }
  finally { busy(false); }
});

sessionReady.then(({ user }) => { $('import-products-button').hidden = user.role !== 'administrador'; }).catch(() => {});
