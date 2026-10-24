import { apiFetch, sessionReady } from './session.js';
const $ = id => document.getElementById(id);
const money = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
const monthLabel = month => new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T12:00:00Z`));
let preview = null, uploaded = null, current = null, working = false;
const backgroundChoices = new Map();
const backgroundKey = value => value ? JSON.stringify({ format: value.format, arquivo: value.arquivo }) : '';
function selectedBackground(id) { return $(id).value ? JSON.parse($(id).value) : null; }
function showBackgroundPreview(id) {
  const image = $(`${id}-preview`), background = backgroundChoices.get($(id).value);
  image.hidden = !background;
  if (background) image.src = background.thumbnail_url || background.url;
  else image.removeAttribute('src');
}
function setBackgroundSelection(id, background) {
  const key = backgroundKey(background);
  if (key && ![...$(id).options].some(option => option.value === key)) {
    $(id).add(new Option(`${background.arquivo} (indisponível)`, key));
  }
  $(id).value = key;
  showBackgroundPreview(id);
}
async function loadBackgroundChoices() {
  const formats = [['stories', 'Stories', '/api/story-backgrounds'], ['feed', 'Feed', '/api/feed-backgrounds'], ['encarte', 'Encarte', '/api/encarte-backgrounds']];
  const results = await Promise.allSettled(formats.map(async ([format, label, url]) => {
    const { items } = await request(url);
    return { format, label, items };
  }));
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const { format, label, items } = result.value;
    for (const id of ['magazine-background', 'edit-background']) {
      const group = document.createElement('optgroup'); group.label = label;
      for (const item of items) {
        const key = backgroundKey({ format, arquivo: item.arquivo });
        backgroundChoices.set(key, item);
        group.append(new Option(item.nome, key));
      }
      $(id).append(group);
    }
  }
  $('magazine-background-status').textContent = results.some(result => result.status === 'rejected')
    ? 'Alguns fundos não puderam ser carregados. Recarregue a página para tentar novamente.' : '';
}
for (const id of ['magazine-background', 'edit-background']) {
  $(id).addEventListener('change', () => { $(id).dataset.changed = 'true'; showBackgroundPreview(id); });
}
const el = (tag, text, className) => {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node;
};
async function request(url, options = {}) {
  const response = await apiFetch(url, options);
  const result = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(result?.error || 'Não foi possível concluir a operação.');
  return result;
}
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
function canConfirm() {
  return preview?.valid || (preview?.canImport && $('ignore-errors').checked);
}
function updateConfirmation() {
  $('confirm-import').disabled = working || !canConfirm() || (Boolean(preview.existing) && !$('replace-confirm').checked);
}
function busy(value) {
  working = value;
  $('magazine-import-fields').disabled = value;
  $('reload-magazines').disabled = value;
  $('cancel-import').disabled = value;
  $('replace-confirm').disabled = value;
  $('ignore-errors').disabled = value;
  $('magazine-edit-fields').disabled = value;
  $('delete-magazine').disabled = value;
  for (const button of $('magazine-list').querySelectorAll('button')) button.disabled = value;
  updateConfirmation();
}
function clearPreview() {
  $('ignore-errors').checked = false; preview = null; uploaded = null; $('magazine-preview').hidden = true; $('replace-confirm').checked = false; updateConfirmation();
}
async function load() {
  const { items } = await request('/api/revistas');
  $('magazine-count').textContent = `${items.length} revista(s) cadastrada(s)`;
  $('magazine-list').replaceChildren();
  for (const item of items) {
    const card = el('article', undefined, 'magazine-card');
    const badge = el('span', item.status, `magazine-badge${item.status === 'Em destaque' ? ' is-current' : ''}`);
    const open = el('button', 'Gerenciar revista'); open.type = 'button';
    open.setAttribute('aria-label', `Gerenciar ${item.title}`); open.addEventListener('click', () => openMagazine(item.id));
    card.append(el('span', monthLabel(item.month), 'magazine-month'), el('h3', item.title), badge,
      el('p', `${item.total} produto(s) com preço sugerido`), open);
    $('magazine-list').append(card);
  }
  if (!items.length) $('magazine-list').append(el('p', 'Nenhuma revista cadastrada. Baixe o modelo e importe sua primeira seleção.', 'magazine-empty'));
}
function renderPreview() {
  $('magazine-preview').hidden = false;
  $('preview-summary').textContent = `${preview.month ? monthLabel(preview.month) + ' · ' : ''}${preview.items.length} de ${preview.total} produto(s) válido(s). ${preview.valid ? 'Confira a lista antes de importar.' : preview.canImport ? `${preview.skippedRows} linha(s) com erro. Você pode ignorá-las e importar somente os produtos válidos.` : 'Corrija os erros e analise o arquivo novamente. Nenhum dado foi salvo.'}`;
  $('preview-errors').replaceChildren(...preview.errors.map(error => el('li', `${error.row ? `Linha ${error.row}: ` : ''}${error.message}`)));
  $('preview-products').replaceChildren(...preview.items.slice(0, 200).map(item => {
    const row = el('tr'); row.append(...[item.row, item.ean, item.nome, money(item.preco_sugerido)].map(value => el('td', value))); return row;
  }));
  $('preview-limit').textContent = preview.items.length > 200 ? `Exibindo os primeiros 200 produtos. Todos os ${preview.items.length} produtos válidos serão importados.` : '';
  if (preview.errors.length === 100) $('preview-limit').textContent += ' Exibindo os primeiros 100 erros.';
  $('ignore-errors-label').hidden = preview.valid || !preview.canImport;
  $('ignore-errors').checked = false;
  $('replace-label').hidden = !preview.existing;
  $('replace-confirm').checked = false;
  $('confirm-import').textContent = preview.existing ? 'Substituir revista deste mês' : 'Importar revista';
  if (!$('magazine-title').value.trim() && preview.month) $('magazine-title').value = preview.existing?.title || `Revista de ${monthLabel(preview.month)}`;
  if (!$('magazine-background').dataset.changed) setBackgroundSelection('magazine-background', preview.existing?.background);
  updateConfirmation();
}
$('magazine-file').addEventListener('change', clearPreview);
$('magazine-import-form').addEventListener('submit', async event => {
  event.preventDefault(); if (working) return;
  const file = $('magazine-file').files[0];
  clearPreview();
  if (!file || !/\.xlsx$/i.test(file.name) || file.size > 4 * 1024 * 1024) { $('magazine-status').textContent = 'Selecione um XLSX de até 4 MB.'; return; }
  busy(true); $('magazine-status').textContent = 'Lendo a planilha e conferindo os produtos…';
  try {
    uploaded = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.')); reader.readAsDataURL(file);
    });
    preview = await request('/api/revistas/preview', json('POST', { file: uploaded }));
    renderPreview(); $('magazine-status').textContent = preview.valid ? 'Prévia pronta. A importação aguarda sua confirmação.' : preview.canImport ? 'Confira os erros e marque a opção de importar somente os produtos válidos para continuar.' : 'A planilha precisa de correções.';
  } catch (error) { clearPreview(); $('magazine-status').textContent = error.message; }
  finally { busy(false); }
});
$('replace-confirm').addEventListener('change', updateConfirmation);
$('ignore-errors').addEventListener('change', updateConfirmation);
$('cancel-import').addEventListener('click', () => { clearPreview(); $('magazine-status').textContent = 'Prévia descartada.'; });
$('confirm-import').addEventListener('click', async () => {
  if (working || !canConfirm() || (preview.existing && !$('replace-confirm').checked)) return;
  const title = $('magazine-title').value.trim();
  if (!title) { $('magazine-status').textContent = 'Informe um título para a revista.'; $('magazine-title').focus(); return; }
  busy(true); $('magazine-status').textContent = 'Importando revista…';
  try {
    const saved = await request('/api/revistas/import', json('POST', { file: uploaded, title, background: selectedBackground('magazine-background'), ignoreErrors: $('ignore-errors').checked, expectedRevision: preview.existing?.revision ?? null }));
    clearPreview(); $('magazine-import-form').reset(); await load();
    delete $('magazine-background').dataset.changed; showBackgroundPreview('magazine-background');
    $('magazine-status').textContent = `Revista de ${monthLabel(saved.month)} importada com ${saved.total} produto(s).${saved.skippedRows ? ` ${saved.skippedRows} linha(s) com erro ignorada(s).` : ''}`;
  } catch (error) { $('magazine-status').textContent = error.message; }
  finally { busy(false); }
});
function renderProducts() {
  const query = $('magazine-product-search').value.trim().toLocaleLowerCase('pt-BR');
  const items = current.items.filter(item => `${item.ean} ${item.product?.nome || ''}`.toLocaleLowerCase('pt-BR').includes(query));
  $('magazine-products').replaceChildren(...items.slice(0, 200).map(item => {
    const row = el('tr');
    row.append(el('td', item.product ? item.product.nome + (item.product.status !== 'ativo' ? ' (inativo)' : '') : 'Produto removido do catálogo'), el('td', item.ean), el('td', money(item.preco_sugerido))); return row;
  }));
  $('magazine-product-count').textContent = `${items.length} produto(s) encontrado(s).${items.length > 200 ? ' Exibindo 200. Use a busca para localizar os demais.' : ''}`;
}
async function openMagazine(id) {
  if (working) return;
  busy(true);
  try {
    current = await request(`/api/revistas/${id}`);
    $('magazine-dialog-title').textContent = monthLabel(current.month);
    $('edit-title').value = current.title; $('edit-active').checked = current.active;
    setBackgroundSelection('edit-background', current.background);
    $('magazine-edit-status').textContent = ''; $('magazine-product-search').value = ''; renderProducts(); $('magazine-dialog').showModal();
  } catch (error) { $('magazine-status').textContent = error.message; }
  finally { busy(false); }
}
$('close-magazine').addEventListener('click', () => $('magazine-dialog').close());
$('magazine-product-search').addEventListener('input', renderProducts);
$('magazine-edit-form').addEventListener('submit', async event => {
  event.preventDefault(); if (working || !current) return; busy(true);
  try {
    current = await request(`/api/revistas/${current.id}`, json('PUT', { title: $('edit-title').value, active: $('edit-active').checked, background: selectedBackground('edit-background'), revision: current.revision }));
    await load(); $('magazine-edit-status').textContent = 'Alterações salvas.';
  } catch (error) { $('magazine-edit-status').textContent = error.message; }
  finally { busy(false); }
});
$('delete-magazine').addEventListener('click', async () => {
  if (working || !current || !confirm(`Excluir “${current.title}” e sua lista de preços? Os produtos do catálogo serão mantidos.`)) return;
  busy(true);
  try {
    await request(`/api/revistas/${current.id}?revision=${current.revision}`, { method: 'DELETE' });
    $('magazine-dialog').close(); current = null; await load(); $('magazine-status').textContent = 'Revista excluída.';
  } catch (error) { $('magazine-edit-status').textContent = error.message; }
  finally { busy(false); }
});
$('reload-magazines').addEventListener('click', async () => {
  busy(true); try { await load(); $('magazine-status').textContent = 'Lista atualizada.'; }
  catch (error) { $('magazine-status').textContent = error.message; } finally { busy(false); }
});
sessionReady.then(async ({ user }) => {
  if (user.role !== 'administrador') { location.replace('/'); return; }
  busy(true); try { await Promise.all([load(), loadBackgroundChoices()]); $('magazine-status').textContent = ''; }
  finally { busy(false); }
}).catch(error => { $('magazine-status').textContent = error.message; });
