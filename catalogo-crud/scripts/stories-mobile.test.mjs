import assert from 'node:assert/strict';
import test from 'node:test';
import { initStoriesMobileEditor } from '../public/js/features/stories/mobile-editor.js';

class EventHost {
  listeners = new Map();
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  dispatch(type, details = {}) {
    const event = { target: this, defaultPrevented: false, ...details,
      preventDefault() { this.defaultPrevented = true; } };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
}

class Element extends EventHost {
  constructor(doc, tagName = 'section', id = '') {
    super();
    this.ownerDocument = doc;
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.hidden = false;
    this.textContent = '';
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      toggle(name, force = !classes.has(name)) {
        if (force) classes.add(name); else classes.delete(name);
        return force;
      },
    };
    const properties = new Map();
    this.style = {
      setProperty: (name, value) => properties.set(name, value),
      removeProperty: (name) => properties.delete(name),
      getPropertyValue: (name) => properties.get(name) || '',
    };
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...elements) {
    for (const element of elements) {
      element.parentNode?.removeChild(element);
      this.children.push(element);
      element.parentNode = this;
    }
  }
  removeChild(element) {
    this.children.splice(this.children.indexOf(element), 1);
    element.parentNode = null;
  }
  insertBefore(element, next) {
    element.parentNode?.removeChild(element);
    this.children.splice(this.children.indexOf(next), 0, element);
    element.parentNode = this;
  }
  replaceChild(element, previous) {
    element.parentNode?.removeChild(element);
    this.children[this.children.indexOf(previous)] = element;
    previous.parentNode = null;
    element.parentNode = this;
  }
  contains(element) { return this === element || this.children.some((child) => child.contains(element)); }
  matches(selector) {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    const className = selector.match(/^\.([\w-]+)/)?.[1];
    if (className && !this.classList.contains(className)) return false;
    const attribute = selector.match(/\[([\w-]+)(?:="([^"]+)")?\]/);
    if (attribute) {
      const [, name, expected] = attribute;
      const value = name.startsWith('data-')
        ? this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())]
        : this.getAttribute(name);
      return expected === undefined ? value != null : value === expected;
    }
    return Boolean(className);
  }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) || null; }
  focus() {
    this.ownerDocument.activeElement = this;
    this.ownerDocument.dispatch('focusin', { target: this });
  }
  blur() {
    if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body;
    this.ownerDocument.dispatch('focusout', { target: this });
  }
  click() { if (!this.disabled) this.dispatch('click'); }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatch('close'); }
  dispatchEvent(event) { this.dispatch(event.type, event); }
}

