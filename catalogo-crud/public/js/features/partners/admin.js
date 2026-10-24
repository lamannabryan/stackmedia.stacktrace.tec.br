import { apiFetch } from '../../session.js';
const grid = document.querySelector('#partners-grid');
const status = document.querySelector('#partners-status');
const statusText = document.querySelector('#partners-status-text');
const retry = document.querySelector('#partners-retry');
const cards = [];
let manufacturers = [];
let partners = [];

async function request(url, options = {}) {
  const response = await apiFetch(url, { cache: 'no-store', ...options });
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Não foi possível concluir. Tente novamente.');
  return body;
}

function refreshCount() {
  document.querySelector('#partner-count').textContent = `${partners.length} de 3 destaques`;
  for (const card of cards) {
    for (const option of card.select.options) {
      option.disabled = partners.some((partner) => partner.slot !== card.slot && partner.fabricante === option.value);
    }
  }
}

function createCard(slot) {
  const form = document.querySelector('#partner-card-template').content.firstElementChild.cloneNode(true);
  const find = (selector) => form.querySelector(selector);
  const select = find('select');
  const file = find('input[type="file"]');
  const preview = find('[data-preview]');
  const placeholder = find('[data-placeholder]');
  const fieldset = find('fieldset');
  const submit = find('[type="submit"]');
  const remove = find('[data-remove]');
  const reset = find('[data-reset]');
  const feedback = find('.partner-feedback');
  let logo;
  let fileRead = 0;
  let dirty = false;
  let reading = false;
  const saved = () => partners.find((partner) => partner.slot === slot);
  form.dataset.slot = String(slot);
  find('h2').textContent = `Destaque 0${slot}`;
  select.id = `partner-manufacturer-${slot}`;
  file.id = `partner-upload-${slot}`;
  find('[data-manufacturer-label]').htmlFor = select.id;
  find('[data-logo-label]').htmlFor = file.id;
  const hint = find('.partner-file-hint');
  hint.id = `partner-hint-${slot}`;
  file.setAttribute('aria-describedby', hint.id);
  form.setAttribute('aria-label', `Destaque ${slot}`);
  for (const manufacturer of manufacturers) {
    select.add(new Option(`${manufacturer.nome} (${manufacturer.total.toLocaleString('pt-BR')} produtos)`, manufacturer.nome));
  }
  if (saved() && !manufacturers.some((item) => item.nome === saved().fabricante)) {
    select.add(new Option(`${saved().fabricante} (sem produtos)`, saved().fabricante));
  }

  function message(text, error = false) {
    feedback.textContent = text;
    feedback.classList.toggle('is-error', error);
  }
  function showPreview(src) {
    preview.hidden = !src;
    placeholder.hidden = Boolean(src);
    if (src) preview.src = src;
    else preview.removeAttribute('src');
  }
  function restore() {
    fileRead++;
    logo = undefined;
    reading = false;
    dirty = false;
    select.value = saved()?.fabricante || '';
    file.value = '';
    file.required = !saved();
    showPreview(saved()?.logo_url);
    find('[data-state]').textContent = saved() ? 'Publicado na central' : 'Posição livre';
    remove.hidden = !saved();
    reset.hidden = true;
    submit.disabled = false;
    submit.textContent = saved() ? 'Salvar alterações' : 'Salvar destaque';
  }
  select.addEventListener('change', () => { dirty = true; reset.hidden = false; message('Alterações ainda não salvas.'); });
  file.addEventListener('change', async () => {
    const selected = file.files[0];
    const version = ++fileRead;
    logo = undefined;
    reading = false;
    submit.disabled = false;
    showPreview(saved()?.logo_url);
    if (!selected) { reading = false; submit.disabled = false; return; }
    dirty = true;
    reset.hidden = false;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(selected.type) || selected.size > 4 * 1024 * 1024 || !selected.size) {
      file.value = '';
      message('Escolha um arquivo PNG, JPG ou WebP de até 4 MB.', true);
      return;
    }
    reading = true;
    submit.disabled = true;
    message('Preparando a prévia…');
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Não foi possível ler o arquivo. Selecione-o novamente.'));
        reader.readAsDataURL(selected);
      });
      const decoded = new Image();
      decoded.src = dataUrl;
      await decoded.decode();
      if (version !== fileRead) return;
      if (decoded.naturalWidth * decoded.naturalHeight > 16_000_000) throw new Error('Use um logotipo de até 16 megapixels.');
      logo = dataUrl;
      showPreview(logo);
      message('Prévia pronta. Salve para publicar no carrossel.');
    } catch (error) {
      if (version !== fileRead) return;
      file.value = '';
      message(error.message === 'The source image cannot be decoded.' ? 'Não foi possível abrir esta imagem.' : error.message, true);
    } finally {
      if (version === fileRead) { reading = false; submit.disabled = false; }
    }
  });
  preview.addEventListener('error', () => { preview.hidden = true; placeholder.hidden = false; });
  reset.addEventListener('click', () => { restore(); message('Alterações desfeitas.'); });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (reading || fieldset.disabled) return;
    if (!saved() && !logo) { message('Envie um logotipo para este destaque.', true); return; }
    fieldset.disabled = true;
    submit.textContent = 'Salvando…';
    message('Salvando destaque…');
    try {
      const partner = await request(`/api/featured-partners/${slot}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fabricante: select.value, ...(logo ? { logo } : {}) }),
      });
      partners = [...partners.filter((item) => item.slot !== slot), partner];
      restore();
      refreshCount();
      message('Destaque salvo e publicado na central.');
    } catch (error) { message(error.message, true); }
    finally { fieldset.disabled = false; submit.textContent = saved() ? 'Salvar alterações' : 'Salvar destaque'; }
  });
  remove.addEventListener('click', async () => {
    if (!confirm(`Remover ${saved().fabricante} do carrossel? Os produtos serão preservados.`)) return;
    fieldset.disabled = true;
    message('Removendo destaque…');
    try {
      await request(`/api/featured-partners/${slot}`, { method: 'DELETE' });
      partners = partners.filter((item) => item.slot !== slot);
      restore();
      refreshCount();
      message('Destaque removido. Esta posição está disponível.');
    } catch (error) { message(error.message, true); }
    finally { fieldset.disabled = false; }
  });
  restore();
  grid.append(form);
  return { slot, select, isDirty: () => dirty };
}

async function load() {
  retry.hidden = true;
  status.hidden = false;
  statusText.textContent = 'Carregando fabricantes e destaques…';
  grid.setAttribute('aria-busy', 'true');
  try {
    const [manufacturerResponse, partnerResponse] = await Promise.all([
      request('/api/manufacturers'), request('/api/featured-partners'),
    ]);
    manufacturers = manufacturerResponse.items;
    partners = partnerResponse.items;
    grid.replaceChildren();
    cards.length = 0;
    for (let slot = 1; slot <= 3; slot++) cards.push(createCard(slot));
    refreshCount();
    status.hidden = manufacturers.length > 0;
    if (!manufacturers.length) statusText.textContent = 'Cadastre um fabricante nos produtos do catálogo para adicioná-lo aos destaques.';
  } catch (error) {
    statusText.textContent = error.message;
    retry.hidden = false;
  } finally { grid.setAttribute('aria-busy', 'false'); }
}
retry.addEventListener('click', load);
window.addEventListener('beforeunload', (event) => {
  if (cards.some((card) => card.isDirty())) { event.preventDefault(); event.returnValue = ''; }
});
const initialLoad = load();
globalThis.appLoading?.track(initialLoad);

