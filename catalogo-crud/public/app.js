import { renderProductCard as createProductCard } from './js/features/catalogue/product-card.js';
import { apiFetch, sessionReady } from './js/session.js';
let canCreateProducts = false;
let canManageProducts = false;
const state = {
  page: 1,
  pageSize: 48,
  query: '',
  category: '',
  status: '',
  image: 'com',
  manufacturer: '',
  pagination: { page: 1, pageSize: 48, total: 0, totalPages: 1 },
  editingId: null,
  categories: [],
  requestId: 0,
};

const numberFormatter = new Intl.NumberFormat('pt-BR');
const formatNumber = (value) => numberFormatter.format(value);

const elements = {
  search: document.querySelector('#search-input'),
  category: document.querySelector('#category-filter'),
  categoryChips: document.querySelector('#category-chips'),
  status: document.querySelector('#status-filter'),
  image: document.querySelector('#image-filter'),
  categoryOptions: document.querySelector('#category-options'),
  grid: document.querySelector('#product-grid'),
  resultsKicker: document.querySelector('#results-kicker'),
  resultsTitle: document.querySelector('#results-title'),
  previousPage: document.querySelector('#previous-page-button'),
  nextPage: document.querySelector('#next-page-button'),
  pageIndicator: document.querySelector('#page-indicator'),
  dialog: document.querySelector('#product-dialog'),
  form: document.querySelector('#product-form'),
  dialogKicker: document.querySelector('#dialog-kicker'),
  dialogTitle: document.querySelector('#dialog-title'),
  deleteButton: document.querySelector('#delete-product-button'),
  saveButton: document.querySelector('#save-product-button'),
  imagePreview: document.querySelector('#dialog-image-preview'),
  imageCaption: document.querySelector('#image-caption'),
  toast: document.querySelector('#toast'),
};

let toastTimer;
let searchTimer;
let imageSearchVersion = 0;
let imageFileReader;
let imageSearchController;
let imageFileLoading = false;
let selectedInternetImage = null;
let productAiVersion = 0;
let productAiController;
let productAiLoading = false;
const productAiFilled = new Map();
const productAiEdited = new Set();

function setLookupFeedback(kind, loading) {
  const isAi = kind === 'ai';
  const button = document.querySelector(isAi ? '#lookup-product-ean' : '#search-product-image');
  const status = document.querySelector(isAi ? '#product-ai-status' : '#product-image-search-status');
  button.setAttribute('aria-busy', String(loading));
  button.disabled = loading;
  button.textContent = isAi
    ? (loading ? 'Consultando IA…' : 'Preencher dados com IA')
    : (loading ? 'Buscando imagens…' : 'Buscar no Google Imagens');
  status.classList.toggle('lookup-loading', loading);
}

function resetProductAi(clearFilled = false) {
  productAiVersion++;
  productAiController?.abort();
  productAiLoading = false;
  if (clearFilled) for (const [field, value] of productAiFilled) {
    if (formValue(field) === value) setFormValue(field, '');
  }
  productAiFilled.clear();
  productAiEdited.clear();
  setLookupFeedback('ai', false);
  document.querySelector('#product-ai-status').textContent = '';
  document.querySelector('#product-ai-sources').replaceChildren();
}

