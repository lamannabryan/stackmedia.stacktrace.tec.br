// One header for authenticated application screens. Move existing tour buttons
// so their listeners and page-specific guided steps are preserved.
export function mountHeader() {
  let host = document.querySelector('.site-header-inner');
  const editor = document.querySelector('.stories-topbar');
  if (!host && !editor) return null;
  const tour = document.querySelector('[data-tour-start]');
  if (!host) {
    const header = document.createElement('header');
    header.className = 'site-header';
    host = document.createElement('div'); host.className = 'site-header-inner';
    header.append(host); editor.before(header);
    editor.classList.add('editor-action-bar');
    editor.querySelector('.stories-back-link')?.remove();
  }
  host.closest('header').classList.add('shared-app-header');
  const brand = document.createElement('a');
  brand.className = 'site-brand'; brand.href = '/';
  brand.setAttribute('aria-label', '_stackmedia — Central de criação');
  brand.innerHTML = '<img class="site-brand-logo" src="/branding/stackmedia-wordmark.svg" width="184" height="26" alt="_stackmedia">';
  const nav = document.createElement('nav'); nav.className = 'site-nav';
  nav.setAttribute('aria-label', 'Navegação principal');
  const path = location.pathname.replace(/\.html$/, '').replace('/index', '') || '/';
  for (const [href, label, alias] of [['/', 'Central', '/'], ['/catalogo', 'Catálogo', '/catalogo'], ['/artes/stories', 'Stories', '/stories'], ['/artes/feed', 'Feed', '/feed'], ['/artes/encarte', 'Encarte', '/encarte'], ['/artes/indoor-h', 'TV Indoor', '/indoor-h']]) {
    const link = document.createElement('a'); link.href = href; link.textContent = label;
    if (path === href || path === alias) link.setAttribute('aria-current', 'page');
    nav.append(link);
  }
  const actions = document.createElement('div'); actions.className = 'shared-header-actions';
  const launcher = tour || document.createElement('a');
  if (!tour) { launcher.href = '/?tour=1'; launcher.setAttribute('aria-label', 'Abrir tour guiado da plataforma'); }
  launcher.className = 'tour-launcher header-tour-launcher'; launcher.title = 'Tour guiado';
  launcher.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z" stroke-linejoin="round"/></svg>';
  actions.append(launcher); host.replaceChildren(brand, nav, actions);
  if (editor) {
    const controls = editor.querySelector('.stories-header-actions');
    if (controls) actions.prepend(controls);
    editor.style.display = 'none';
    host.closest('header').classList.add('editor-unified-header');
  }
  return actions;
}
