import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { normalizeEan, isValidEan } from '../public/js/features/barcode/code.js';
import { cameraErrorMessage } from '../public/js/features/barcode/camera.js';

const [markup, script] = await Promise.all([
  readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/home.js', import.meta.url), 'utf8'),
]);

class Element {
  constructor(document) {
    this.ownerDocument = document;
    this.listeners = new Map();
    this.value = '';
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.open = false;
    const classes = new Set();
    this.classList = {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
      contains: (name) => classes.has(name),
    };
  }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
  }
  dispatch(type, details = {}) {
    const event = { target: this, defaultPrevented: false, ...details,
      preventDefault() { this.defaultPrevented = true; } };
    for (const callback of this.listeners.get(type) || []) callback(event);
    return event;
  }
  click() { if (!this.disabled) this.dispatch('click'); }
  focus() { this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null; }
  setAttribute(name, value) { this[name] = value; }
  showModal() { assert.equal(this.hidden, false); this.open = true; }
  close() { this.open = false; }
}

const flush = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};
const validEan = '7894900011517';
const otherEan = '7891000053508';
const response = (body = { id: 42 }, status = 200) => ({ ok: status < 400, json: async () => body });
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function openHome({ touch = true, mobile = false, lookup = async () => response() } = {}) {
  const document = { hidden: false };
  document.body = new Element(document);
  const events = new Element(document);
  document.addEventListener = events.addEventListener.bind(events);
  document.dispatch = events.dispatch.bind(events);
  const elements = new Map([...markup.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)].map(([tag, id]) => {
    const node = new Element(document);
    node.hidden = /\bhidden(?:\s|[=>])/.test(tag);
    node.disabled = /\bdisabled(?:\s|[=>])/.test(tag);
    return [id, node];
  }));
  document.querySelector = (selector) => elements.get(selector.slice(1)) ?? null;
  const requests = [];
  const destinations = [];
  const timers = new Map();
  const frames = [];
  let timerId = 0;
  let cameraCallbacks;
  const camera = { state: 'idle', starts: 0, stops: 0,
    start() { this.starts++; this.state = 'starting'; cameraCallbacks.onState(this.state); },
    stop() { this.stops++; this.state = 'idle'; cameraCallbacks.onState(this.state); },
    detect(code) { this.stop(); cameraCallbacks.onCode(code); },
    fail(message) { this.stop(); cameraCallbacks.onError(message); },
  };
  const windowEvents = new Element(document);
  const mobileMedia = new Element(document);
  mobileMedia.matches = mobile;
  const sandbox = vm.createContext({
    document, AbortController,
    normalizeEan, isValidEan,
    createCameraScanner: (callbacks) => { cameraCallbacks = callbacks; return camera; },
    window: { matchMedia: (query) => query.includes('max-width') ? mobileMedia : ({ matches: touch }), location: { assign: (url) => destinations.push(url) }, addEventListener: windowEvents.addEventListener.bind(windowEvents) },
    requestAnimationFrame: (callback) => frames.push(callback),
    setTimeout: (callback, duration) => { timers.set(++timerId, { callback, duration }); return timerId; },
    clearTimeout: (id) => timers.delete(id),
    fetch: (url, options) => { requests.push({ url, ...options }); return lookup(url, options); },
  });
  vm.runInContext(script.replace(/^import .+;\r?\n/gm, ''), sandbox, { filename: 'home.js' });
  const get = (id) => elements.get(`ean-${id}`);
  const show = () => { get('overlay-open').click(); frames.splice(0).forEach((callback) => callback()); };
  const input = (value) => { get('input').value = value; get('input').dispatch('input'); };
  const submit = () => get('launcher').dispatch('submit');
  const runTimers = () => {
    const pending = [...timers.values()];
    timers.clear();
    pending.forEach(({ callback }) => callback());
  };
  return { get, show, input, submit, runTimers, document, requests, destinations, timers, camera, windowEvents,
    mobileMedia, manualEntryAllowed: () => cameraCallbacks.allowManualEntry() };
}

