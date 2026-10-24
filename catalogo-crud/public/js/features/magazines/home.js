export const magazineMonth = month => new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T12:00:00Z`));

function renderMagazine(magazine) {
  const section = document.getElementById('revista-atual');
  if (!section) return;
  section.hidden = false;
  document.getElementById('home-magazine-title').textContent = magazine.title;
  document.getElementById('home-magazine-period').textContent = `Revista do mês / ${magazineMonth(magazine.month)}`;
  // The hero only needs the edition metadata. Load and build the product grid
  // when it approaches the viewport, instead of delaying the first screen.
  let mounting;
  const mount = () => {
    if (mounting) return mounting;
    mounting = import('./catalogue.js').then(({ mountMagazineCatalogue }) => {
      mountMagazineCatalogue(magazine);
    }).catch(() => {
      mounting = null;
      const status = document.getElementById('home-magazine-status');
      status.textContent = 'Não foi possível carregar os produtos da revista. ';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'partner-button';
      retry.textContent = 'Tentar novamente';
      retry.addEventListener('click', () => { status.textContent = ''; mount(); });
      status.append(retry);
    });
    globalThis.appLoading?.track(mounting);
    return mounting;
  };
  if (!('IntersectionObserver' in window)) { mount(); return; }
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    observer.disconnect();
    mount();
  }, { rootMargin: '300px' });
  observer.observe(section);
}

// This authenticated GET uses the session cookie and can run alongside /auth/me.
// A single request supplies both the hero and the monthly selection.
export const currentMagazine = (async () => {
  const response = await fetch('/api/revistas/destaque', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Revista indisponível');
  const { revista } = await response.json();
  if (!revista?.items?.length) return null;
  return revista;
})().catch(() => null);

currentMagazine.then(magazine => { if (magazine) renderMagazine(magazine); });
