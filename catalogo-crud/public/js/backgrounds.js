import { apiFetch, sessionReady } from './session.js';
const $ = id => document.getElementById(id);
const status = message => { $('background-status').textContent = message; };
let previewUrl;
const endpoint = () => `/api/${$('background-format').value}-backgrounds`;
async function request(url, options) {
  const response = await apiFetch(url, options);
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(data?.error || 'Não foi possível concluir a operação.');
  return data;
}
function busy(value) {
  $('upload-fields').disabled = value;
  $('background-format').disabled = value;
  $('reload-backgrounds').disabled = value;
  for (const button of $('background-list').querySelectorAll('button')) button.disabled = value;
}
async function load() {
  const url = endpoint();
  const { items } = await request(url);
  $('background-list').replaceChildren();
  for (const item of items) {
    const card = document.createElement('article'); card.className = 'background-card';
    const img = document.createElement('img'); img.src = item.thumbnail_url; img.alt = item.nome; img.loading = 'lazy';
    const title = document.createElement('h2'); title.textContent = item.nome;
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remover'; remove.className = 'users-danger';
    remove.setAttribute('aria-label', `Remover ${item.nome}`);
    remove.addEventListener('click', async () => {
      if (!confirm(`Remover o background “${item.nome}”? Ele deixará de estar disponível para todos os usuários neste formato.`)) return;
      busy(true);
      try {
        await request(`${url}/${encodeURIComponent(item.arquivo)}`, { method: 'DELETE' });
        await load(); status('Background removido.');
      } catch (error) { status(error.message); }
      finally { busy(false); }
    });
    card.append(img, title, remove); $('background-list').append(card);
  }
  status(items.length ? `${items.length} background(s) neste formato.` : 'Nenhum background neste formato. Adicione a primeira imagem.');
}
async function reload() {
  busy(true); status('Carregando backgrounds…');
  $('background-list').replaceChildren();
  try { await load(); } catch (error) { status(error.message); } finally { busy(false); }
}
function clearPreview() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null; $('upload-preview').hidden = true; $('upload-preview').removeAttribute('src');
}
$('background-file').addEventListener('change', () => {
  clearPreview();
  const file = $('background-file').files[0];
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
    status('Escolha uma imagem PNG, JPG ou WebP de até 10 MB.'); $('background-file').value = ''; return;
  }
  previewUrl = URL.createObjectURL(file); $('upload-preview').src = previewUrl; $('upload-preview').hidden = false;
  if (!$('background-name').value.trim()) $('background-name').value = file.name.replace(/\.[^.]+$/, '').slice(0, 80);
});
$('background-form').addEventListener('submit', async event => {
  event.preventDefault();
  const file = $('background-file').files[0];
  if (!file) return;
  busy(true); status('Enviando background…');
  try {
    const imagem = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Não foi possível ler a imagem.')); reader.readAsDataURL(file);
    });
    await request(endpoint(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome: $('background-name').value, imagem }) });
    $('background-form').reset(); clearPreview();
    await load(); status('Background adicionado e disponível para as artes.');
  } catch (error) { status(error.message); } finally { busy(false); }
});
$('background-format').addEventListener('change', reload);
$('reload-backgrounds').addEventListener('click', reload);
const initialLoad = sessionReady.then(({ user }) => {
  if (user.role !== 'administrador') { location.replace('/'); return; }
  return reload();
}).catch(error => status(error.message));
globalThis.appLoading?.track(initialLoad);