test('mobile scan opens the camera directly without a keyboard or manual entry', async () => {
  const f = openHome({ mobile: true });
  f.show();
  assert.equal(f.get('scanner-overlay').open, true);
  assert.equal(f.document.body.classList.contains('scanner-open'), true);
  assert.equal(f.document.activeElement, f.get('overlay-close'));
  assert.equal(f.camera.starts, 1);
  assert.equal(f.get('scanner-title').textContent, 'Ler com câmera');
  assert.equal(f.get('manual-fields').hidden, true);
  assert.equal(f.get('input').disabled, true);
  assert.equal(f.get('submit').disabled, true);
  assert.equal(f.get('camera-stop').hidden, true);
  assert.equal(f.manualEntryAllowed(), false);
  f.input(validEan);
  f.runTimers();
  await flush();
  assert.equal(f.requests.length, 0, 'External reader and manual input events are ignored on mobile');
  const event = f.submit();
  assert.equal(event.defaultPrevented, true);
  assert.equal(f.get('submit').disabled, true);
  assert.equal(f.requests.length, 0, 'Form submit cannot bypass camera mode');
  f.camera.detect(validEan);
  await flush();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, `/api/products/by-ean/${validEan}`);
  assert.deepEqual(f.destinations, ['/artes/stories?productId=42']);
});

test('mobile camera errors and background pauses only restart after an explicit retry', () => {
  const f = openHome({ mobile: true });
  f.show();
  f.camera.fail(cameraErrorMessage({ name: 'NotAllowedError' }, { allowManualEntry: f.manualEntryAllowed() }));
  assert.equal(f.get('manual-fields').hidden, true);
  assert.equal(f.get('camera-start').hidden, false);
  assert.equal(f.get('camera-label').textContent, 'Tentar câmera novamente');
  assert.doesNotMatch(f.get('status').textContent, /digite/i);
  assert.equal(f.document.activeElement, f.get('overlay-close'));
  assert.equal(f.camera.starts, 1);
  f.get('format').dispatch('change');
  assert.notEqual(f.document.activeElement, f.get('input'));
  f.get('camera-start').click();
  assert.equal(f.camera.starts, 2);
  f.document.hidden = true;
  f.document.dispatch('visibilitychange');
  assert.equal(f.camera.state, 'idle');
  assert.equal(f.get('manual-fields').hidden, true);
  assert.match(f.get('status').textContent, /Tentar câmera novamente/);
  f.document.hidden = false;
  f.document.dispatch('visibilitychange');
  assert.equal(f.camera.starts, 2);
  f.get('camera-start').click();
  assert.equal(f.camera.starts, 3);
  f.get('overlay-close').click();
  assert.equal(f.camera.state, 'idle');
});

test('mobile lookup failure keeps the keyboard closed and can retry the same code by camera', async () => {
  let calls = 0;
  const f = openHome({ mobile: true, lookup: async () => ++calls === 1 ? response({ error: 'Produto indisponível' }, 404) : response() });
  f.show();
  f.get('format').value = 'feed';
  f.camera.detect(validEan);
  await flush();
  assert.match(f.get('status').textContent, /Produto indisponível/);
  assert.equal(f.get('manual-fields').hidden, true);
  assert.equal(f.get('input').disabled, true);
  assert.equal(f.get('submit').disabled, true);
  assert.equal(f.camera.starts, 1, 'An error must not automatically restart the camera');
  assert.notEqual(f.document.activeElement, f.get('input'));
  f.get('camera-start').click();
  f.camera.detect(validEan);
  await flush();
  assert.deepEqual(f.destinations, ['/artes/feed?productId=42']);
});

test('changing to mobile removes manual controls without automatically requesting the camera', () => {
  const f = openHome({ touch: false });
  f.show();
  f.mobileMedia.matches = true;
  f.mobileMedia.dispatch('change');
  assert.equal(f.camera.starts, 0);
  assert.equal(f.get('input').disabled, true);
  assert.equal(f.get('manual-fields').hidden, true);
  assert.equal(f.document.activeElement, f.get('overlay-close'));
  f.get('camera-start').click();
  assert.equal(f.camera.starts, 1);
  f.mobileMedia.matches = false;
  f.mobileMedia.dispatch('change');
  assert.equal(f.camera.state, 'idle');
  assert.equal(f.get('input').disabled, false);
  assert.equal(f.get('manual-fields').hidden, false);
  assert.equal(f.manualEntryAllowed(), true);
});