async function lookupProductEan() {
  if (productAiLoading || elements.saveButton.disabled || !canCreateProducts || (!canManageProducts && state.editingId !== null)) return;
  const ean = imageEan();
  const status = document.querySelector('#product-ai-status');
  if (!/^(?:\d{8}|\d{12,14})$/.test(ean)) {
    status.textContent = 'Preencha um EAN de 8, 12, 13 ou 14 dígitos para consultar a IA.';
    elements.form.elements.namedItem('ean').focus(); return;
  }
  const version = ++productAiVersion;
  productAiEdited.clear();
  productAiController = new AbortController();
  productAiLoading = true;
  setLookupFeedback('ai', true);
  status.textContent = 'Buscando nome, apresentação e fabricante pelo EAN. Isso pode levar alguns instantes…';
  const sources = document.querySelector('#product-ai-sources');
  sources.replaceChildren();
  try {
    const data = await requestJson('/api/products/lookup-ean', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ean }), signal: productAiController.signal });
    if (version !== productAiVersion || ean !== imageEan()) return;
    if (!data.encontrado) {
      status.textContent = 'Não foram encontrados dados comprovados para este EAN. Preencha os campos manualmente.'; return;
    }
    let filled = 0, preserved = 0;
    for (const field of ['nome', 'subtitulo', 'fabricante']) {
      const value = data.campos?.[field];
      if (typeof value !== 'string' || !value.trim()) continue;
      if (productAiEdited.has(field) || String(formValue(field)).trim()) { preserved++; continue; }
      setFormValue(field, value); productAiFilled.set(field, value); filled++;
    }
    for (const source of data.fontes || []) {
      const link = createElement('a', null, source.titulo);
      link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      sources.append(link);
    }
    status.textContent = filled
      ? `${filled} campo(s) preenchido(s) com IA. Confira os dados e as fontes antes de salvar.`
      : 'Nenhum campo vazio pôde ser preenchido. Confira as fontes ou preencha manualmente.';
    if (preserved) status.textContent += ' Campos já preenchidos foram preservados.';
    if (!data.campos?.fabricante && !String(formValue('fabricante')).trim()) {
      status.textContent += ' Fabricante não confirmado nas fontes; preencha manualmente.';
    }
  } catch (error) {
    if (version === productAiVersion) status.textContent = error.message;
  } finally {
    if (version === productAiVersion) {
      productAiLoading = false;
      setLookupFeedback('ai', false);
    }
  }
}

function imageEan() { return String(formValue('ean')).replace(/[\s-]/g, ''); }

function resetImageSearch() {
  imageSearchVersion++;
  imageFileReader?.abort();
  imageSearchController?.abort();
  document.querySelector('#product-image-results').replaceChildren();
  imageFileLoading = false;
  selectedInternetImage = null;
  document.querySelector('#product-image-file').value = '';
  document.querySelector('#product-image-search-status').textContent = '';
  document.querySelector('#clear-product-image-selection').hidden = true;
  setLookupFeedback('images', false);
}

function appendImageCredits(container, credits) {
  if (!credits) return;
  const source = createElement('a', null, `${credits.source_name} — colaboradores`);
  source.href = credits.source_page;
  source.target = '_blank'; source.rel = 'noopener noreferrer';
  const license = createElement('a', null, 'CC BY-SA 3.0');
  license.href = credits.license_url;
  license.target = '_blank'; license.rel = 'noopener noreferrer';
  container.append(' ', source, ' · ', license, ' (convertida para WebP)');
}

