import { mountHeader } from './header.js';
const headerActions = mountHeader();
let session;
async function readSession() {
  const response = await fetch('/api/auth/me', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    if (response.status === 401) location.replace(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
    throw new Error('Não foi possível verificar sua sessão. Atualize a página.');
  }
  return response.json();
}
export const sessionReady = readSession().then((current) => {
  session = current;
  document.documentElement.dataset.userRole = session.user.role;
  return session;
});

export async function apiFetch(url, options = {}) {
  await sessionReady;
  if (restoringSession) await restoringSession;
  const current = session;
  const headers = new Headers(options.headers);
  if (!['GET', 'HEAD'].includes((options.method || 'GET').toUpperCase())) headers.set('X-CSRF-Token', current.csrfToken);
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) location.assign('/login');
  return response;
}

function showAccount({ user }) {
  const host = headerActions || document.querySelector('.site-header-inner, .stories-header-actions');
  if (!host) return;
  const menu = document.createElement('details');
  menu.className = 'account-menu';
  const summary = document.createElement('summary');
  summary.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9.5 3-.5 2a7 7 0 0 0-1.7 1L5.3 5.5l-2 3.5 1.5 1.5a7 7 0 0 0 0 2L3.3 14l2 3.5 2-.5a7 7 0 0 0 1.7 1l.5 2h4l.5-2a7 7 0 0 0 1.7-1l2 .5 2-3.5-1.5-1.5a7 7 0 0 0 0-2L20.2 9l-2-3.5-2 .5a7 7 0 0 0-1.7-1L14 3z"/><circle cx="11.75" cy="11.5" r="3"/></svg>';
  summary.setAttribute('aria-label', `Configurações da conta de ${user.name}`);
  summary.title = 'Configurações';
  const panel = document.createElement('div');
  panel.className = 'account-panel';
  const name = document.createElement('strong');
  name.textContent = user.name;
  const role = document.createElement('small');
  role.textContent = user.role === 'administrador' ? 'Administrador' : 'Cliente';
  panel.append(name, role);
  const themeSlot = document.createElement('div');
  themeSlot.className = 'account-theme-slot';
  panel.append(themeSlot);
  if (user.role === 'administrador') {
    for (const [href, text] of [['/revistas', 'Gerenciar revistas'], ['/backgrounds', 'Gerenciar backgrounds'], ['/usuarios', 'Gerenciar usuários'], ['/parceiros', 'Gerenciar parceiros']]) {
      const link = document.createElement('a'); link.href = href; link.textContent = text; panel.append(link);
    }
  }
  const logout = document.createElement('button');
  logout.type = 'button'; logout.textContent = 'Sair da conta';
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  logout.addEventListener('click', async () => {
    if (document.body.classList.contains('stories-page') && !confirm('Sair da conta? A arte em edição será descartada.')) return;
    logout.disabled = true;
    try {
      const response = await apiFetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error('Não foi possível sair. Tente novamente.');
      location.assign('/login');
    } catch (error) { status.textContent = error.message; logout.disabled = false; }
  });
  panel.append(logout, status); menu.append(summary, panel); host.append(menu);
  window.dispatchEvent(new Event('account-menu-ready'));
  document.addEventListener('click', (event) => { if (!menu.contains(event.target)) menu.open = false; });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menu.open) { menu.open = false; summary.focus(); }
  });
}
sessionReady.then(showAccount).catch((error) => {
  const message = document.createElement('p'); message.className = 'session-error';
  message.setAttribute('role', 'alert'); message.textContent = error.message; document.body.prepend(message);
});
// Retomar uma página preservada não exige uma nova navegação do PWA.
// Revalide a autenticação e o CSRF; recarregue somente se a identidade mudou.
let restoringSession;
window.addEventListener('pageshow', (event) => {
  if (!event.persisted || restoringSession) return;
  restoringSession = sessionReady.then(readSession).then((current) => {
    if (current.user.id !== session.user.id || current.user.role !== session.user.role) {
      location.reload();
      return;
    }
    session = current;
  }).catch((error) => {
    console.warn('Não foi possível revalidar a sessão na retomada.', error);
  }).finally(() => { restoringSession = null; });
});
