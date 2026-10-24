import { apiFetch } from './session.js';

const form = document.querySelector('#import-form');
const input = document.querySelector('#product-html');
const manufacturer = document.querySelector('#batch-manufacturer');
const button = document.querySelector('#import-submit');
const errorBox = document.querySelector('#import-error');
const progress = document.querySelector('#import-progress');
const bar = document.querySelector('#progress-bar');
const count = document.querySelector('#progress-count');
const title = document.querySelector('#progress-title');
const status = document.querySelector('#progress-status');
const report = document.querySelector('#import-report');
const labels = { imported: 'Cadastrado', ignored: 'Ignorado', error: 'Erro', pending: 'Pendente' };
let running = false;

async function post(route, payload) {
  const response = await apiFetch(`/api/products/import-html/${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.error || 'Não foi possível comunicar com o servidor.');
  return result;
}

function showReport(results) {
  const totals = { imported: 0, ignored: 0, error: 0, pending: 0 };
  const rows = document.createDocumentFragment();
  for (const { product, status: outcome, message } of results) {
    totals[outcome]++;
    const row = document.createElement('tr');
    const productCell = document.createElement('td');
    const name = document.createElement('strong'); name.textContent = product.nome || 'Sem nome';
    const ean = document.createElement('small'); ean.textContent = product.ean || 'EAN ausente';
    productCell.append(name, ean);
    const resultCell = document.createElement('td');
    resultCell.className = 'result'; resultCell.dataset.status = outcome; resultCell.textContent = labels[outcome];
    const detail = document.createElement('td'); detail.textContent = message;
    row.append(productCell, resultCell, detail); rows.append(row);
  }
  document.querySelector('#report-rows').replaceChildren(rows);
  const summary = document.querySelector('#report-summary'); summary.replaceChildren();
  for (const [key, label] of Object.entries({ imported: 'cadastrados', ignored: 'ignorados', error: 'com erro', pending: 'pendentes' })) {
    if (key === 'pending' && !totals[key]) continue;
    const item = document.createElement('p'); const number = document.createElement('strong');
    number.textContent = totals[key]; item.append(number, document.createTextNode(label)); summary.append(item);
  }
  const withImage = results.filter(item => item.status === 'imported' && item.image).length;
  document.querySelector('#report-images').textContent = `${withImage} cadastrados com imagem · ${totals.imported - withImage} cadastrados sem imagem.`;
  report.hidden = false;
  report.focus({ preventScroll: true });
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (running) return;
  running = true; button.disabled = true; input.readOnly = true;
  manufacturer.readOnly = true;
  button.textContent = 'Importando…'; errorBox.hidden = true; report.hidden = true; progress.hidden = true;
  let items = [], results = [], completed = 0;
  try {
    if (new Blob([input.value]).size > 1024 * 1024) throw new Error('O HTML deve ter até 1 MB.');
    const parsed = await post('parse', { html: input.value, fabricante: manufacturer.value.trim() });
    items = parsed.items;
    progress.hidden = false; bar.max = items.length; bar.value = 0;
    title.textContent = 'Importando produtos'; count.textContent = `0 de ${items.length}`;
    for (const item of items) {
      status.textContent = `Processando ${item.product.nome || `item ${item.position}`}… Mantenha esta página aberta.`;
      const result = item.error
        ? { status: 'error', image: false, message: item.error }
        : await post('item', item.product);
      results.push({ ...item, ...result });
      completed++; bar.value = completed; count.textContent = `${completed} de ${items.length}`;
    }
    title.textContent = 'Importação concluída';
    status.textContent = 'Processamento finalizado. Confira os resultados abaixo.';
  } catch (error) {
    errorBox.textContent = `${error.message}${items.length ? ' A importação foi interrompida. Você pode importar o mesmo HTML novamente; EANs já cadastrados serão ignorados.' : ''}`;
    errorBox.hidden = false;
    if (items.length) {
      title.textContent = 'Importação interrompida';
      status.textContent = `${completed} de ${items.length} resultados confirmados.`;
      results.push(...items.slice(completed).map((item, index) => ({ ...item, status: 'pending', image: false,
        message: index === 0 ? 'Resultado não confirmado. Reimporte o HTML para verificar este EAN.' : 'Não processado. Reimporte o HTML para continuar.' })));
    }
  } finally {
    if (results.length) showReport(results);
    running = false; button.disabled = false; input.readOnly = false; button.textContent = 'Importar produtos';
    manufacturer.readOnly = false;
  }
});