async function searchInternetImages() {
  if (elements.saveButton.disabled || (!canManageProducts && state.editingId !== null)) return;
  const ean = imageEan();
  const status = document.querySelector('#product-image-search-status');
  if (!/^(?:\d{8}|\d{12,14})$/.test(ean)) {
    status.textContent = 'Preencha um EAN de 8, 12, 13 ou 14 dígitos.';
    elements.form.elements.namedItem('ean').focus();
    return;
  }
  resetImageSearch();
  previewTypedImage();
  const version = imageSearchVersion;
  const results = document.querySelector('#product-image-results');
  imageSearchController = new AbortController();
  setLookupFeedback('images', true);
  imageFileLoading = true;
  status.textContent = 'Buscando as três primeiras imagens…';
  try {
    const data = await requestJson(`/api/product-images/search/${encodeURIComponent(ean)}`, { signal: imageSearchController.signal });
    if (version !== imageSearchVersion) return;
    const choices = [];
    for (const item of data.items || []) {
      const choice = createElement('button', 'product-image-choice');
      choice.type = 'button';
      choice.disabled = !item.token || !item.preview;
      choice.setAttribute('aria-pressed', 'false');
      choice.setAttribute('aria-label', `Selecionar opção ${item.position}: ${item.title}`);
      if (item.preview) {
        const image = new Image(); image.src = item.preview; image.alt = item.title;
        choice.append(image);
      }
      choice.append(createElement('span', null, `${item.position}. ${item.title}`));
      choice.append(createElement('small', null, choice.disabled ? 'Imagem indisponível' : item.source));
      choice.addEventListener('click', () => {
        if (version !== imageSearchVersion || elements.saveButton.disabled) return;
        selectedInternetImage = { ean, token: item.token };
        choices.forEach(other => other.setAttribute('aria-pressed', String(other === choice)));
        renderDialogImage({ nome: item.title, imagem_local_url: item.preview });
        status.textContent = `Opção ${item.position} selecionada. O fundo branco será removido ao salvar o produto.`;
        document.querySelector('#clear-product-image-selection').hidden = false;
      });
      choices.push(choice); results.append(choice);
    }
    status.textContent = choices.length
      ? 'Escolha uma das imagens abaixo. Confira o produto e a permissão de uso da foto.'
      : 'Nenhuma imagem encontrada para este EAN. Você pode carregar um arquivo.';
  } catch (error) {
    if (version === imageSearchVersion) status.textContent = error.message;
  } finally {
    if (version === imageSearchVersion) {
      setLookupFeedback('images', false);
      imageFileLoading = false;
    }
  }
}

function selectProductImage(file) {
  if (!file || elements.saveButton.disabled || (!canManageProducts && state.editingId !== null)) return;
  const status = document.querySelector('#product-image-search-status');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || !file.size || file.size > 8 * 1024 * 1024) {
    status.textContent = 'Escolha uma imagem PNG, JPG ou WebP de até 8 MB.';
    return;
  }
  resetImageSearch();
  const version = imageSearchVersion;
  const ean = imageEan();
  imageFileLoading = true;
  status.textContent = 'Carregando imagem…';
  const reader = new FileReader();
  imageFileReader = reader;
  reader.onload = () => {
    if (version !== imageSearchVersion) return;
    imageFileLoading = false;
    selectedInternetImage = { ean, data: reader.result };
    renderDialogImage({ nome: formValue('nome') || 'Imagem escolhida', imagem_local_url: reader.result });
    status.textContent = 'Imagem carregada. Salve o produto para confirmar.';
    document.querySelector('#clear-product-image-selection').hidden = false;
  };
  reader.onerror = () => {
    if (version !== imageSearchVersion) return;
    imageFileLoading = false;
    status.textContent = 'Não foi possível ler a imagem. Tente carregar o arquivo novamente.';
  };
  reader.readAsDataURL(file);
}

function pasteProductImage(event) {
  const file = [...(event.clipboardData?.items || [])].find(item => item.type.startsWith('image/'))?.getAsFile();
  if (file) { event.preventDefault(); selectProductImage(file); }
  else if (event.target === document.querySelector('#product-image-paste')) {
    event.preventDefault();
    document.querySelector('#product-image-search-status').textContent = 'Copie a imagem, não o endereço dela. Você também pode baixar a foto e carregar o arquivo.';
  }
}

async function requestJson(url, options = {}) {
  const { headers, ...requestOptions } = options;
  const response = await apiFetch(url, {
    ...requestOptions,
    headers: { Accept: 'application/json', ...headers },
  });

  if (response.status === 204) return null;

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Não foi possível concluir a operação.');
  }
  return data;
}

function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle('error', isError);
  elements.toast.hidden = false;
  toastTimer = setTimeout(() => {
    elements.toast.hidden = true;
  }, 4200);
}

function createElement(tagName, className, textContent) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (textContent !== undefined && textContent !== null) element.textContent = textContent;
  return element;
}

function renderProductCard(product) { return createProductCard(product, openProduct); }

function renderSkeletons() {
  elements.grid.replaceChildren(...Array.from({ length: 12 }, () => createElement('div', 'skeleton')));
}

