/*
 * Abertura da tela inicial: véu de 2 s com gradient animado.
 *
 * É um script clássico no início do <body> para montar o véu antes da primeira
 * pintura do conteúdo. Os estilos ficam em /home.css (véu e cascata de entrada).
 *
 * Regras:
 * - só roda na tela inicial (body.home-page);
 * - aparece em abertura direta, recarga e com ?abertura=1;
 * - não repete ao voltar de outra tela do site nem em navegação de histórico;
 * - com preferência por menos movimento, o conteúdo aparece de imediato;
 * - um toque, uma tecla ou sair da página encerra o véu na hora.
 */
(() => {
  const DURATION = 2000; // tempo do véu na tela, em ms
  const EXIT = 650;      // quanto antes do fim o véu começa a se dissolver, em ms

  const body = document.body;
  if (!body?.classList.contains('home-page')) return;

  // Sem véu e sem cascata: as classes de animação nem chegam a ser aplicadas.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const fromAnotherPage = () => {
    try {
      return Boolean(document.referrer)
        && new URL(document.referrer).origin === window.location.origin;
    } catch {
      return false; // referrer ilegível conta como abertura nova
    }
  };
  const cameFromHistory = () => {
    const navigation = performance.getEntriesByType?.('navigation')?.[0];
    return navigation?.type === 'back_forward';
  };
  const forced = new URLSearchParams(window.location.search).get('abertura') === '1';
  if (!forced && (fromAnotherPage() || cameFromHistory())) return;

  const overlay = document.createElement('div');
  overlay.className = 'home-intro';
  overlay.setAttribute('aria-hidden', 'true'); // puramente decorativo
  overlay.innerHTML = `
    <span class="home-intro-canvas"></span>
    <span class="home-intro-blob is-red"></span>
    <span class="home-intro-blob is-orange"></span>
    <span class="home-intro-blob is-ink"></span>
    <span class="home-intro-vignette"></span>
    <div class="home-intro-content">
      <img class="home-intro-logo is-light" src="/branding/stackmedia-wordmark.svg"
           width="288" height="40" alt="" decoding="async" fetchpriority="high" />
      <img class="home-intro-logo is-dark" src="/branding/stackmedia-wordmark-dark.svg"
           width="288" height="40" alt="" decoding="async" fetchpriority="high" />
      <p class="home-intro-caption">Central de criação</p>
    </div>`;

  const timers = [];
  let handedOff = false;
  let finished = false;

  // Libera a cascata de entrada do conteúdo (home.css) enquanto o véu ainda existe.
  const handoff = () => {
    if (handedOff) return;
    handedOff = true;
    body.classList.add('home-entry-ready');
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    // A abertura nunca pode bloquear a aplicação. Isso também cobre o caso
    // em que o navegador suspende os timers durante a inicialização do PWA.
    handoff();
    timers.forEach(clearTimeout);
    timers.length = 0;
    overlay.remove();
    overlay.removeEventListener('pointerdown', skip);
    window.removeEventListener('keydown', skip);
    window.removeEventListener('pagehide', finish);
    window.removeEventListener('pageshow', onPageShow);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };

  const beginExit = () => {
    if (finished) return;
    overlay.classList.add('is-leaving');
    handoff();
  };

  const skip = () => {
    beginExit();
    finish();
  };

  // Apps podem ser suspensos sem pagehide; não preserve o véu na retomada.
  const onVisibilityChange = () => { if (document.hidden) finish(); };
  const onPageShow = (event) => { if (event.persisted) finish(); };

  body.prepend(overlay);
  // O CSS possui uma saída independente dos timers JS. Em alguns PWAs o
  // primeiro ciclo de timers pode ser atrasado enquanto a página é retomada.
  overlay.addEventListener('animationend', (event) => {
    if (event.animationName === 'home-intro-safety-exit') finish();
  });
  timers.push(setTimeout(beginExit, DURATION - EXIT));
  timers.push(setTimeout(finish, DURATION));

  overlay.addEventListener('pointerdown', skip, { once: true });
  window.addEventListener('keydown', skip, { once: true });
  window.addEventListener('pagehide', finish, { once: true });
  window.addEventListener('pageshow', onPageShow);
  document.addEventListener('visibilitychange', onVisibilityChange);
  if (document.hidden) finish();
})();
