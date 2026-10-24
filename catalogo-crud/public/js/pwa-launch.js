(() => {
  // A abertura da tela inicial é um véu próprio (/js/home-intro.js + home.css).
  if (document.body?.classList.contains('home-page')) return;

  const preview = new URLSearchParams(window.location.search).get('abertura') === '1';
  const standalone = window.matchMedia('(display-mode: standalone)').matches
    || navigator.standalone === true;
  if (!preview && !standalone) return;

  // Cada tela é um documento: links internos não reexecutam a introdução.
  const navigation = performance.getEntriesByType('navigation')[0];
  let internal = false;
  try {
    internal = Boolean(document.referrer)
      && new URL(document.referrer).origin === window.location.origin;
  } catch { /* referrer indisponível = tratamos como nova abertura */ }
  if (!preview && (internal || ['reload', 'back_forward'].includes(navigation?.type))) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const mount = () => {
    const splash = document.createElement('div');
    splash.className = 'pwa-launch';
    splash.setAttribute('aria-hidden', 'true');
    splash.innerHTML = `
      <div class="pwa-launch-content">
        <img class="pwa-launch-logo"
             src="/branding/stackmedia-wordmark.svg"
             width="288" height="40" alt="_stackmedia"
             fetchpriority="high" decoding="async" />
      </div>`;

    const timers = [];
    let dismissed = false;

    const remove = () => {
      if (dismissed && !splash.isConnected) return;
      dismissed = true;
      timers.forEach(clearTimeout);
      timers.length = 0;
      splash.remove();
      document.removeEventListener('DOMContentLoaded', scheduleDismiss);
      window.removeEventListener('pagehide', remove);
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('keydown', onKey);
      splash.removeEventListener('pointerdown', onPointer);
    };

    const dismiss = () => {
      if (dismissed) return;
      splash.classList.add('is-leaving');
      timers.push(setTimeout(remove, reducedMotion ? 0 : 720));
    };

    const onKey = () => remove();
    const onPointer = () => remove();
    const onVisibilityChange = () => { if (document.hidden) remove(); };
    const onPageShow = (event) => { if (event.persisted) remove(); };

    const start = performance.now();
    const minVisible = reducedMotion ? 300 : 3200;
    const scheduleDismiss = () => {
      if (dismissed) return;
      const wait = Math.max(0, minVisible - (performance.now() - start));
      timers.push(setTimeout(dismiss, wait));
    };

    document.body.prepend(splash);
    timers.push(setTimeout(remove, 4500));

    splash.addEventListener('pointerdown', onPointer, { once: true });
    window.addEventListener('keydown', onKey, { once: true });
    window.addEventListener('pagehide', remove);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibilityChange);

    if (document.hidden) {
      remove();
      return;
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', scheduleDismiss, { once: true });
    } else {
      scheduleDismiss();
    }
  };

  if (document.body) {
    mount();
  } else {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  }
})();