function renderProducts(data) {
  const { items, pagination } = data;
  state.pagination = pagination;
  elements.grid.replaceChildren(...items.map(renderProductCard));
  
  elements.grid.hidden = items.length === 0;

  const start = pagination.total === 0 ? 0 : ((pagination.page - 1) * pagination.pageSize) + 1;
  const end = Math.min(pagination.page * pagination.pageSize, pagination.total);
  elements.resultsKicker.textContent = pagination.total
    ? `Mostrando ${formatNumber(start)}–${formatNumber(end)} de ${formatNumber(pagination.total)}`
    : 'Nenhum resultado';
  elements.resultsTitle.textContent = pagination.total === 1 ? '1 produto' : `${formatNumber(pagination.total)} produtos`;
  elements.pageIndicator.textContent = `${pagination.page} / ${pagination.totalPages}`;
  elements.previousPage.disabled = pagination.page <= 1;
  elements.nextPage.disabled = pagination.page >= pagination.totalPages;
}

async function loadCategories() {
  const response = await requestJson('/api/categories');
  const currentValue = state.category;
  state.categories = response.items;

  const categoryOptions = response.items.map((category) => {
    const option = document.createElement('option');
    option.value = category.nome;
    option.textContent = `${category.nome} (${formatNumber(category.total)})`;
    return option;
  });
  elements.category.replaceChildren(new Option('Todas as categorias', ''), ...categoryOptions);
  elements.category.value = currentValue;
  elements.categoryOptions.replaceChildren(
    ...response.items.map((category) => new Option(category.nome, category.nome)),
  );
  renderCategoryChips();
}

function renderCategoryChips() {
  if (!elements.categoryChips) return;

  const fragment = document.createDocumentFragment();
  const categories = [
    { nome: 'Todas', total: null, value: '' },
    ...state.categories.map((category) => ({ ...category, value: category.nome })),
  ];

  categories.forEach((category) => {
    const chip = createElement('button', 'category-chip');
    chip.type = 'button';
    chip.dataset.category = category.value;
    const selected = state.category === category.value;
    chip.classList.toggle('is-active', selected);
    chip.setAttribute('aria-pressed', String(selected));
    chip.append(createElement('span', null, category.nome));
    if (category.total !== null) {
      chip.append(createElement('small', null, formatNumber(category.total)));
    }
    chip.addEventListener('click', () => setCategoryFilter(category.value));
    fragment.append(chip);
  });

  elements.categoryChips.replaceChildren(fragment);
}

function setCategoryFilter(category) {
  state.page = 1;
  state.category = category;
  elements.category.value = category;
  renderCategoryChips();
  loadProducts();
}

function productsUrl() {
  const parameters = new URLSearchParams({
    page: String(state.page),
    pageSize: String(state.pageSize),
  });
  if (state.query) parameters.set('q', state.query);
  if (state.category) parameters.set('categoria', state.category);
  if (state.status) parameters.set('status', state.status);
  if (state.image) parameters.set('imagem', state.image);
  if (state.manufacturer) parameters.set('fabricante', state.manufacturer);
  return `/api/products?${parameters.toString()}`;
}

async function loadProducts() {
  const currentRequest = ++state.requestId;
  renderSkeletons();
  try {
    const response = await requestJson(productsUrl());
    if (currentRequest === state.requestId) renderProducts(response);
  } catch (error) {
    if (currentRequest !== state.requestId) return;
    elements.grid.replaceChildren();
    elements.grid.hidden = true;
    elements.resultsKicker.textContent = 'Não foi possível carregar';
    elements.resultsTitle.textContent = 'Tente novamente';
    showToast(error.message, true);
  }
}

function setFormValue(name, value) {
  const field = elements.form.elements.namedItem(name);
  if (!field) return;
  if (field.type === 'checkbox') {
    field.checked = Boolean(value);
  } else {
    field.value = value ?? '';
  }
}

