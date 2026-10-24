import assert from 'node:assert/strict';
import test from 'node:test';
import { getAppScreen, hasSoftwareKeyboard, initAppShell } from '../public/js/app-shell.js';

class EventHost {
  listeners = new Map();
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  emit(type, event) { for (const listener of this.listeners.get(type) || []) listener(event); }
}

function element() {
  const classes = new Set();
  const properties = new Map();
  const attributes = new Map();
  return {
    children: [], dataset: {},
    classList: {
      add(name) { classes.add(name); },
      contains(name) { return classes.has(name); },
      toggle(name, force) { if (force) classes.add(name); else classes.delete(name); },
    },
    style: {
      setProperty(name, value) { properties.set(name, value); },
      getPropertyValue(name) { return properties.get(name); },
    },
    setAttribute(name, value) { attributes.set(name, value); },
    getAttribute(name) { return attributes.get(name); },
    append(child) { this.children.push(child); },
    matches() { return false; },
  };
}

function fixture({ pathname = '/catalogo', iosStandalone = false, visualViewport = true } = {}) {
  const win = new EventHost();
  const doc = new EventHost();
  const viewport = visualViewport ? Object.assign(new EventHost(), { height: 844, offsetTop: 0, scale: 1 }) : null;
  const standalone = Object.assign(new EventHost(), { matches: false });
  const mobile = Object.assign(new EventHost(), { matches: true });
  const header = element();
  Object.assign(win, {
    innerHeight: 844, innerWidth: 390, visualViewport: viewport,
    location: { pathname }, navigator: { standalone: iosStandalone },
    matchMedia: (query) => query.includes('display-mode') ? standalone : mobile,
    requestAnimationFrame: (callback) => callback(),
  });
  Object.assign(doc, {
    documentElement: Object.assign(element(), { clientHeight: 844, clientWidth: 390 }),
    body: element(), createElement: element, querySelector: () => header,
  });
  doc.activeElement = doc.body;
  const input = Object.assign(element(), { matches: () => true });
  initAppShell(win, doc);
  const focus = () => { doc.activeElement = input; doc.emit('focusin'); };
  const blur = () => { doc.activeElement = doc.body; doc.emit('focusout'); };
  const keyboardOpen = () => doc.documentElement.classList.contains('app-keyboard-open');
  return { win, doc, viewport, standalone, mobile, input, header, focus, blur, keyboardOpen };
}

test('iOS viewport panning keeps the keyboard state until input loses focus', () => {
  const f = fixture();
  f.focus();
  f.viewport.height = 470;
  f.viewport.offsetTop = 260;
  f.viewport.emit('resize');
  assert.equal(f.keyboardOpen(), true);
  assert.equal(f.doc.documentElement.style.getPropertyValue('--app-viewport-top'), '260px');
  f.viewport.offsetTop = 300;
  f.viewport.emit('scroll');
  assert.equal(f.keyboardOpen(), true);
  f.blur();
  assert.equal(f.keyboardOpen(), false);
});

test('Android resize retains the height before editing, with or without VisualViewport', () => {
  for (const visualViewport of [true, false]) {
    const f = fixture({ visualViewport });
    f.focus();
    f.win.innerHeight = f.doc.documentElement.clientHeight = 470;
    if (f.viewport) f.viewport.height = 470;
    f.win.emit('resize');
    assert.equal(f.keyboardOpen(), true);
    f.win.innerHeight = f.doc.documentElement.clientHeight = 844;
    if (f.viewport) f.viewport.height = 844;
    f.win.emit('resize');
    assert.equal(f.keyboardOpen(), false, 'closing the keyboard works even with input still focused');
  }
});

test('rotation resets the height baseline, then portrait keyboard detection still works', () => {
  const f = fixture();
  f.focus();
  f.win.innerWidth = 844;
  f.win.innerHeight = f.doc.documentElement.clientHeight = f.viewport.height = 390;
  f.win.emit('orientationchange');
  assert.equal(f.keyboardOpen(), false, 'a shorter landscape screen is not a keyboard');
  f.win.innerWidth = 390;
  f.win.innerHeight = f.doc.documentElement.clientHeight = f.viewport.height = 844;
  f.win.emit('resize');
  assert.equal(f.keyboardOpen(), false);
  f.viewport.height = 470;
  f.viewport.emit('resize');
  assert.equal(f.keyboardOpen(), true);
});

test('pinch zoom, readonly controls and desktop resizing do not hide navigation', () => {
  const f = fixture();
  f.focus();
  f.viewport.height = 400;
  for (const scale of [1.5, 0.8]) {
    f.viewport.scale = scale;
    f.viewport.emit('resize');
    assert.equal(f.keyboardOpen(), false);
  }
  f.viewport.scale = 1;
  f.input.readOnly = true;
  f.viewport.emit('resize');
  assert.equal(f.keyboardOpen(), false);
  f.input.readOnly = false;
  f.mobile.matches = false;
  f.mobile.emit('change');
  assert.equal(f.keyboardOpen(), false);
  assert.equal(hasSoftwareKeyboard({ editable: false, layoutHeight: 844, visibleHeight: 400 }), false);
});

test('browsing navigation resolves route aliases, while editors keep their own navigation', () => {
  const expected = new Map([
    ['/', 'home'], ['/index.html', 'home'], ['/catalogo/', 'catalogue'], ['/catalogo.html', 'catalogue'],
    ['/artes/stories', 'stories'], ['/stories.html', 'stories'], ['/artes/feed/', 'feed'], ['/feed.html', 'feed'],
    ['/artes/indoor-h', 'indoor'], ['/indoor-h.html', 'indoor'], ['/missing', null],
  ]);
  for (const [path, screen] of expected) assert.equal(getAppScreen(path), screen);
  const catalogue = fixture();
  const nav = catalogue.doc.body.children[0];
  assert.equal(nav.children.length, 5);
  assert.equal(nav.children.some((link) => link.href.includes('indoor')), false);
  assert.equal(nav.children.filter((link) => link.getAttribute('aria-current') === 'page').length, 1);
  assert.equal(nav.children[2].href, '/catalogo');
  assert.equal(nav.children[0].className, 'app-tab-scanner');
  for (const pathname of ['/artes/stories', '/artes/feed', '/artes/indoor-h']) {
    const editor = fixture({ pathname });
    assert.equal(editor.doc.body.children.length, 0);
    assert.equal(editor.doc.body.classList.contains('has-app-tabbar'), false);
  }
});

test('standalone detection supports both installed iOS and display-mode changes', () => {
  const ios = fixture({ iosStandalone: true });
  assert.equal(ios.doc.documentElement.classList.contains('is-standalone'), true);
  const browser = fixture();
  assert.equal(browser.doc.documentElement.classList.contains('is-standalone'), false);
  browser.standalone.matches = true;
  browser.standalone.emit('change');
  assert.equal(browser.doc.documentElement.classList.contains('is-standalone'), true);
});
