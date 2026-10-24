const destinations = [
  { screen: 'scanner', href: '/?openScanner=1', label: 'Ler código', icon: '<path d="M4 7V4h3m10 0h3v3M20 17v3h-3M7 20H4v-3M8 8v8m3-8v8m3-8v8m3-8v8"/>' },
  { screen: 'home', href: '/', label: 'Início', icon: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>' },
  { screen: 'catalogue', href: '/catalogo', label: 'Catálogo', icon: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>' },
  { screen: 'stories', href: '/artes/stories', label: 'Stories', icon: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 5h4m-5 7h6m-3-3v6m-1 4h2"/>' },
  { screen: 'feed', href: '/artes/feed', label: 'Feed', icon: '<rect x="3" y="2" width="18" height="20" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>' },
];

export function getAppScreen(pathname) {
  const path = pathname.replace(/\/+$/, '') || '/';
  return ({
    '/': 'home', '/index.html': 'home',
    '/catalogo': 'catalogue', '/catalogo.html': 'catalogue',
    '/parceiros': 'partners', '/parceiros.html': 'partners',
    '/revistas': 'magazines', '/revistas.html': 'magazines',
    '/backgrounds': 'backgrounds', '/backgrounds.html': 'backgrounds',
    '/usuarios': 'users', '/usuarios.html': 'users',
    '/superadmin': 'users', '/superadmin.html': 'users',
    '/artes/stories': 'stories', '/stories.html': 'stories',
    '/artes/feed': 'feed', '/feed.html': 'feed',
    '/artes/encarte': 'encarte', '/encarte.html': 'encarte',
    '/artes/indoor-h': 'indoor', '/indoor-h.html': 'indoor',
  })[path] || null;
}

export function hasSoftwareKeyboard({ editable, layoutHeight, visibleHeight, scale = 1 }) {
  // Safari can pan the visual viewport while the keyboard remains open. Panning
  // changes offsetTop, but does not reduce how much height the keyboard occupies.
  return Boolean(editable && Math.abs(scale - 1) < 0.05
    && layoutHeight - visibleHeight > Math.max(120, layoutHeight * 0.18));
}

export function initAppShell(win = window, doc = document) {
  const root = doc.documentElement;
  const screen = doc.body.classList.contains('offline-page') ? 'offline' : getAppScreen(win.location.pathname);
  const standalone = win.matchMedia('(display-mode: standalone)');
  const mobile = win.matchMedia('(max-width: 900px)');
  const updateDisplayMode = () => root.classList.toggle('is-standalone', standalone.matches || win.navigator.standalone === true);
  updateDisplayMode();
  standalone.addEventListener('change', updateDisplayMode);
  root.dataset.appScreen = screen || '';

  // Browsing screens share destinations. Editors keep their own step navigation.
  if (screen === 'home' || screen === 'catalogue' || screen === 'partners' || screen === 'users' || screen === 'backgrounds' || screen === 'magazines') {
    const nav = doc.createElement('nav');
    nav.className = 'app-tabbar';
    nav.setAttribute('aria-label', 'Navegação do aplicativo');
    for (const destination of destinations) {
      const link = doc.createElement('a');
      link.href = destination.href;
      link.className = destination.screen === 'scanner' ? 'app-tab-scanner' : '';
      link.setAttribute('aria-label', destination.label);
      link.innerHTML = `<span class="app-tab-icon"><svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${destination.icon}</svg></span><span>${destination.label}</span>`;
      if (screen === destination.screen) link.setAttribute('aria-current', 'page');
      nav.append(link);
    }
    doc.body.append(nav);
    doc.body.classList.add('has-app-tabbar');
    const name = doc.createElement('span');
    name.className = 'app-screen-name';
    name.textContent = screen === 'home' ? '_stackmedia' : screen === 'magazines' ? 'Revistas' : screen === 'backgrounds' ? 'Backgrounds' : screen === 'partners' ? 'Parceiros' : screen === 'users' ? 'Usuários' : 'Catálogo';
    doc.querySelector('.site-header-inner')?.append(name);
  }

  let baselineHeight = 0;
  let baselineWidth = 0;
  const updateViewport = () => {
    const viewport = win.visualViewport;
    const layoutHeight = Math.max(win.innerHeight || 0, root.clientHeight || 0);
    const layoutWidth = win.innerWidth || root.clientWidth || 0;
    const visibleHeight = viewport?.height || layoutHeight;
    const offsetTop = viewport?.offsetTop || 0;
    root.style.setProperty('--app-viewport-height', `${Math.round(visibleHeight)}px`);
    root.style.setProperty('--app-viewport-top', `${Math.round(offsetTop)}px`);
    const active = doc.activeElement;
    const editable = Boolean(active && !active.disabled && !active.readOnly && (
      active.isContentEditable || active.matches('textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="file"]):not([type="color"]):not([type="hidden"]):not([type="image"])')
    ));
    // Android may resize both layout and visual viewports. Keep the height from
    // before text entry, and discard it when rotation changes the layout width.
    if (Math.abs(layoutWidth - baselineWidth) > 80) baselineHeight = layoutHeight;
    baselineWidth = layoutWidth;
    if (!editable || !baselineHeight) baselineHeight = Math.max(layoutHeight, visibleHeight);
    root.classList.toggle('app-keyboard-open', mobile.matches && hasSoftwareKeyboard({
      editable, layoutHeight: baselineHeight, visibleHeight, scale: viewport?.scale || 1,
    }));
  };
  updateViewport();
  win.visualViewport?.addEventListener('resize', updateViewport);
  win.visualViewport?.addEventListener('scroll', updateViewport);
  win.addEventListener('resize', updateViewport);
  win.addEventListener('orientationchange', updateViewport);
  win.addEventListener('pageshow', updateViewport);
  doc.addEventListener('focusin', updateViewport);
  doc.addEventListener('focusout', () => win.requestAnimationFrame(updateViewport));
  mobile.addEventListener('change', updateViewport);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') initAppShell();
