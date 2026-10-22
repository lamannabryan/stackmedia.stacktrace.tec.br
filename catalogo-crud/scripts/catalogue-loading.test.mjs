import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const [markup, script, cardScript] = await Promise.all([
  readFile(new URL('../public/catalogo.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/js/features/catalogue/product-card.js', import.meta.url), 'utf8'),
]);

class Element {
  constructor() {
    this.children = [];
    this.dataset = {};
    this.textContent = '';
    this.value = '';
    this.hidden = false;
    this.disabled = false;
    this.listeners = new Map();
    const classes = new Set();
    this.classList = {
      toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
      contains: (name) => classes.has(name),
    };
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
}

async function openCatalogue({ productsError = () => null, imageResponse, aiResponse, empty = false, role = 'administrador' } = {}) {
  // Resolve selectors against the real page: removed elements must return null.
  const elements = new Map([...markup.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)].map(([tag, id]) => {
    const element = new Element();
    element.hidden = /\bhidden(?:\s|[=>])/.test(tag);
    return [id, element];
  }));
  const fields = new Map([...markup.matchAll(/\bname="([^"]+)"/g)].map(([, name]) => [name, new Element()]));
  elements.get('product-form').elements = { namedItem: (name) => fields.get(name) || null };
  elements.get('product-form').reset = () => fields.forEach(field => { field.value = ''; });
  elements.get('product-form').querySelectorAll = () => [...fields.values()];
  fields.forEach(field => { field.focus = () => {}; });
  elements.get('product-dialog').showModal = () => { elements.get('product-dialog').open = true; };
  elements.get('product-dialog').close = () => { elements.get('product-dialog').open = false; };
  const requests = [];
  const opened = [], readers = [];
  const context = vm.createContext({
    Intl, URLSearchParams, AbortController,
    window: { matchMedia: () => ({ matches: false }), open: (...args) => opened.push(args) },
    FileReader: class {
      constructor() { readers.push(this); }
      readAsDataURL(file) { this.result = file.data; }
      abort() {}
    },
    document: {
      querySelector: (selector) => elements.get(selector.slice(1)) || null,
      createElement: () => new Element(),
      createDocumentFragment: () => new Element(),
    },
    Image: Element,
    Option: class extends Element {
      constructor(text, value) { super(); this.textContent = text; this.value = value; }
    },
    setTimeout: () => 1,
    clearTimeout() {},
    fetch: async (url, options) => {
      requests.push(url);
      let data;
      let status = 200;
      if (url === '/api/products/lookup-ean') {
        if (aiResponse) return aiResponse(options);
        data = { ean: '3017620422003', encontrado: true,
          campos: { nome: 'Produto IA', subtitulo: '30 cápsulas', fabricante: 'Fabricante IA' },
          fontes: [{ titulo: 'Fonte de teste', url: 'https://example.com/product' }] };
      }
      else if (url.startsWith('/api/product-images/search/')) {
        if (imageResponse) return imageResponse();
        data = { items: [1, 2, 3].map(position => ({ position, title: `Produto ${position}`, source: 'Loja', preview: 'data:image/webp;base64,abc', token: `token-${position}` })) };
      }
      else if (url === '/api/summary') data = { total: 2, ativos: 2, com_imagem: 2 };
      else if (url === '/api/categories') data = { items: [{ nome: 'Higiene', total: 2 }] };
      else if (url.startsWith('/api/products?')) {
        const error = productsError();
        status = error ? 503 : 200;
        data = error ? { error } : {
          items: empty ? [] : [{ id: 1, nome: 'Produto de exemplo', status: 'ativo', possui_imagem_local: true, imagem_local_url: '/assets/imagens/exemplo.png' }],
          pagination: { page: 1, pageSize: 48, total: empty ? 0 : 49, totalPages: empty ? 1 : 2 },
        };
      } else throw new Error(`Requisição inesperada: ${url}`);
      return { status, ok: status < 400, json: async () => data };
    },
  });
  context.apiFetch = context.fetch;
  context.sessionReady = Promise.resolve({ user: { role } });
  vm.runInContext(cardScript.replace('export function renderProductCard', 'function createProductCard'), context, { filename: 'product-card.js' });
  await vm.runInContext(script.replace(/^import .+;\r?\n/gm, ''), context, { filename: 'app.js' });
  return { elements, requests, context, fields, opened, readers };
}

test('DeepSeek fills three empty product fields for common users without changing approval status', async () => {
  const f = await openCatalogue({ role: 'cliente' });
  f.context.openDialog();
  assert.equal(f.elements.get('product-ai-tools').hidden, false);
  await f.context.lookupProductEan();
  assert.ok(!f.requests.includes('/api/products/lookup-ean'));
  f.fields.get('ean').value = '3017620422003';
  await f.context.lookupProductEan();
  assert.equal(f.fields.get('nome').value, 'Produto IA');
  assert.equal(f.fields.get('subtitulo').value, '30 cápsulas');
  assert.equal(f.fields.get('fabricante').value, 'Fabricante IA');
  assert.equal(f.context.payloadFromForm().status, 'pendente');
  assert.equal(f.elements.get('product-ai-sources').children[0].href, 'https://example.com/product');
  assert.match(f.elements.get('product-ai-status').textContent, /3 campo/);
  assert.ok(!f.requests.includes('/api/products'));
  f.fields.get('nome').value = 'Nome revisado';
  f.fields.get('nome').listeners.get('input')();
  f.fields.get('ean').value = '96385074';
  f.fields.get('ean').listeners.get('input')();
  assert.equal(f.fields.get('nome').value, 'Nome revisado');
  assert.equal(f.fields.get('subtitulo').value, '');
  assert.equal(f.fields.get('fabricante').value, '');
  assert.equal(f.elements.get('product-ai-sources').children.length, 0);
});

test('DeepSeek preserves pre-existing values and edits made while a query is running', async () => {
  let complete;
  const f = await openCatalogue({ aiResponse: options => {
    assert.equal(options.method, 'POST');
    assert.equal(JSON.parse(options.body).ean, '3017620422003');
    return new Promise(resolve => { complete = resolve; });
  } });
  f.context.openDialog();
  f.fields.get('ean').value = '3017620422003';
  f.fields.get('nome').value = 'Nome manual';
  const pending = f.context.lookupProductEan();
  assert.equal(f.elements.get('lookup-product-ean')['aria-busy'], 'true');
  assert.equal(f.elements.get('product-ai-status').classList.contains('lookup-loading'), true);
  await f.context.saveProduct({ preventDefault() {} });
  assert.match(f.elements.get('toast').textContent, /Aguarde a consulta/);
  f.fields.get('fabricante').listeners.get('input')(); // Explicitly cleared while waiting.
  complete({ ok: true, status: 200, json: async () => ({ encontrado: true, campos: { nome: 'IA', subtitulo: '50 ml', fabricante: 'IA' }, fontes: [] }) });
  await pending;
  assert.equal(f.elements.get('lookup-product-ean')['aria-busy'], 'false');
  assert.equal(f.elements.get('product-ai-status').classList.contains('lookup-loading'), false);
  assert.equal(f.fields.get('nome').value, 'Nome manual');
  assert.equal(f.fields.get('subtitulo').value, '50 ml');
  assert.equal(f.fields.get('fabricante').value, '');
  assert.match(f.elements.get('product-ai-status').textContent, /preservados/);
});

test('changing EAN or closing the modal discards late AI replies and errors', async () => {
  let complete;
  const f = await openCatalogue({ aiResponse: () => new Promise(resolve => { complete = resolve; }) });
  f.context.openDialog(); f.fields.get('ean').value = '3017620422003';
  const pending = f.context.lookupProductEan();
  f.fields.get('ean').value = '96385074'; f.fields.get('ean').listeners.get('input')();
  complete({ ok: true, status: 200, json: async () => ({ encontrado: true, campos: { nome: 'Old' } }) });
  await pending;
  assert.equal(f.fields.get('nome').value, '');
  assert.equal(f.elements.get('lookup-product-ean').disabled, false);
  const next = f.context.lookupProductEan(); f.context.closeDialog();
  complete({ ok: false, status: 503, json: async () => ({ error: 'Old error' }) }); await next;
  assert.equal(f.elements.get('product-ai-status').textContent, '');
});

test('DeepSeek reports missing configuration and no match, and hides lookup for read-only details', async () => {
  let response = { ok: false, status: 503, json: async () => ({ error: 'Configure DEEPSEEK_API_KEY' }) };
  const f = await openCatalogue({ role: 'cliente', aiResponse: () => response });
  f.context.openDialog(); f.fields.get('ean').value = '3017620422003';
  await f.context.lookupProductEan();
  assert.match(f.elements.get('product-ai-status').textContent, /DEEPSEEK_API_KEY/);
  assert.equal(f.elements.get('lookup-product-ean').disabled, false);
  response = { ok: true, status: 200, json: async () => ({ encontrado: false }) };
  await f.context.lookupProductEan();
  assert.match(f.elements.get('product-ai-status').textContent, /manualmente/);
  f.context.openDialog({ id: 1, nome: 'Read-only', ean: '3017620422003' });
  assert.equal(f.elements.get('product-ai-tools').hidden, true);
  const count = f.requests.length; await f.context.lookupProductEan();
  assert.equal(f.requests.length, count);
});

test('Google search shows three choices in the modal and the client selects a pending product image', async () => {
  const f = await openCatalogue({ role: 'cliente' });
  f.context.openDialog();
  await f.context.searchInternetImages();
  assert.equal(f.opened.length, 0);
  f.fields.get('ean').value = '301 7620 422003';
  assert.equal(f.elements.get('save-product-button').hidden, false);
  assert.doesNotMatch(markup.match(/<button[^>]*id="save-product-button"[^>]*>/)[0], /data-admin-only/);
  await f.context.searchInternetImages();
  assert.equal(f.opened.length, 0);
  assert.ok(f.requests.includes('/api/product-images/search/3017620422003'));
  const choices = f.elements.get('product-image-results').children;
  assert.equal(choices.length, 3);
  choices[1].listeners.get('click')();
  assert.equal(choices[1]['aria-pressed'], 'true');
  assert.equal(choices[0]['aria-pressed'], 'false');
  assert.equal(f.context.payloadFromForm().imagem_busca_token, 'token-2');
  assert.equal(f.context.payloadFromForm().imagem_upload, undefined);
  assert.match(f.elements.get('product-image-search-status').textContent, /fundo branco será removido ao salvar/);
  assert.match(f.elements.get('image-caption').textContent, /Prévia original/);
  const file = { type: 'image/png', size: 100, data: 'data:image/png;base64,abcd' };
  f.context.selectProductImage(file);
  f.readers[0].onload();
  assert.equal(f.context.payloadFromForm().imagem_upload, file.data);
  assert.equal(f.context.payloadFromForm().imagem_busca_token, undefined);
  assert.equal(f.context.payloadFromForm().status, 'pendente');
  assert.equal(f.fields.get('status').disabled, true);
  f.fields.get('ean').value = '12345678';
  f.fields.get('ean').listeners.get('input')();
  assert.equal(f.context.payloadFromForm().imagem_upload, undefined);
  assert.equal(f.elements.get('product-image-results').children.length, 0);
});

test('late search results are discarded after changing EAN or closing the modal', async () => {
  let complete;
  const f = await openCatalogue({ imageResponse: () => new Promise(resolve => { complete = resolve; }) });
  f.context.openDialog();
  f.fields.get('ean').value = '3017620422003';
  const pending = f.context.searchInternetImages();
  f.fields.get('ean').value = '12345678';
  f.fields.get('ean').listeners.get('input')();
  complete({ ok: true, status: 200, json: async () => ({ items: [{ position: 1, token: 'old', preview: 'data:image/webp;base64,abc' }] }) });
  await pending;
  assert.equal(f.elements.get('product-image-results').children.length, 0);
  assert.equal(f.elements.get('search-product-image').disabled, false);
  const next = f.context.searchInternetImages();
  f.context.closeDialog();
  complete({ ok: false, status: 503, json: async () => ({ error: 'Old error' }) });
  await next;
  assert.equal(f.elements.get('product-image-search-status').textContent, '');
});

test('search errors and empty results are visible and allow retries', async () => {
  let response = { ok: false, status: 503, json: async () => ({ error: 'Configure SERPAPI_API_KEY' }) };
  const f = await openCatalogue({ imageResponse: () => response });
  f.context.openDialog(); f.fields.get('ean').value = '3017620422003';
  await f.context.searchInternetImages();
  assert.match(f.elements.get('product-image-search-status').textContent, /SERPAPI_API_KEY/);
  assert.equal(f.elements.get('search-product-image').disabled, false);
  response = { ok: true, status: 200, json: async () => ({ items: [] }) };
  await f.context.searchInternetImages();
  assert.match(f.elements.get('product-image-search-status').textContent, /Nenhuma imagem/);
});

test('paste accepts image bytes, explains URL-only paste, and closing discards unfinished reads', async () => {
  const f = await openCatalogue();
  f.context.openDialog();
  f.fields.get('ean').value = '3017620422003';
  const file = { type: 'image/png', size: 100, data: 'data:image/png;base64,abcd' };
  let prevented = false;
  f.context.pasteProductImage({ clipboardData: { items: [{ type: file.type, getAsFile: () => file }] }, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  f.context.closeDialog();
  f.readers[0].onload();
  assert.equal(f.context.payloadFromForm().imagem_upload, undefined);
  f.context.pasteProductImage({ target: f.elements.get('product-image-paste'), clipboardData: { items: [] }, preventDefault() {} });
  assert.match(f.elements.get('product-image-search-status').textContent, /Copie a imagem/);
  f.context.selectProductImage({ ...file, size: 9 * 1024 * 1024 });
  assert.match(f.elements.get('product-image-search-status').textContent, /8 MB/);
});

test('opening the real catalogue page loads products without referencing removed summary counters', async () => {
  const { elements, requests } = await openCatalogue();
  assert.equal(elements.has('summary-total'), false);
  assert.equal(elements.get('toast').hidden, true);
  assert.equal(requests.includes('/api/summary'), false);
  assert.equal(elements.get('product-grid').hidden, false);
  assert.equal(elements.get('product-grid').children.length, 1);
  assert.equal(elements.get('page-indicator').textContent, '1 / 2');
  assert.equal(elements.get('previous-page-button').disabled, true);
  assert.equal(elements.get('next-page-button').disabled, false);
  assert.equal(elements.get('category-filter').children.length, 2);
});

test('a catalogue API failure keeps its original error message and allows the list to recover', async () => {
  let failure = 'Serviço temporariamente indisponível.';
  const { elements, context } = await openCatalogue({ productsError: () => failure });
  assert.equal(elements.has('empty-state'), false);
  assert.equal(elements.get('toast').textContent, failure);
  assert.equal(elements.get('toast').classList.contains('error'), true);
  assert.equal(elements.get('results-title').textContent, 'Tente novamente');
  assert.equal(elements.get('product-grid').hidden, true);
  failure = null;
  await context.loadProducts();
  assert.equal(elements.get('product-grid').hidden, false);
  assert.equal(elements.get('product-grid').children.length, 1);
  assert.equal(elements.get('results-title').textContent, '49 produtos');
});

test('an empty catalogue updates pagination without showing an error toast', async () => {
  const { elements } = await openCatalogue({ empty: true });
  assert.equal(elements.get('toast').hidden, true);
  assert.equal(elements.get('results-kicker').textContent, 'Nenhum resultado');
  assert.equal(elements.get('product-grid').hidden, true);
  assert.equal(elements.get('next-page-button').disabled, true);
});

test('AI and image loading indicators are independent and reset on completion, errors and cancellation', async () => {
  const aiReplies = [], imageReplies = [];
  const f = await openCatalogue({
    aiResponse: () => new Promise(resolve => aiReplies.push(resolve)),
    imageResponse: () => new Promise(resolve => imageReplies.push(resolve)),
  });
  f.context.openDialog(); f.fields.get('ean').value = '3017620422003';
  const assertLoading = (kind, value) => {
    const ai = kind === 'ai';
    const button = f.elements.get(ai ? 'lookup-product-ean' : 'search-product-image');
    assert.equal(button['aria-busy'], String(value));
    assert.equal(button.disabled, value);
    assert.equal(f.elements.get(ai ? 'product-ai-status' : 'product-image-search-status').classList.contains('lookup-loading'), value);
  };
  const ai = f.context.lookupProductEan(), images = f.context.searchInternetImages();
  assertLoading('ai', true); assertLoading('images', true);
  imageReplies.shift()({ ok: true, status: 200, json: async () => ({ items: [] }) });
  await images;
  assertLoading('images', false); assertLoading('ai', true);
  aiReplies.shift()({ ok: false, status: 503, json: async () => ({ error: 'Falha de teste' }) });
  await ai;
  assertLoading('ai', false);
  const oldAi = f.context.lookupProductEan(), oldImages = f.context.searchInternetImages();
  f.fields.get('ean').value = '96385074'; f.fields.get('ean').listeners.get('input')();
  assertLoading('ai', false); assertLoading('images', false);
  const newAi = f.context.lookupProductEan(), newImages = f.context.searchInternetImages();
  aiReplies.shift()({ ok: true, status: 200, json: async () => ({ encontrado: false }) });
  imageReplies.shift()({ ok: true, status: 200, json: async () => ({ items: [] }) });
  await Promise.all([oldAi, oldImages]);
  assertLoading('ai', true); assertLoading('images', true);
  f.context.closeDialog();
  assertLoading('ai', false); assertLoading('images', false);
  aiReplies.shift()({ ok: true, status: 200, json: async () => ({ encontrado: false }) });
  imageReplies.shift()({ ok: false, status: 503, json: async () => ({ error: 'Falha antiga' }) });
  await Promise.all([newAi, newImages]);
  assertLoading('ai', false); assertLoading('images', false);
});

test('partial AI results explain that the manufacturer still needs manual input', async () => {
  const f = await openCatalogue({ aiResponse: () => ({
    ok: true, status: 200, json: async () => ({ encontrado: true, campos: { nome: 'Produto', fabricante: null }, fontes: [] }),
  }) });
  f.context.openDialog(); f.fields.get('ean').value = '3017620422003';
  await f.context.lookupProductEan();
  assert.match(f.elements.get('product-ai-status').textContent, /Fabricante não confirmado/);
});
