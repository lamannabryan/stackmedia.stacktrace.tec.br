import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../public/js/theme.js', import.meta.url), 'utf8');
const key = 'vidamix-theme';

function fixture({ saved = null, dark = false, blocked = false } = {}) {
  const events = () => {
    const listeners = new Map();
    return { addEventListener: (name, handler) => listeners.set(name, handler),
      emit: (name, event = {}) => listeners.get(name)?.(event) };
  };
  const media = { ...events(), matches: dark };
  const attributes = new Map();
  const button = { ...events(), setAttribute: (name, value) => attributes.set(name, value) };
  const meta = { setAttribute: (_name, value) => { meta.content = value; } };
  const header = { children: [], append(child) { this.children.push(child); } };
  const root = { dataset: {} };
  const logo = { setAttribute(name, value) { this[name] = value; } };
  const storage = new Map(saved === null ? [] : [[key, saved]]);
  const win = { ...events(), matchMedia: () => media, localStorage: {
    getItem(name) { if (blocked) throw Error('blocked'); return storage.get(name) ?? null; },
    setItem(name, value) { if (blocked) throw Error('blocked'); storage.set(name, value); },
  } };
  const doc = { ...events(), documentElement: root, readyState: 'loading', body: header,
    createElement: () => button,
    querySelectorAll: () => [logo],
    querySelector: (selector) => selector === 'meta[name="theme-color"]' ? meta : selector === '.site-header-inner' ? header : null,
  };
  vm.runInNewContext(source, { window: win, document: doc });
  return { win, doc, root, media, storage, attributes, button, header, meta, logo };
}

test('system theme is applied before content and the toggle mounts after parsing', () => {
  for (const dark of [true, false]) {
    const f = fixture({ dark });
    assert.equal(f.root.dataset.theme, dark ? 'dark' : 'light');
    assert.equal(f.logo.src, dark ? '/branding/stackmedia-wordmark-dark.svg' : '/branding/stackmedia-wordmark.svg');
    assert.equal(f.meta.content, dark ? '#151515' : '#f3ede8');
    assert.equal(f.header.children.length, 0);
    f.doc.emit('DOMContentLoaded');
    assert.equal(f.header.children[0], f.button);
    assert.equal(f.attributes.get('aria-pressed'), String(dark));
  }
});

test('a click saves the choice and updates accessible labels and browser chrome', () => {
  const f = fixture();
  f.doc.emit('DOMContentLoaded');
  f.button.emit('click');
  assert.equal(f.root.dataset.theme, 'dark');
  assert.equal(f.storage.get(key), 'dark');
  assert.equal(f.logo.src, '/branding/stackmedia-wordmark-dark.svg');
  assert.equal(f.attributes.get('aria-label'), 'Ativar modo claro');
  assert.equal(f.meta.content, '#151515');
  assert.equal(fixture({ saved: f.storage.get(key) }).root.dataset.theme, 'dark');
  f.button.emit('click');
  assert.equal(f.storage.get(key), 'light');
  assert.equal(f.logo.src, '/branding/stackmedia-wordmark.svg');
  assert.equal(f.attributes.get('aria-label'), 'Ativar modo escuro');
});

test('system changes are followed only until an explicit choice is made', () => {
  const f = fixture();
  f.media.matches = true;
  f.media.emit('change');
  assert.equal(f.root.dataset.theme, 'dark');
  f.doc.emit('DOMContentLoaded');
  f.button.emit('click');
  f.media.emit('change');
  assert.equal(f.root.dataset.theme, 'light');
  assert.equal(fixture({ saved: 'light', dark: true }).root.dataset.theme, 'light');
});

test('other tabs and back/forward restores refresh the theme', () => {
  const f = fixture();
  f.storage.set(key, 'dark');
  f.win.emit('storage', { key: 'unrelated' });
  assert.equal(f.root.dataset.theme, 'light');
  f.win.emit('storage', { key });
  assert.equal(f.root.dataset.theme, 'dark');
  f.storage.clear();
  f.win.emit('storage', { key: null });
  assert.equal(f.root.dataset.theme, 'light');
  f.storage.set(key, 'dark');
  f.win.emit('pageshow');
  assert.equal(f.root.dataset.theme, 'dark');
});

test('invalid or blocked storage never prevents the app or toggle from working', () => {
  assert.equal(fixture({ saved: 'unknown', dark: true }).root.dataset.theme, 'dark');
  const f = fixture({ blocked: true });
  f.doc.emit('DOMContentLoaded');
  f.button.emit('click');
  f.win.emit('pageshow');
  assert.equal(f.root.dataset.theme, 'dark');
  f.button.emit('click');
  assert.equal(f.root.dataset.theme, 'light');
});

test('all pages bootstrap the theme before styles and load overrides last, including offline', async () => {
  for (const page of ['index', 'catalogo', 'stories', 'feed', 'indoor-h', 'offline']) {
    const html = await readFile(new URL(`../public/${page}.html`, import.meta.url), 'utf8');
    const bootstrap = html.indexOf('<script src="/js/theme.js"></script>');
    assert.ok(bootstrap > 0 && bootstrap < html.indexOf('rel="stylesheet"'), page);
    const links = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)];
    assert.equal(links.at(-1)[1], '/theme.css', page);
  }
});