function formValue(name) {
  const field = elements.form.elements.namedItem(name);
  return field?.type === 'checkbox' ? field.checked : field?.value ?? '';
}

function resetForm() {
  resetProductAi();
  elements.form.reset();
  setFormValue('status', 'pendente');
  setFormValue('direcao_imagem', 'vertical');
  setFormValue('imagem_arquivo', '');
  resetImageSearch();
}

function renderDialogImage(product) {
  elements.imagePreview.replaceChildren();
  const localUrl = product?.imagem_local_url;

  if (localUrl) {
    const image = new Image();
    image.alt = product.nome || 'Imagem do produto';
    image.src = localUrl;
    image.addEventListener('error', () => renderDialogImage(null));
    elements.imagePreview.append(image);
    elements.imageCaption.textContent = `Imagem local disponível (${product.imagem_status || 'manual'}).`;
    if (selectedInternetImage) elements.imageCaption.textContent = selectedInternetImage.token
      ? 'Prévia original. O fundo branco será removido ao salvar.'
      : 'Imagem selecionada para salvar com o produto.';
    appendImageCredits(elements.imageCaption, product.imagem_creditos);
    return;
  }

  elements.imagePreview.append(createElement('span', null, '⌁'), createElement('p', null, 'Sem imagem local'));
  elements.imageCaption.textContent = '';
}

function previewTypedImage() {
  const localFile = String(formValue('imagem_arquivo') || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!localFile.startsWith('imagens/') || localFile.includes('..')) return renderDialogImage(null);
  renderDialogImage({
    nome: formValue('nome') || 'Imagem do produto',
    imagem_local_url: `/assets/${localFile.split('/').map(encodeURIComponent).join('/')}`,
    imagem_status: 'manual',
  });
}

function openDialog(product = null) {
  if (!product && !canCreateProducts) return;
  state.editingId = product?.id ?? null;
  resetForm();

  if (product) {
    elements.dialogKicker.textContent = `Produto #${product.id}`;
    elements.dialogTitle.textContent = 'Editar produto';
    elements.saveButton.textContent = 'Salvar alterações';
    elements.deleteButton.hidden = false;

    [
      'nome', 'subtitulo', 'caracteres', 'grupo', 'principio_ativo', 'ms', 'fabricante',
      'categoria_id', 'categoria_produtos', 'categoria_nome', 'frases_encarte', 'status',
      'data_vigencia_inicio', 'data_vigencia_fim', 'generico', 'produto_destaque', 'ean',
      'direcao_imagem', 'imagem_arquivo',
    ].forEach((field) => setFormValue(field, product[field]));
  } else {
    elements.dialogKicker.textContent = 'Novo registro';
    elements.dialogTitle.textContent = 'Adicionar produto';
    elements.saveButton.textContent = 'Criar produto';
    elements.deleteButton.hidden = true;
    setFormValue('status', canManageProducts ? 'ativo' : 'pendente');
  }

  renderDialogImage(product);
  const canEdit = canManageProducts || (!product && canCreateProducts);
  document.querySelector('#product-image-search').hidden = !canEdit;
  document.querySelector('#product-ai-tools').hidden = !canEdit;
  resetImageSearch();
  if (!canEdit) elements.dialogTitle.textContent = 'Detalhes do produto';
  elements.saveButton.hidden = !canEdit;
  elements.deleteButton.hidden = !canManageProducts || !product;
  elements.form.querySelectorAll('input, select, textarea').forEach((field) => { field.disabled = !canEdit; });
  if (!product && !canManageProducts) elements.form.elements.namedItem('status').disabled = true;
  elements.dialog.showModal();
  // Opening product details should not immediately cover the mobile screen with a keyboard.
  if (window.matchMedia('(max-width: 900px)').matches) {
    document.querySelector('#close-dialog-button').focus({ preventScroll: true });
  } else {
    elements.form.elements.namedItem(product ? 'nome' : 'ean').focus();
  }
}

function closeDialog() {
  resetProductAi();
  resetImageSearch();
  if (elements.dialog.open) elements.dialog.close();
  state.editingId = null;
}