function createFixture(isMobile = true) {
  const doc = new EventHost();
  const view = new EventHost();
  const media = new EventHost();
  const viewport = new EventHost();
  const frames = new Map();
  let frameId = 0;
  Object.assign(viewport, { height: 800, offsetTop: 0, scale: 1 });
  Object.assign(view, {
    innerHeight: 800, innerWidth: isMobile ? 390 : 1280, visualViewport: viewport,
    matchMedia: () => media,
    Event: class { constructor(type) { this.type = type; } },
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
  });
  media.matches = isMobile;
  doc.defaultView = view;
  doc.body = new Element(doc, 'body');
  doc.activeElement = doc.body;
  doc.documentElement = { clientHeight: 800, clientWidth: view.innerWidth };
  doc.querySelector = (selector) => doc.body.querySelector(selector);
  doc.querySelectorAll = (selector) => doc.body.querySelectorAll(selector);
  doc.createComment = () => new Element(doc, '#comment');
  const add = (id, parent = doc.body, tag = 'section') => {
    const node = new Element(doc, tag, id);
    parent.append(node);
    return node;
  };
  const sidebar = add('desktop-sidebar');
  const actions = add('desktop-actions');
  const dialog = add('story-mobile-dialog', doc.body, 'dialog');
  const scrollport = add('mobile-panels-scrollport', dialog);
  scrollport.classList.add('story-mobile-panels');
  const backLink = add('desktop-back-link', doc.body, 'a');
  backLink.classList.add('stories-back-link');
  const panels = {};
  const buttons = {};
  const controls = {};
  for (const name of ['background', 'products', 'offer', 'export']) {
    controls[name] = add(`control-${name}`, name === 'export' ? actions : sidebar);
    controls[name].dataset.mobileGroup = name;
    panels[name] = add(`story-mobile-panel-${name}`, scrollport);
    buttons[name] = add(`story-mobile-${name}-button`, doc.body, 'button');
    buttons[name].dataset.mobilePanel = name;
    buttons[name].classList.add('story-mobile-only');
  }
  const desktopAdjust = add('desktop-adjust-controls', sidebar);
  desktopAdjust.dataset.mobileGroup = 'adjust';
  const toggle = add('story-background-toggle', controls.background, 'button');
  toggle.classList.add('story-section-collapse-toggle');
  toggle.setAttribute('aria-expanded', 'false');
  const backgroundContent = add('story-background-content', controls.background);
  backgroundContent.hidden = true;
  toggle.addEventListener('click', () => {
    backgroundContent.hidden = !backgroundContent.hidden;
    toggle.setAttribute('aria-expanded', String(!backgroundContent.hidden));
  });
  const input = add('story-price', controls.offer, 'input');
  input.type = 'text'; input.value = '29,90';
  const sourceAuto = add('story-auto-layout-button', desktopAdjust, 'button');
  sourceAuto.disabled = true;
  const anchorSection = add('story-anchor-section', desktopAdjust);
  anchorSection.hidden = true;
  const sourceAnchor = add('story-elements-anchor', anchorSection, 'input');
  sourceAnchor.type = 'checkbox'; sourceAnchor.checked = false;
  const nodes = {};
  for (const name of ['dialog-title', 'close', 'confirm', 'dialog-footer', 'status']) nodes[name] = add(`story-mobile-${name}`, dialog, 'button');
  for (const name of ['auto-layout', 'anchor', 'canvas-status']) nodes[name] = add(`story-mobile-${name}`, doc.body, 'button');
  const sourceStatus = add('story-status');
  sourceStatus.textContent = 'Informe o preço para finalizar a arte.';
  const progress = { background: true, products: false, offer: false, ready: false, exporting: false };
  const changes = [];
  const initialize = () => initStoriesMobileEditor({ root: doc, getProgress: () => progress, onStepChange: (step) => changes.push(step) });
  const resize = (mobile) => { media.matches = mobile; view.innerWidth = mobile ? 390 : 1280; media.dispatch('change'); };
  const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback()); };
  return { doc, view, viewport, media, sidebar, actions, dialog, controls, panels, buttons, nodes, scrollport, backLink,
    desktopAdjust, toggle, backgroundContent, input, sourceAuto, sourceAnchor, anchorSection, sourceStatus,
    progress, changes, initialize, resize, flush };
}

test('mobile opens on an unlocked canvas and shares controls without exposing adjustment panels', () => {
  const f = createFixture();
  const editor = f.initialize();
  assert.equal(Boolean(f.dialog.open), false);
  assert.equal(f.doc.body.classList.contains('story-mobile-modal-open'), false);
  assert.equal(f.controls.offer.parentNode, f.panels.offer);
  assert.equal(f.doc.querySelector('#story-price'), f.input);
  assert.equal(f.desktopAdjust.parentNode, f.sidebar);
  assert.equal(editor.showStep('adjust'), false);
  assert.equal(editor.showStep('unknown'), false);
  editor.destroy();
});

test('background selection closes its dialog and restores focus to its floating button', () => {
  const f = createFixture();
  const editor = f.initialize();
  f.buttons.background.click();
  assert.equal(f.dialog.open, true);
  assert.equal(f.backgroundContent.hidden, false);
  assert.equal(f.doc.activeElement, f.nodes.close);
  assert.equal(f.buttons.background.getAttribute('aria-expanded'), 'true');
  assert.equal(f.doc.body.classList.contains('story-mobile-modal-open'), true);
  editor.selectionComplete('background');
  assert.equal(f.dialog.open, false);
  assert.equal(f.doc.activeElement, f.buttons.background);
  assert.equal(f.doc.body.classList.contains('story-mobile-modal-open'), false);
  editor.destroy();
});

