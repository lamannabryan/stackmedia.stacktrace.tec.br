import { createUserService, initializeUserSchema } from '../../src/modules/users/user-service.mjs';

// Only use with isolated test databases. Real sessions exercise the production gate.
export async function testSession(database, origin, { authorization } = {}) {
  initializeUserSchema(database);
  const email = 'fixture-admin@example.test';
  const password = 'fixture-password-2026';
  if (!database.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
    await createUserService({ database }).create({ name: 'Fixture Admin', email, password, role: 'administrador' });
  }
  const response = await globalThis.fetch(origin + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(`Fixture login: ${response.status}`);
  const { csrfToken } = await response.json();
  const cookie = response.headers.get('set-cookie').split(';')[0];
  return { cookie, csrfToken, fetch: (url, options = {}) => {
    const headers = new Headers(options.headers);
    headers.set('Cookie', cookie); headers.set('X-CSRF-Token', csrfToken);
    if (authorization) headers.set('Authorization', authorization);
    return globalThis.fetch(url, { ...options, headers });
  } };
}