test('camera-only errors never suggest typing and desktop errors preserve their fallback', () => {
  for (const name of ['NotAllowedError', 'NotFoundError', 'NotReadableError', 'UnknownError']) {
    assert.doesNotMatch(cameraErrorMessage({ name }, { allowManualEntry: false }), /digite|leitor conectado/i);
  }
  assert.match(cameraErrorMessage({ name: 'NotAllowedError' }), /digite/);
});

test('manual submit normalizes a valid code and opens the selected Feed format', async () => {
  const f = openHome({ lookup: async () => response({ id: 'product/17' }) });
  f.show();
  f.get('format').value = 'feed';
  f.input('789 4900-011517');
  f.submit();
  await flush();
  assert.equal(f.get('input').value, validEan);
  assert.deepEqual(f.destinations, ['/artes/feed?productId=product%2F17']);
});

test('invalid or incomplete codes show validation without requesting a product', async () => {
  const f = openHome();
  f.show();
  for (const value of ['', '123', '7894900011518']) {
    f.input(value);
    f.submit();
    assert.equal(f.get('status').classList.contains('is-error'), true);
    assert.match(f.get('status').textContent, /Código não reconhecido/);
  }
  await flush();
  assert.equal(f.requests.length, 0);
  assert.equal(f.destinations.length, 0);
  assert.equal(f.get('submit').disabled, false);
});

test('desktop readers retain debounced automatic lookup and closing cancels a pending scan', async () => {
  const f = openHome({ touch: false });
  f.show();
  assert.equal(f.document.activeElement, f.get('input'));
  f.input(validEan);
  assert.equal(f.requests.length, 0);
  assert.equal([...f.timers.values()][0].duration, 120);
  f.get('overlay-close').click();
  f.runTimers();
  await flush();
  assert.equal(f.requests.length, 0);
  f.show();
  f.input(validEan);
  f.runTimers();
  await flush();
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.destinations, ['/artes/stories?productId=42']);
});

test('closing cancels lookup and a late response cannot navigate or overwrite a newly opened scanner', async () => {
  const pending = deferred();
  const f = openHome({ lookup: () => pending.promise });
  f.show();
  f.input(validEan);
  f.submit();
  assert.equal(f.requests[0].signal.aborted, false);
  f.get('overlay-close').click();
  assert.equal(f.requests[0].signal.aborted, true);
  assert.equal(f.get('scanner-overlay').open, false);
  assert.equal(f.get('scanner-overlay').hidden, true);
  assert.equal(f.document.body.classList.contains('scanner-open'), false);
  assert.equal(f.document.activeElement, f.get('overlay-open'));
  f.show();
  pending.resolve(response());
  await flush();
  assert.deepEqual(f.destinations, []);
  assert.equal(f.get('input').value, '');
  assert.equal(f.get('submit').disabled, false);
  assert.equal(f.get('status').classList.contains('is-error'), false);
});

test('editing during lookup aborts the previous request and allows only the latest code to navigate', async () => {
  const first = deferred();
  const second = deferred();
  let calls = 0;
  const f = openHome({ lookup: () => (++calls === 1 ? first : second).promise });
  f.show();
  f.input(validEan);
  f.submit();
  f.input(otherEan);
  assert.equal(f.requests[0].signal.aborted, true);
  assert.equal(f.get('submit').disabled, false);
  f.submit();
  assert.equal(f.requests.length, 2);
  first.resolve(response({ error: 'Resposta antiga' }, 404));
  await flush();
  assert.equal(f.get('submit').disabled, true, 'An obsolete request cannot enable submit during the new lookup');
  assert.equal(f.get('status').classList.contains('is-error'), false);
  second.resolve(response({ id: 99 }));
  await flush();
  assert.deepEqual(f.destinations, ['/artes/stories?productId=99']);
});