test('product dialog stays open for incomplete slots, and closes only after a completed selection', () => {
  const f = createFixture();
  const editor = f.initialize();
  f.buttons.products.click();
  editor.selectionComplete('products', false);
  assert.equal(f.dialog.open, true, 'first of two products remains in the picker');
  f.progress.products = true;
  editor.sync();
  assert.equal(f.dialog.open, true, 'background image loading does not dismiss a picker');
  editor.selectionComplete('background');
  assert.equal(f.dialog.open, true, 'a different panel cannot dismiss this dialog');
  editor.selectionComplete('products', true);
  assert.equal(f.dialog.open, false);
  assert.equal(f.doc.activeElement, f.buttons.products);
  f.buttons.products.click();
  assert.equal(f.dialog.open, true, 'completed products can be reopened and changed');
  editor.selectionComplete('products');
  assert.equal(f.dialog.open, false, 'a single product selection can close immediately');
  editor.destroy();
});

test('price edits remain open until explicit confirmation and keep the original input state', () => {
  const f = createFixture();
  const editor = f.initialize();
  let inputEvents = 0;
  f.input.addEventListener('input', () => inputEvents += 1);
  f.buttons.offer.click();
  assert.equal(f.nodes['dialog-footer'].hidden, false);
  assert.equal(f.doc.activeElement, f.input, 'the price field receives focus synchronously on tap');
  assert.equal(f.input.value, '29,90', 'opening the dialog preserves the current price');
  f.input.value = '37,50';
  f.input.dispatch('input');
  f.progress.offer = true;
  editor.sync();
  editor.selectionComplete('offer');
  assert.equal(f.dialog.open, true);
  f.nodes.confirm.click();
  assert.equal(f.dialog.open, false);
  assert.equal(f.doc.activeElement, f.buttons.offer);
  assert.equal(f.input.value, '37,50');
  assert.equal(inputEvents, 1);
  editor.destroy();
});

test('close button, Escape and backdrop dismiss with focus restoration; dragging off a field does not', () => {
  const f = createFixture();
  const editor = f.initialize();
  f.buttons.offer.click();
  f.dialog.dispatch('pointerdown', { target: f.input });
  f.dialog.dispatch('click');
  assert.equal(f.dialog.open, true);
  f.dialog.dispatch('pointerdown');
  f.dialog.dispatch('click');
  assert.equal(f.dialog.open, false);
  f.buttons.offer.click();
  const cancel = f.dialog.dispatch('cancel');
  assert.equal(cancel.defaultPrevented, true);
  assert.equal(f.dialog.open, false);
  assert.equal(f.doc.activeElement, f.buttons.offer);
  f.buttons.offer.click();
  f.nodes.close.click();
  assert.equal(f.dialog.open, false);
  editor.destroy();
});

test('desktop order and focused inputs survive resizing and destruction', () => {
  const f = createFixture(false);
  const order = [...f.sidebar.children];
  const editor = f.initialize();
  assert.equal(f.controls.offer.parentNode, f.sidebar);
  f.input.focus();
  f.resize(true);
  assert.equal(f.dialog.open, true);
  assert.equal(f.panels.offer.hidden, false);
  assert.equal(f.doc.activeElement, f.input);
  f.resize(false);
  assert.equal(f.dialog.open, false);
  assert.deepEqual(f.sidebar.children, order);
  assert.equal(f.controls.export.parentNode, f.actions);
  assert.equal(f.doc.activeElement, f.input);
  f.resize(true);
  f.nodes.close.focus();
  f.resize(false);
  assert.equal(f.doc.activeElement, f.backLink);
  f.resize(true);
  editor.destroy();
  assert.deepEqual(f.sidebar.children, order);
  f.buttons.offer.click();
  assert.equal(f.dialog.open, false, 'destroy removes floating button listeners');
});

test('auto layout and linking buttons mirror the existing desktop actions and availability', () => {
  const f = createFixture();
  const editor = f.initialize();
  let autoCalls = 0;
  let anchorCalls = 0;
  f.sourceAuto.addEventListener('click', () => autoCalls += 1);
  f.sourceAnchor.addEventListener('change', () => anchorCalls += 1);
  assert.equal(f.nodes['auto-layout'].disabled, true);
  assert.equal(f.nodes.anchor.disabled, true);
  f.sourceAuto.disabled = false;
  f.anchorSection.hidden = false;
  editor.sync();
  f.nodes['auto-layout'].click();
  assert.equal(autoCalls, 1);
  f.nodes.anchor.click();
  assert.equal(f.sourceAnchor.checked, true);
  assert.equal(f.nodes.anchor.getAttribute('aria-pressed'), 'true');
  f.nodes.anchor.click();
  assert.equal(f.sourceAnchor.checked, false);
  assert.equal(anchorCalls, 2);
  editor.destroy();
});