async function openProduct(id) {
  try {
    const product = await requestJson(`/api/products/${id}`);
    openDialog(product);
  } catch (error) {
    showToast(error.message, true);
  }
}

function payloadFromForm() {
  const fields = [
    'nome', 'subtitulo', 'caracteres', 'grupo', 'principio_ativo', 'ms', 'fabricante',
    'categoria_id', 'categoria_produtos', 'categoria_nome', 'frases_encarte', 'status',
    'data_vigencia_inicio', 'data_vigencia_fim', 'ean', 'direcao_imagem', 'imagem_arquivo',
  ];
  const payload = Object.fromEntries(fields.map((field) => [field, formValue(field)]));
  payload.generico = formValue('generico');
  payload.produto_destaque = formValue('produto_destaque');
  if (selectedInternetImage && selectedInternetImage.ean === imageEan()) {
    if (selectedInternetImage.token) payload.imagem_busca_token = selectedInternetImage.token;
    else payload.imagem_upload = selectedInternetImage.data;
    payload.ean = imageEan();
  }
  return payload;
}

async function saveProduct(event) {
  event.preventDefault();
  const editing = Number.isInteger(state.editingId);
  if (editing ? !canManageProducts : !canCreateProducts) return;
  if (productAiLoading) { showToast('Aguarde a consulta de dados do produto terminar.', true); return; }
  if (imageFileLoading) { showToast('Aguarde a imagem terminar de carregar.', true); return; }
  const name = String(formValue('nome')).trim();
  if (!name) {
    showToast('Informe o nome do produto.', true);
    elements.form.elements.namedItem('nome').focus();
    return;
  }

  elements.saveButton.disabled = true;
  elements.saveButton.textContent = selectedInternetImage?.token ? 'Processando imagem…' : 'Salvando…';

  try {
    const product = await requestJson(editing ? `/api/products/${state.editingId}` : '/api/products', {
      method: editing ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadFromForm()),
    });
    closeDialog();
    if (!editing) state.page = 1;
    await Promise.all([loadCategories(), loadProducts()]);
    showToast(editing
      ? `${product.nome} foi atualizado.`
      : canManageProducts ? `${product.nome} foi criado.` : `${product.nome} foi enviado para aprovação.`);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    elements.saveButton.disabled = false;
    elements.saveButton.textContent = state.editingId === null ? 'Criar produto' : 'Salvar alterações';
  }
}

async function deleteCurrentProduct() {
  if (!canManageProducts) return;
  if (!Number.isInteger(state.editingId)) return;
  const productName = String(formValue('nome') || 'este produto');
  if (!window.confirm(`Excluir “${productName}”? Esta ação remove apenas o registro; a imagem local será preservada.`)) {
    return;
  }

  elements.deleteButton.disabled = true;
  try {
    await requestJson(`/api/products/${state.editingId}`, { method: 'DELETE' });
    closeDialog();
    await Promise.all([loadCategories(), loadProducts()]);
    showToast('Produto excluído.');
  } catch (error) {
    showToast(error.message, true);
  } finally {
    elements.deleteButton.disabled = false;
  }
}

function clearFilters() {
  state.page = 1;
  state.query = '';
  state.category = '';
  state.status = '';
  state.image = 'com';
  clearManufacturerFilter();
  elements.search.value = '';
  elements.category.value = '';
  elements.status.value = '';
  elements.image.value = 'com';
  renderCategoryChips();
  loadProducts();
}

