/* Classic script at the start of body: cover the page before its first paint. */
(() => {
  const root = document.documentElement;
  const overlay = document.createElement('div');
  overlay.className = 'app-loading-overlay';
  overlay.innerHTML = '<span class="app-loading-spinner" role="status" aria-label="Carregando"></span>'
    + '<p class="app-loading-message" role="status" aria-live="polite"></p>'
    + '<button class="app-loading-retry" type="button" hidden>Recarregar página</button>';
  document.body.prepend(overlay);
  const message = overlay.querySelector('.app-loading-message');
  const retry = overlay.querySelector('button');
  retry.addEventListener('click', () => window.location.reload());

  const pending = new Set();
  const inertElements = new Set();
  let loaded = document.readyState === 'complete';
  let ready = false;
  let failed = false;
  let settling = false;
  let revision = 0;
  let timer;
  const nextFrame = () => new Promise(resolve => window.requestAnimationFrame(resolve));

  function blockContent() {
    for (const child of document.body.children) {
      if (child === overlay || child.inert) continue;
      child.inert = true;
      inertElements.add(child);
    }
  }
  const observer = new MutationObserver(blockContent);

  function hide() {
    window.clearTimeout(timer);
    observer.disconnect();
    for (const child of inertElements) child.inert = false;
    inertElements.clear();
    root.classList.remove('app-is-loading');
    overlay.hidden = true;
  }

  function show() {
    window.clearTimeout(timer);
    message.textContent = '';
    retry.hidden = true;
    overlay.hidden = false;
    root.classList.add('app-is-loading');
    blockContent();
    observer.observe(document.body, { childList: true });
  }

  function fail() {
    if (ready) return;
    failed = true;
    window.clearTimeout(timer);
    message.textContent = 'Não foi possível carregar esta tela. Tente novamente.';
    retry.hidden = false;
  }

  async function waitForImages() {
    await nextFrame();
    await document.fonts?.ready;
    const images = [...document.images].filter(image => {
      if (!image.getAttribute('src') || image.closest('[hidden]')) return false;
      const rect = image.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0
        && rect.top < window.innerHeight && rect.left < window.innerWidth;
    });
    await Promise.all(images.map(async image => {
      // Lazy images above the fold must also load while the content is hidden.
      image.loading = 'eager';
      try { await image.decode(); } catch { /* Broken images keep the page's own fallback. */ }
    }));
    await nextFrame();
  }

  async function finish() {
    if (!loaded || pending.size || ready || failed || settling) return;
    settling = true;
    const version = revision;
    try { await waitForImages(); }
    catch { fail(); }
    settling = false;
    if (failed) return;
    if (pending.size || version !== revision) { void finish(); return; }
    ready = true;
    hide();
    window.dispatchEvent(new Event('app-page-ready'));
  }

  // Initializers register the promise that includes data fetching AND rendering.
  // Later searches, pagination and editing keep their existing local indicators.
  function track(promise) {
    if (ready) return promise;
    revision++;
    pending.add(promise);
    Promise.resolve(promise).then(() => {
      pending.delete(promise);
      void finish();
    }, () => {
      pending.delete(promise);
      fail();
    });
    return promise;
  }

  function navigate() {
    if (!ready) return;
    show();
    // A canceled unload prompt or failed navigation must release the current page.
    timer = window.setTimeout(hide, 15000);
  }

  window.appLoading = { track, navigate };
  show();
  timer = window.setTimeout(() => {
    message.textContent = 'O carregamento está demorando mais que o esperado.';
    retry.hidden = false;
  }, 20000);

  window.addEventListener('load', () => { loaded = true; void finish(); }, { once: true });
  window.addEventListener('error', event => {
    if (event.target === window || event.target?.tagName === 'SCRIPT') fail();
  }, true);
  window.addEventListener('unhandledrejection', fail);
  window.addEventListener('pagehide', () => { if (ready) hide(); });
  window.addEventListener('pageshow', event => {
    if (event.persisted && ready) hide();
    else void finish();
  });

  const pagePath = /^(?:\/(?:index\.html|catalogo(?:\.html)?|import-produtos(?:\.html)?|parceiros(?:\.html)?|usuarios(?:\.html)?|backgrounds(?:\.html)?|revistas(?:\.html)?|login(?:\.html)?|offline\.html|(?:stories|feed|encarte|indoor-h)\.html|artes\/(?:stories|feed|encarte|indoor-h))?)\/?$/;
  document.addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest?.('a[href]');
    if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
    const destination = new URL(link.href, window.location.href);
    if (destination.origin !== window.location.origin || !pagePath.test(destination.pathname)) return;
    if (destination.pathname === window.location.pathname && destination.search === window.location.search) return;
    // Wait until editor guards and other click handlers have had a chance to cancel.
    queueMicrotask(() => { if (!event.defaultPrevented) navigate(); });
  });
  void finish();
})();