test('export uses original controls, preserves progress while closed, and reflects errors on reopening', () => {
  const f = createFixture();
  const editor = f.initialize();
  f.buttons.export.click();
  assert.equal(f.controls.export.parentNode, f.panels.export);
  assert.equal(f.nodes['dialog-footer'].hidden, true);
  f.progress.exporting = true;
  editor.sync();
  assert.equal(f.dialog.getAttribute('aria-busy'), 'true');
  f.nodes.close.click();
  f.sourceStatus.textContent = 'Falha ao exportar. Tente novamente.';
  f.sourceStatus.classList.add('is-error');
  editor.sync();
  assert.equal(f.dialog.open, false);
  assert.equal(f.nodes['canvas-status'].hidden, false, 'asynchronous errors remain visible after a picker is closed');
  assert.equal(f.nodes['canvas-status'].textContent, f.sourceStatus.textContent);
  f.buttons.export.click();
  assert.equal(f.nodes.status.textContent, f.sourceStatus.textContent);
  assert.equal(f.nodes.status.classList.contains('is-error'), true);
  f.sourceStatus.classList.remove('is-error');
  f.sourceStatus.textContent = 'Arte pronta.';
  editor.sync();
  assert.equal(f.nodes['canvas-status'].hidden, true);
  assert.equal(f.doc.body.classList.contains('story-mobile-has-error'), false);
  editor.destroy();
});

test('visual viewport follows the iOS keyboard and panning without confusing pinch zoom', () => {
  const f = createFixture();
  const editor = f.initialize();
  f.buttons.offer.click();
  f.input.focus();
  f.viewport.height = 470;
  f.viewport.offsetTop = 180;
  f.viewport.dispatch('resize');
  f.flush();
  assert.equal(f.doc.body.classList.contains('story-mobile-keyboard-open'), true);
  assert.equal(f.doc.body.style.getPropertyValue('--story-viewport-height'), '470px');
  assert.equal(f.doc.body.style.getPropertyValue('--story-viewport-top'), '180px');
  f.viewport.scale = 1.5;
  f.viewport.dispatch('resize'); f.flush();
  assert.equal(f.doc.body.classList.contains('story-mobile-keyboard-open'), false);
  f.nodes.confirm.click(); f.flush();
  assert.equal(f.dialog.open, false);
  f.resize(false);
  assert.equal(f.doc.body.style.getPropertyValue('--story-viewport-height'), '');
  assert.equal(f.doc.body.style.getPropertyValue('--story-viewport-top'), '');
  editor.destroy();
});

test('keyboard detection handles Android layout resizing and resets on rotation', () => {
  const f = createFixture();
  f.view.visualViewport = null;
  const editor = f.initialize();
  f.buttons.offer.click(); f.input.focus();
  f.view.innerHeight = f.doc.documentElement.clientHeight = 470;
  f.view.dispatch('resize'); f.flush();
  assert.equal(f.doc.body.classList.contains('story-mobile-keyboard-open'), true);
  f.view.innerWidth = 800;
  f.view.innerHeight = f.doc.documentElement.clientHeight = 390;
  f.view.dispatch('orientationchange'); f.flush();
  assert.equal(f.doc.body.classList.contains('story-mobile-keyboard-open'), false);
  editor.destroy();
});

test('tour reveal highlights floating controls without stacking a second modal', () => {
  const f = createFixture();
  const editor = f.initialize();
  f.buttons.products.click();
  f.doc.dispatch('story:reveal-target', { detail: { target: f.buttons.background } });
  assert.equal(f.dialog.open, false);
  assert.equal(f.doc.body.classList.contains('story-mobile-modal-open'), false);
  f.doc.dispatch('story:reveal-target', { detail: { target: f.buttons.offer } });
  assert.equal(f.dialog.open, false);
  editor.destroy();
});
