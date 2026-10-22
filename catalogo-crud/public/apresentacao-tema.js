(() => {
  // Share the existing application's theme preference.
  const storageKey = 'vidamix-theme';
  const root = document.documentElement;
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = null;
  let button;

  function readPreference() {
    try {
      const stored = window.localStorage.getItem(storageKey);
      preference = stored === 'dark' || stored === 'light' ? stored : null;
    } catch { /* The switch remains usable when storage is unavailable. */ }
  }

  function applyTheme() {
    const dark = (preference || (system.matches ? 'dark' : 'light')) === 'dark';
    root.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#151515' : '#f3ede8');
    if (!button) return;
    const label = dark ? 'Ativar modo claro' : 'Ativar modo escuro';
    button.setAttribute('title', label);
    button.setAttribute('aria-pressed', String(dark));
  }

  // Apply before the stylesheet loads to avoid a flash of the other theme.
  readPreference();
  applyTheme();
  system.addEventListener('change', applyTheme);
  window.addEventListener('storage', (event) => {
    if (event.key !== storageKey && event.key !== null) return;
    readPreference();
    applyTheme();
  });
  window.addEventListener('pageshow', () => { readPreference(); applyTheme(); });

  function mount() {
    button = document.querySelector('[data-theme-toggle]');
    if (!button) return;
    button.addEventListener('click', () => {
      preference = root.dataset.theme === 'dark' ? 'light' : 'dark';
      try { window.localStorage.setItem(storageKey, preference); } catch { /* Use the choice for this page. */ }
      applyTheme();
    });
    applyTheme();
    button.hidden = false;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
