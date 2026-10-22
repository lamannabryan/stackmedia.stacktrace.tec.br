import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const script = await readFile(new URL('../public/js/features/catalogue/mobile.js', import.meta.url), 'utf8');

class Element {
  constructor() {
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.properties = new Map();
    this.value = '';
    this.selectedOptions = [];
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
    this.open = false;
    const classes = new Set();
    this.classList = {
      contains: (name) => classes.has(name),
      toggle: (name, active) => active ? classes.add(name) : classes.delete(name),
    };
    this.style = {
      setProperty: (name, value) => this.properties.set(name, value),
      removeProperty: (name) => this.properties.delete(name),
    };
  }
  append(element) {
    if (element.parentElement) element.parentElement.children = element.parentElement.children.filter((child) => child !== element);
    this.children.push(element);
    element.parentElement = this;
  }
  insertBefore(element, reference) {
    this.append(element);
    this.children = this.children.filter((child) => child !== element);
    this.children.splice(Math.max(0, this.children.indexOf(reference)), 0, element);
  }
  get firstElementChild() { return this.children[0]; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  dispatch(name, event = {}) { this.listeners.get(name)?.(event); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  querySelector(selector) { return selector === 'summary' ? this.summary : this.loading ? {} : null; }
  click() { this.dispatch('click'); }
  blur() { this.blurred = true; }
  scrollIntoView() { this.scrolled = true; }
}

function openMobileCatalogue() {
  const selectors = ['#catalogue-filter-details', '#catalogue-filter-count', '#catalogue-filter-summary', '#search-input',
    '#product-dialog', '#delete-product-button', '.dialog-footer', '.form-fields', '#toast', '#product-grid',
    '#page-indicator', '#previous-page-button', '#next-page-button', '#catalogue-previous-bottom', '#catalogue-next-bottom',
    '#catalogue-bottom-pagination', '#catalogue-page-bottom', '#category-chips', '#clear-filters-button',
    '.form-layout', '.results-heading', '#category-filter', '#status-filter', '#image-filter'];
  const elements = new Map(selectors.map((selector) => [selector, new Element()]));
  const get = (selector) => elements.get(selector);
  const root = new Element();
  const body = new Element();
  const media = new Element();
  media.matches = true;
  const viewport = new Element();
  viewport.height = 844;
  viewport.offsetTop = 0;
  get('#catalogue-filter-details').summary = new Element();
  get('#image-filter').value = 'com';
  get('#image-filter').selectedOptions = [{ textContent: 'Com imagem local' }];
  get('#page-indicator').textContent = '1 / 3';
  get('#previous-page-button').disabled = true;
  get('.dialog-footer').append(get('#delete-product-button'));
  body.append(get('#toast'));
  const observers = [];
  const context = vm.createContext({
    document: {
      documentElement: root,
      querySelector: get,
      getElementById: (id) => get(`#${id}`),
    },
    window: { matchMedia: () => media, visualViewport: viewport, innerHeight: 844, addEventListener() {} },
    queueMicrotask: (callback) => callback(),
    MutationObserver: class {
      constructor(callback) { this.callback = callback; }
      observe(target) { observers.push({ target, callback: this.callback }); }
    },
  });
  vm.runInContext(script, context);
  return { get, root, body, media, viewport, notify: (target) => observers.filter((item) => item.target === target).forEach((item) => item.callback()) };
}

test('mobile filters start compact and preserve all controls when returning to desktop', () => {
  const { get, media } = openMobileCatalogue();
  assert.equal(get('#catalogue-filter-details').open, false);
  assert.equal(get('#catalogue-filter-count').textContent, '1');
  assert.equal(get('#catalogue-filter-summary').textContent, 'Com imagem local');
  assert.equal(get('#delete-product-button').parentElement, get('.form-fields'));
  media.matches = false;
  media.dispatch('change');
  assert.equal(get('#catalogue-filter-details').open, true);
  assert.equal(get('#delete-product-button').parentElement, get('.dialog-footer'));
});

test('changing filters keeps the collapsed summary and count accurate', () => {
  const { get } = openMobileCatalogue();
  get('#category-filter').value = 'Higiene';
  get('#category-filter').selectedOptions = [{ textContent: 'Higiene (18)' }];
  get('#category-chips').click();
  assert.equal(get('#catalogue-filter-count').textContent, '2');
  assert.equal(get('#catalogue-filter-summary').textContent, 'Higiene (18) · Com imagem local');
  assert.match(get('#catalogue-filter-details').summary.attributes.get('aria-label'), /Higiene/);
  for (const id of ['category-filter', 'image-filter']) get(`#${id}`).value = '';
  get('#clear-filters-button').click();
  assert.equal(get('#catalogue-filter-count').hidden, true);
  assert.equal(get('#catalogue-filter-summary').textContent, 'Todos os produtos');
});

test('bottom pagination uses existing navigation and stays disabled while products load', () => {
  const { get, notify } = openMobileCatalogue();
  let nextPages = 0;
  get('#next-page-button').addEventListener('click', () => { nextPages += 1; });
  assert.equal(get('#catalogue-previous-bottom').disabled, true);
  assert.equal(get('#catalogue-next-bottom').disabled, false);
  get('#catalogue-next-bottom').click();
  assert.equal(nextPages, 1);
  assert.equal(get('.results-heading').scrolled, true);
  get('#product-grid').loading = true;
  notify(get('#product-grid'));
  assert.equal(get('#catalogue-next-bottom').disabled, true);
  get('#product-grid').loading = false;
  get('#page-indicator').textContent = '2 / 3';
  get('#previous-page-button').disabled = false;
  notify(get('#page-indicator'));
  assert.equal(get('#catalogue-page-bottom').textContent, '2 / 3');
  assert.equal(get('#catalogue-previous-bottom').disabled, false);
});

test('mobile product form follows the keyboard viewport and keeps validation in the modal layer', () => {
  const { get, root, body, viewport, notify } = openMobileCatalogue();
  get('#product-dialog').open = true;
  notify(get('#product-dialog'));
  assert.equal(root.classList.contains('catalogue-dialog-open'), true);
  assert.equal(get('#toast').parentElement, get('#product-dialog'));
  viewport.height = 480;
  viewport.offsetTop = 20;
  viewport.dispatch('resize');
  assert.equal(get('#product-dialog').properties.get('--catalogue-viewport-height'), '480px');
  assert.equal(get('#product-dialog').properties.get('--catalogue-viewport-top'), '20px');
  get('#product-dialog').open = false;
  notify(get('#product-dialog'));
  assert.equal(root.classList.contains('catalogue-dialog-open'), false);
  assert.equal(get('#toast').parentElement, body);
  assert.equal(get('#product-dialog').properties.has('--catalogue-viewport-height'), false);
  get('#search-input').dispatch('keydown', { key: 'Enter' });
  assert.equal(get('#search-input').blurred, true);
});

test('the guided tour opens filters temporarily and restores the prior mobile state', () => {
  const { get, root, notify } = openMobileCatalogue();
  root.classList.toggle('tour-is-open', true);
  notify(root);
  assert.equal(get('#catalogue-filter-details').open, true);
  root.classList.toggle('tour-is-open', false);
  notify(root);
  assert.equal(get('#catalogue-filter-details').open, false);
});
