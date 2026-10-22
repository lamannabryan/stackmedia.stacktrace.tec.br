import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const [markup, script] = await Promise.all([
  readFile(new URL('../public/catalogo.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/js/features/catalogue/import.js', import.meta.url), 'utf8'),
]);
const preview = { sheet: 'Produtos', columns: { ean: 'A', nome: 'N', fabricante: 'Z' }, summary: { total: 3, newProducts: 1, existing: 1, duplicates: 0, invalid: 1 },
  items: [{ row: 2, ean: '0123456789012', nome: '<script>example</script>', fabricante: 'Marca' }],
  issues: [{ row: 3, ean: '12345678', message: 'EAN já cadastrado' }, { row: 4, ean: '12345679', message: 'Nome ausente' }] };

async function open({ role = 'administrador', respond } = {}) {
  class Element {
    constructor() { this.listeners = {}; this.children = []; this.hidden = false; this.disabled = false; this.files = []; this.textContent = ''; }
    addEventListener(type, handler) { this.listeners[type] = handler; }
    dispatchEvent(event) { this.lastEvent = event.type; return this.listeners[event.type]?.(event); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(key, value) { this[key] = value; }
    scrollIntoView() {}
    showModal() { this.open = true; }
    close() { this.open = false; }
  }
  const elements = new Map([...markup.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, new Element()]));
  const requests = [];
  const context = vm.createContext({ Intl, Promise,
    document: { getElementById: id => elements.get(id), createElement: () => new Element() },
    sessionReady: Promise.resolve({ user: { role } }),
    CustomEvent: class { constructor(type) { this.type = type; } },
    FileReader: class { readAsDataURL() { this.result = 'data:application/octet-stream;base64,FILE'; this.onload(); } },
    apiFetch: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      if (respond) return respond(url);
      return { ok: true, json: async () => url.endsWith('/preview') ? preview : { ...preview, imported: 1 } };
    },
  });
  vm.runInContext(script.replace(/^import .+;\r?\n/gm, ''), context);
  await Promise.resolve();
  const element = id => elements.get(id);
  element('product-import-file').files = [{ name: 'exemplo.xlsx', size: 1234 }];
  const fire = (id, type) => element(id).dispatchEvent({ type, preventDefault() {} });
  return { element, requests, fire };
}

test('upload previews before saving, renders spreadsheet text safely and refreshes the catalogue after import', async () => {
  const f = await open();
  assert.equal(f.element('import-products-button').hidden, false);
  await f.fire('import-products-button', 'click'); assert.equal(f.element('product-import-dialog').open, true);
  await f.fire('confirm-product-import', 'click'); assert.equal(f.requests.length, 0);
  await f.fire('product-import-form', 'submit');
  assert.equal(f.requests[0].url, '/api/products/import/preview');
  assert.equal(f.element('confirm-product-import').disabled, false);
  assert.match(f.element('product-import-summary').textContent, /1 com dados inválidos/);
  assert.equal(f.element('product-import-detected-columns').textContent, 'Colunas identificadas: EAN em A, Nome em N e Fabricante em Z.');
  assert.equal(f.element('product-import-items').children[0].children[2].textContent, '<script>example</script>');
  await f.fire('confirm-product-import', 'click');
  assert.equal(f.requests[1].url, '/api/products/import');
  assert.deepEqual(f.requests[1].body, f.requests[0].body);
  assert.equal(f.element('product-import-dialog').lastEvent, 'products-imported');
  assert.equal(f.element('confirm-product-import').disabled, true);
  assert.match(f.element('product-import-status').textContent, /1 produto\(s\) adicionado/);
  await f.fire('confirm-product-import', 'click'); assert.equal(f.requests.length, 2);
});

test('preview displays the detected columns for the second layout without asking the user to choose a format', async () => {
  const f = await open({ respond: async () => ({ ok: true, json: async () => ({ ...preview, columns: { ean: 'A', nome: 'F', fabricante: 'L' } }) }) });
  await f.fire('product-import-form', 'submit');
  assert.equal(f.element('product-import-detected-columns').textContent, 'Colunas identificadas: EAN em A, Nome em F e Fabricante em L.');
  assert.equal(f.element('confirm-product-import').disabled, false);
});

test('changing the file invalidates a preview, invalid files do not upload and clients have no import button', async () => {
  const client = await open({ role: 'cliente' }); assert.equal(client.element('import-products-button').hidden, true);
  const f = await open();
  await f.fire('product-import-form', 'submit');
  await f.fire('product-import-file', 'change');
  assert.equal(f.element('product-import-preview').hidden, true);
  await f.fire('confirm-product-import', 'click'); assert.equal(f.requests.length, 1);
  for (const file of [{ name: 'file.csv', size: 4 }, { name: 'file.xlsx', size: 11 * 1024 * 1024 }]) {
    f.element('product-import-file').files = [file];
    await f.fire('product-import-form', 'submit');
    assert.match(f.element('product-import-status').textContent, /até 10 MB/);
  }
  assert.equal(f.requests.length, 1);
});

test('network errors are visible and an in-flight upload cannot be submitted twice or closed', async () => {
  let release;
  const f = await open({ respond: () => new Promise(resolve => { release = resolve; }) });
  const pending = f.fire('product-import-form', 'submit');
  await Promise.resolve();
  assert.equal(f.element('close-product-import').disabled, true);
  await f.fire('product-import-form', 'submit'); assert.equal(f.requests.length, 1);
  let prevented = false;
  f.element('product-import-dialog').dispatchEvent({ type: 'cancel', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  release({ ok: false, json: async () => ({ error: 'Layout inválido' }) });
  await pending;
  assert.equal(f.element('product-import-status').textContent, 'Layout inválido');
  assert.equal(f.element('close-product-import').disabled, false);
  assert.equal(f.element('confirm-product-import').disabled, true);
});
