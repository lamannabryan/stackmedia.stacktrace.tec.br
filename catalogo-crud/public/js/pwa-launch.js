(() => {
  const preview = new URLSearchParams(window.location.search).get('abertura') === '1';
  const standalone = window.matchMedia('(display-mode: standalone)').matches
    || navigator.standalone === true;
  if (!preview && !standalone) return;

  // Each screen is a document: internal links must not replay the introduction.
  const navigation = performance.getEntriesByType('navigation')[0];
  let internal = false;
  try {
    internal = Boolean(document.referrer)
      && new URL(document.referrer).origin === window.location.origin;
  } catch { /* An unavailable referrer is treated as a fresh launch. */ }
  if (!preview && (internal || ['reload', 'back_forward'].includes(navigation?.type))) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const splash = document.createElement('div');
  splash.className = 'pwa-launch';
  splash.setAttribute('aria-hidden', 'true');
  splash.innerHTML = `
    <div class="pwa-launch-content">
      <img class="pwa-launch-logo" src="/branding/stackmedia-wordmark.svg" width="288" height="40" alt="_stackmedia" fetchpriority="high" />
      <div class="pwa-launch-track"><span></span></div>
    </div>`;

  const timers = [];
  let dismissed = false;
  const remove = () => {
    dismissed = true;
    timers.forEach(window.clearTimeout);
    splash.remove();
    window.removeEventListener('pagehide', remove);
    window.removeEventListener('keydown', remove);
    document.removeEventListener('DOMContentLoaded', ready);
  };
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    splash.classList.add('is-leaving');
    timers.push(window.setTimeout(remove, reducedMotion ? 0 : 360));
  };
  const started = performance.now();
  const ready = () => {
    if (dismissed) return;
    timers.push(window.setTimeout(dismiss, Math.max(0, (reducedMotion ? 180 : 1500) - (performance.now() - started))));
  };

  document.body.prepend(splash);
  splash.addEventListener('pointerdown', remove, { once: true });
  window.addEventListener('keydown', remove, { once: true });
  // Remove before entering the back/forward cache, including unfinished launches.
  window.addEventListener('pagehide', remove, { once: true });
  timers.push(window.setTimeout(remove, 3200));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();
})();