function clearManufacturerFilter() {
  state.manufacturer = '';
  document.querySelector('#manufacturer-filter-banner').hidden = true;
  if (globalThis.location && globalThis.history) {
    const url = new URL(location.href);
    url.searchParams.delete('fabricante');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
}

function bindEvents() {
  document.querySelector('#product-import-dialog').addEventListener('products-imported', () => {
    clearTimeout(searchTimer);
    state.page = 1;
    state.query = '';
    state.category = '';
    state.status = '';
    clearManufacturerFilter();
    elements.search.value = '';
    elements.category.value = '';
    elements.status.value = '';
    renderCategoryChips();
    elements.image.value = 'sem';
    elements.image.dispatchEvent(new Event('change'));
  });
  document.querySelector('#new-product-button').addEventListener('click', () => openDialog());
  document.querySelector('#close-dialog-button').addEventListener('click', closeDialog);
  document.querySelector('#cancel-dialog-button').addEventListener('click', closeDialog);
  document.querySelector('#clear-filters-button').addEventListener('click', clearFilters);
  document.querySelector('#clear-manufacturer-button').addEventListener('click', () => {
    clearManufacturerFilter();
    state.page = 1;
    loadProducts();
  });
  elements.form.addEventListener('submit', saveProduct);
  elements.deleteButton.addEventListener('click', deleteCurrentProduct);
  elements.form.elements.namedItem('imagem_arquivo').addEventListener('input', () => { resetImageSearch(); previewTypedImage(); });
  elements.form.elements.namedItem('ean').addEventListener('input', () => { resetProductAi(true); resetImageSearch(); previewTypedImage(); });
  for (const field of ['nome', 'subtitulo', 'fabricante']) {
    elements.form.elements.namedItem(field).addEventListener('input', () => {
      productAiFilled.delete(field);
      if (productAiLoading) productAiEdited.add(field);
    });
  }
  document.querySelector('#lookup-product-ean').addEventListener('click', lookupProductEan);
  document.querySelector('#search-product-image').addEventListener('click', searchInternetImages);
  document.querySelector('#product-image-file').addEventListener('change', event => selectProductImage(event.target.files?.[0]));
  elements.form.addEventListener('paste', pasteProductImage);
  const pasteArea = document.querySelector('#product-image-paste');
  pasteArea.addEventListener('dragover', event => event.preventDefault());
  pasteArea.addEventListener('drop', event => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) selectProductImage(file);
    else document.querySelector('#product-image-search-status').textContent = 'Arraste um arquivo de imagem salvo no dispositivo ou use Copiar imagem e cole aqui.';
  });
  document.querySelector('#clear-product-image-selection').addEventListener('click', () => { resetImageSearch(); previewTypedImage(); });
  elements.dialog.addEventListener('close', () => { resetImageSearch(); resetProductAi(); });

  elements.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.page = 1;
      state.query = elements.search.value.trim();
      loadProducts();
    }, 260);
  });

  elements.category.addEventListener('change', () => {
    setCategoryFilter(elements.category.value);
  });
  elements.status.addEventListener('change', () => {
    state.page = 1;
    state.status = elements.status.value;
    loadProducts();
  });
  elements.image.addEventListener('change', () => {
    state.page = 1;
    state.image = elements.image.value;
    loadProducts();
  });
  elements.previousPage.addEventListener('click', () => {
    if (state.pagination.page <= 1) return;
    state.page = state.pagination.page - 1;
    loadProducts();
  });
  elements.nextPage.addEventListener('click', () => {
    if (state.pagination.page >= state.pagination.totalPages) return;
    state.page = state.pagination.page + 1;
    loadProducts();
  });
}

async function initialize() {
  try {
    const user = (await sessionReady).user;
    canManageProducts = user.role === 'administrador';
    canCreateProducts = true;
  }
  catch (error) { showToast(error.message, true); return; }
  state.manufacturer = new URLSearchParams(globalThis.location?.search || '').get('fabricante')?.trim() || '';
  if (state.manufacturer) {
    state.image = '';
    elements.image.value = '';
    document.querySelector('#manufacturer-filter-banner').hidden = false;
    document.querySelector('#manufacturer-filter-name').textContent = state.manufacturer;
  }
  bindEvents();
  renderSkeletons();
  try {
    await Promise.all([loadCategories(), loadProducts()]);
  } catch (error) {
    showToast(error.message, true);
  }
}

initialize();