test('Escape and backdrop both close the scanner while clicks inside it keep the dialog open', () => {
  const f = openHome();
  f.show();
  f.get('scanner-overlay').dispatch('click', { target: f.get('input') });
  assert.equal(f.get('scanner-overlay').open, true);
  const escape = f.get('scanner-overlay').dispatch('cancel');
  assert.equal(escape.defaultPrevented, true);
  assert.equal(f.get('scanner-overlay').open, false);
  f.show();
  f.get('scanner-overlay').click();
  assert.equal(f.get('scanner-overlay').open, false);
  assert.equal(f.document.activeElement, f.get('overlay-open'));
});

test('lookup errors preserve the code, restore submit and allow retrying the same product', async () => {
  let count = 0;
  const f = openHome({ lookup: async () => ++count === 1 ? response({ error: 'Produto indisponível' }, 404) : response() });
  f.show();
  f.input(validEan);
  f.submit();
  f.submit();
  assert.equal(f.requests.length, 1, 'Duplicate submit cannot launch concurrent lookups');
  await flush();
  assert.match(f.get('status').textContent, /Produto indisponível/);
  assert.equal(f.get('input').value, validEan);
  assert.equal(f.get('submit').disabled, false);
  assert.equal(f.document.activeElement, f.get('input'));
  f.submit();
  await flush();
  assert.equal(f.requests.length, 2);
  assert.deepEqual(f.destinations, ['/artes/stories?productId=42']);
});

test('camera starts only on request and a detected code opens the chosen artwork once', async () => {
  for (const format of ['stories', 'feed']) {
    const f = openHome();
    f.show();
    assert.equal(f.camera.starts, 0);
    f.get('format').value = format;
    f.get('camera-start').click();
    assert.equal(f.camera.starts, 1);
    assert.equal(f.get('camera-panel').hidden, false);
    assert.equal(f.get('manual-fields').hidden, true);
    assert.equal(f.document.activeElement, f.get('camera-stop'));
    f.camera.detect(validEan);
    f.camera.detect(validEan);
    await flush();
    assert.equal(f.get('input').value, validEan);
    assert.equal(f.requests.length, 1);
    assert.deepEqual(f.destinations, [`/artes/${format}?productId=42`]);
    assert.equal(f.camera.state, 'idle');
  }
});

test('manual mode, close, page exit and app background all stop the camera', () => {
  const f = openHome();
  f.show();
  f.get('camera-start').click();
  f.get('camera-stop').click();
  assert.equal(f.camera.state, 'idle');
  assert.equal(f.get('manual-fields').hidden, false);
  assert.equal(f.document.activeElement, f.get('input'));
  f.get('camera-start').click();
  f.document.hidden = true;
  f.document.dispatch('visibilitychange');
  assert.equal(f.camera.state, 'idle');
  f.document.hidden = false;
  f.document.dispatch('visibilitychange');
  assert.equal(f.camera.starts, 2, 'Returning to the app must not reopen the camera');
  f.get('camera-start').click();
  f.windowEvents.dispatch('pagehide');
  assert.equal(f.camera.state, 'idle');
  f.get('camera-start').click();
  f.get('overlay-close').click();
  assert.equal(f.camera.state, 'idle');
  f.camera.detect(validEan);
  assert.equal(f.requests.length, 0);
});

test('a camera failure restores manual entry and announces the error', async () => {
  const f = openHome();
  f.show();
  f.get('camera-start').click();
  f.camera.fail('A câmera não foi autorizada.');
  assert.equal(f.get('camera-panel').hidden, true);
  assert.equal(f.get('manual-fields').hidden, false);
  assert.equal(f.get('camera-start').hidden, false);
  assert.equal(f.get('status').classList.contains('is-error'), true);
  assert.match(f.get('status').textContent, /não foi autorizada/);
  f.input(validEan);
  f.submit();
  await flush();
  assert.deepEqual(f.destinations, ['/artes/stories?productId=42']);
});
