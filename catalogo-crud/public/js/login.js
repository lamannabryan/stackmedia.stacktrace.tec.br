import { requestLogin } from './auth-client.js';

const form = document.querySelector('#login-form');
const status = document.querySelector('#login-status');
const submit = form.querySelector('[type="submit"]');
let submitting = false;
document.querySelector('#show-password').addEventListener('change', (event) => {
  form.elements.password.type = event.target.checked ? 'text' : 'password';
});
function destination() {
  try {
    const next = new URLSearchParams(location.search).get('next') || '/';
    const url = new URL(next, location.origin);
    const pathname = decodeURIComponent(url.pathname).toLowerCase().replace(/\/+$/, '') || '/';
    if (url.origin !== location.origin || url.username || url.password || url.pathname.startsWith('//')
      || ['/login', '/login.html'].includes(pathname)) return '/';
    return url.pathname + url.search;
  } catch { return '/'; }
}
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (submitting) return;
  submitting = true;
  form.setAttribute('aria-busy', 'true');
  submit.disabled = true; submit.textContent = 'Entrando…'; status.textContent = '';
  try {
    await requestLogin({ email: form.elements.email.value, password: form.elements.password.value });
    globalThis.appLoading?.navigate();
    location.replace(destination());
  } catch (error) { status.textContent = error.message || 'Verifique sua conexão e tente novamente.'; }
  finally {
    form.elements.password.value = '';
    submitting = false;
    form.setAttribute('aria-busy', 'false');
    submit.disabled = false; submit.textContent = 'Entrar';
  }
});
