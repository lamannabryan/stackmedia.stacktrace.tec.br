import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = (await readFile(new URL('../public/js/session.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/, '')
  .replaceAll('export ', '');
const flush = () => new Promise(resolve => setImmediate(resolve));

async function client() {
  const events = new Map();
  const state = {
    requests: [], reloads: 0, redirects: [], warnings: [], errors: [], signals: [],
    reply: { user: { id: 1, role: 'cliente', name: 'Cliente' }, csrfToken: 'initial' },
  };
  state.respond = async () => ({ ok: true, json: async () => state.reply });
  const context = vm.createContext({
    mountHeader: () => null,
    Headers,
    AbortSignal: { timeout(ms) {
      const signal = AbortSignal.timeout(ms);
      state.signals.push({ ms, signal });
      return signal;
    } },
    console: { warn: (...args) => state.warnings.push(args) },
    location: { pathname: '/', search: '', reload: () => state.reloads++,
      replace: url => state.redirects.push(url), assign: url => state.redirects.push(url) },
    document: { documentElement: { dataset: {} }, querySelector: () => null,
      createElement: () => ({ setAttribute() {} }), body: { prepend: el => state.errors.push(el) } },
    window: { addEventListener: (name, handler) => events.set(name, handler) },
    fetch: async (url, options) => {
      state.requests.push({ url, options });
      return state.respond(url, options);
    },
  });
  vm.runInContext(source + '\nglobalThis.client = { sessionReady, apiFetch };', context);
  await context.client.sessionReady;
  return { ...context.client, state, show: persisted => events.get('pageshow')({ persisted }) };
}

test('repeated restored launches revalidate the session without reloading the document', async () => {
  const app = await client();
  app.show(false);
  await flush();
  assert.equal(app.state.requests.length, 1);
  for (let cycle = 1; cycle <= 4; cycle++) {
    app.state.reply = { ...app.state.reply, csrfToken: `resume-${cycle}` };
    app.show(true);
    await flush();
    assert.equal(app.state.reloads, 0);
    assert.equal(app.state.requests.length, cycle * 2);
    await app.apiFetch('/api/example', { method: 'POST' });
    assert.equal(app.state.requests.at(-1).options.headers.get('X-CSRF-Token'), `resume-${cycle}`);
  }
  assert.ok(app.state.signals.every(({ ms }) => ms === 15000));
  assert.ok(app.state.requests.filter(({ url }) => url === '/api/auth/me')
    .every(({ options }) => options.cache === 'no-store' && options.signal));
});

test('duplicate restore events share a request and mutations wait for the refreshed CSRF', async () => {
  const app = await client();
  let resolve;
  app.state.respond = () => new Promise(done => { resolve = done; });
  app.show(true);
  app.show(true);
  await flush();
  const mutation = app.apiFetch('/api/example', { method: 'POST' });
  await flush();
  assert.equal(app.state.requests.length, 2);
  app.state.respond = async () => ({ ok: true });
  resolve({ ok: true, json: async () => ({ ...app.state.reply, csrfToken: 'refreshed' }) });
  await mutation;
  assert.equal(app.state.requests.at(-1).options.headers.get('X-CSRF-Token'), 'refreshed');
});

test('expired sessions redirect to login; a changed identity reloads the protected screen', async () => {
  const expired = await client();
  expired.state.respond = async () => ({ ok: false, status: 401 });
  expired.show(true);
  await flush();
  assert.deepEqual(expired.state.redirects, ['/login?next=%2F']);
  assert.equal(expired.state.reloads, 0);
  for (const user of [{ id: 2, role: 'cliente' }, { id: 1, role: 'administrador' }]) {
    const changed = await client();
    changed.state.reply = { ...changed.state.reply, user };
    changed.show(true);
    await flush();
    assert.equal(changed.state.reloads, 1);
  }
});

test('failed revalidation does not force navigation and the next restore can retry', async () => {
  const app = await client();
  app.state.respond = async () => { throw new Error('Network unavailable'); };
  app.show(true);
  await flush();
  assert.equal(app.state.reloads, 0);
  assert.equal(app.state.warnings.length, 1);
  app.state.respond = async () => ({ ok: true, json: async () => app.state.reply });
  app.show(true);
  await flush();
  assert.equal(app.state.requests.length, 3);
  assert.equal(app.state.reloads, 0);
});
