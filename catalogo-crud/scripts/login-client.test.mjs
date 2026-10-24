import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const authSource = (await readFile(new URL('../public/js/auth-client.js', import.meta.url), 'utf8')).replaceAll('export ', '');
const loginSource = (await readFile(new URL('../public/js/login.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/, '');
const validSession = { user: { id: 1, role: 'cliente', active: true }, csrfToken: 'a'.repeat(64) };

function client({ respond = async () => Response.json(validSession), next = '' } = {}) {
  const events = new Map();
  const state = { requests: [], redirects: [], loading: 0, timeouts: [], respond };
  const status = { textContent: '' };
  const submit = { disabled: false, textContent: 'Entrar' };
  const form = {
    elements: { email: { value: 'client@example.test' }, password: { value: 'secret-password' } },
    querySelector: () => submit,
    setAttribute(name, value) { this[name] = value; },
    addEventListener: (event, callback) => events.set(event, callback),
  };
  const context = vm.createContext({
    URL, URLSearchParams,
    AbortSignal: { timeout(ms) { state.timeouts.push(ms); return AbortSignal.timeout(ms); } },
    fetch: async (url, options) => { state.requests.push({ url, options }); return state.respond(url, options); },
    location: { origin: 'https://app.example.test', search: next ? `?next=${encodeURIComponent(next)}` : '',
      replace: url => state.redirects.push(url) },
    document: { querySelector: selector => ({ '#login-form': form, '#login-status': status,
      '#show-password': { addEventListener() {} } })[selector] },
    appLoading: { navigate: () => state.loading++ },
  });
  Object.defineProperty(context, 'localStorage', { get() { assert.fail('Login must not access localStorage'); } });
  Object.defineProperty(context, 'sessionStorage', { get() { assert.fail('Login must not access sessionStorage'); } });
  vm.runInContext(authSource + '\n' + loginSource, context);
  return { state, form, submit, status, send: () => events.get('submit')({ preventDefault() {} }) };
}

test('login sends credentials only to its origin and navigates only after a valid session response', async () => {
  const f = client({ next: '/catalogo?fabricante=Marca' });
  await f.send();
  assert.deepEqual(f.state.redirects, ['/catalogo?fabricante=Marca']);
  assert.equal(f.state.loading, 1);
  const { url, options } = f.state.requests[0];
  assert.equal(url, '/api/auth/login');
  assert.equal(options.method, 'POST');
  assert.equal(options.mode, 'same-origin');
  assert.equal(options.credentials, 'same-origin');
  assert.equal(options.cache, 'no-store');
  assert.equal(options.redirect, 'error');
  assert.equal(options.headers.Accept, 'application/json');
  assert.equal(options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(options.body), { email: 'client@example.test', password: 'secret-password' });
  assert.deepEqual(f.state.timeouts, [15000]);
  assert.ok(options.signal);
  assert.equal(f.form.elements.password.value, '');
  assert.equal(f.form['aria-busy'], 'false');
});

test('commercial rejections show specific messages and never navigate, even if the server includes session-like fields', async () => {
  for (const [code, message] of [['ACCESS_EXPIRED', /acesso expirou/], ['ACCOUNT_INACTIVE', /conta está desativada/],
    ['ARTWORK_LIMIT_REACHED', /limite de artes foi atingido/]]) {
    const f = client({ respond: async () => Response.json({ ...validSession, code, error: '<img src=x onerror=alert(1)>' }, { status: 403 }) });
    await f.send();
    assert.match(f.status.textContent, message);
    assert.doesNotMatch(f.status.textContent, /<img/);
    assert.deepEqual(f.state.redirects, []);
    assert.equal(f.state.loading, 0);
    assert.equal(f.submit.disabled, false);
    assert.equal(f.form.elements.password.value, '');
  }
});

test('incorrect credentials, rate limits and unknown denials do not expose restriction codes or server internals', async () => {
  for (const [httpStatus, message] of [[401, /E-mail ou senha inválidos/], [429, /Aguarde 15 minutos/],
    [403, /Não foi possível autorizar/], [503, /temporariamente indisponível/]]) {
    const f = client({ respond: async () => Response.json({ code: httpStatus === 403 ? 'UNKNOWN' : 'ACCESS_EXPIRED', error: 'private server detail' }, { status: httpStatus }) });
    await f.send();
    assert.match(f.status.textContent, message);
    assert.doesNotMatch(f.status.textContent, /private server detail|acesso expirou/);
    assert.deepEqual(f.state.redirects, []);
  }
});

test('HTML, invalid JSON, malformed success and redirects cannot grant entry', async () => {
  const responses = [
    () => new Response('<html>proxy error</html>', { headers: { 'Content-Type': 'text/html' } }),
    () => new Response('{invalid', { headers: { 'Content-Type': 'application/json' } }),
    () => Response.json(null), () => Response.json({}),
    () => Response.json({ ...validSession, csrfToken: '' }),
    () => Response.json({ ...validSession, user: { id: 1, role: 'cliente', active: false } }),
    () => Response.json({ ...validSession, user: { id: 1, role: 'unknown', active: true } }),
    () => Response.json(validSession, { status: 201 }),
    () => ({ redirected: true, ok: true, status: 200 }),
  ];
  for (const respond of responses) {
    const f = client({ respond });
    await f.send();
    assert.match(f.status.textContent, /Não foi possível confirmar/);
    assert.deepEqual(f.state.redirects, []);
    assert.equal(f.submit.disabled, false);
  }
});

test('connection failures and timeout leave the user at login with a safe retry message', async () => {
  for (const name of ['TypeError', 'TimeoutError', 'AbortError']) {
    const f = client({ respond: async () => { const error = new Error('internal URL with sensitive information'); error.name = name; throw error; } });
    await f.send();
    assert.match(f.status.textContent, name === 'TypeError' ? /Verifique sua conexão/ : /demorou para responder/);
    assert.doesNotMatch(f.status.textContent, /sensitive/);
    assert.equal(f.submit.disabled, false);
    assert.deepEqual(f.state.redirects, []);
  }
});

test('duplicate submissions share a single attempt and a renewed account is checked again on retry', async () => {
  let resolve;
  const f = client({ respond: () => new Promise(done => { resolve = done; }) });
  const pending = f.send();
  assert.equal(f.form['aria-busy'], 'true');
  assert.equal(f.submit.disabled, true);
  await f.send();
  assert.equal(f.state.requests.length, 1);
  assert.deepEqual(f.state.redirects, []);
  resolve(Response.json({ code: 'ARTWORK_LIMIT_REACHED' }, { status: 403 }));
  await pending;
  f.form.elements.password.value = 'secret-password';
  f.state.respond = async () => Response.json(validSession);
  await f.send();
  assert.equal(f.state.requests.length, 2);
  assert.deepEqual(f.state.redirects, ['/']);
  assert.equal(f.status.textContent, '');
});

test('successful login rejects external, malformed and login-loop destinations', async () => {
  for (const next of ['https://evil.example', '//evil.example', 'https://app.example.test//evil.example',
    'https://user:pass@app.example.test/catalogo', 'javascript:alert(1)', 'http://[', '/%zz',
    '/login', '/login.html?next=/catalogo', '/LOGIN/', '/%6cogin']) {
    const f = client({ next });
    await f.send();
    assert.deepEqual(f.state.redirects, ['/'], next);
  }
});

test('the form posts instead of exposing credentials in the URL if its module cannot load', async () => {
  const html = await readFile(new URL('../public/login.html', import.meta.url), 'utf8');
  assert.match(html, /<form\b[^>]*id="login-form"[^>]*method="post"[^>]*action="\/api\/auth\/login"/);
  assert.match(html, /aria-describedby="login-status"/);
});
