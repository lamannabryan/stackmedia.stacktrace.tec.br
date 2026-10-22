const form = document.querySelector('#login-form');
const status = document.querySelector('#login-status');
const submit = form.querySelector('[type="submit"]');
document.querySelector('#show-password').addEventListener('change', (event) => {
  form.elements.password.type = event.target.checked ? 'text' : 'password';
});
function destination() {
  const next = new URLSearchParams(location.search).get('next') || '/';
  const url = new URL(next, location.origin);
  return url.origin === location.origin && !['/login', '/login.html'].includes(url.pathname) ? url.pathname + url.search : '/';
}
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  submit.disabled = true; submit.textContent = 'Entrando…'; status.textContent = '';
  try {
    const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.elements.email.value, password: form.elements.password.value }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Não foi possível entrar.');
    form.elements.password.value = '';
    location.replace(destination());
  } catch (error) { status.textContent = error.message || 'Verifique sua conexão e tente novamente.'; }
  finally { submit.disabled = false; submit.textContent = 'Entrar'; }
});
