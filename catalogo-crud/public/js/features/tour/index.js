import { TOUR_VERSION, getTour } from './steps.js';
import { createTourStorage, TOUR_STORAGE_KEY } from './storage.js';

let page = document.body.dataset.tourPage;
const currentTour = () => getTour(page, { mobile: window.matchMedia('(max-width: 900px)').matches });
let tour = currentTour();
if (tour && typeof HTMLDialogElement !== 'undefined') initTour();

function initTour() {
  const storage = createTourStorage(TOUR_VERSION);
  const dialog = document.createElement('dialog');
  dialog.className = 'tour-dialog';
  dialog.setAttribute('aria-labelledby', 'tour-title');
  dialog.setAttribute('aria-describedby', 'tour-description');
  dialog.innerHTML = `
    <div class="tour-shade" aria-hidden="true"></div>
    <div class="tour-spotlight" aria-hidden="true" hidden></div>
    <section class="tour-card" data-mode="welcome">
      <button class="tour-close" type="button" aria-label="Fechar tour">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      </button>
      <div class="tour-brand">_stackmedia <span aria-hidden="true">/</span> TOUR GUIADO</div>
      <div class="tour-symbol" aria-hidden="true">
        <svg width="36" height="36" viewBox="0 0 36 36" fill="none"><path d="m18 4 3.8 10.2L32 18l-10.2 3.8L18 32l-3.8-10.2L4 18l10.2-3.8L18 4Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="18" cy="18" r="3" fill="currentColor"/></svg>
      </div>
      <p class="tour-kicker"></p>
      <h2 class="tour-title" id="tour-title" tabindex="-1" aria-describedby="tour-description"></h2>
      <p class="tour-description" id="tour-description"></p>
      <p class="tour-meta"></p>
      <div class="tour-progress" role="progressbar" aria-label="Progresso do tour" aria-valuemin="0"><span class="tour-progress-fill"></span></div>
      <div class="tour-footer">
        <button class="tour-skip" type="button">Pular tour</button>
        <div class="tour-navigation">
          <button class="tour-back" type="button">Voltar</button>
          <button class="tour-next" type="button">Começar tour</button>
        </div>
      </div>
      <p class="tour-hint">← → para navegar · Esc para sair</p>
      <p class="tour-storage-note" role="status" hidden>Seu navegador não permitiu salvar o progresso. O tour poderá aparecer na próxima visita.</p>
    </section>`;
  document.body.append(dialog);
  const find = (name) => dialog.querySelector(`.tour-${name}`);
  const card = find('card');
  const shade = find('shade');
  const spotlight = find('spotlight');
  const title = find('title');
  const description = find('description');
  const kicker = find('kicker');
  const meta = find('meta');
  const progress = find('progress');
  const next = find('next');
  const back = find('back');
  const skip = find('skip');
  const launchers = [...document.querySelectorAll('[data-tour-start]')];
  let steps = [];
  let index = -1;
  let mode = 'welcome';
  let target = null;
  let previousFocus;
  let scrollPositions = [];
  let frame = 0;
  let autoTimer;
  let autoPending = true;
  let layoutObserver;
  let sessionEvents;

  function persist(status, stepId) {
    storage.update(page, status, stepId);
    find('storage-note').hidden = storage.available;
  }

  function getTarget(step) {
    const element = step && document.querySelector(step.target);
    if (!element || !element.getClientRects().length) return null;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' ? element : null;
  }

  // Remember nested sidebar scroll as well as the document, then restore on exit.
  function rememberScroll(element) {
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if ((ancestor.scrollHeight > ancestor.clientHeight || ancestor.scrollWidth > ancestor.clientWidth)
        && !scrollPositions.some((entry) => entry.element === ancestor)) {
        scrollPositions.push({ element: ancestor, top: ancestor.scrollTop, left: ancestor.scrollLeft });
      }
    }
  }

  function showStep(stepIndex) {
    if (stepIndex >= steps.length) {
      showComplete();
      return;
    }
    if (stepIndex < 0) {
      showWelcome();
      return;
    }
    index = stepIndex;
    const nextTarget = document.querySelector(steps[index].target);
    if (nextTarget) document.dispatchEvent(new CustomEvent('story:reveal-target', { detail: { target: nextTarget } }));
    target = getTarget(steps[index]);
    // A panel removed/hidden after startup should not break the rest of the tour.
    if (!target) {
      steps.splice(index, 1);
      showStep(Math.min(index, steps.length));
      return;
    }
    mode = 'step';
    card.dataset.mode = mode;
    title.textContent = steps[index].title;
    description.textContent = steps[index].description;
    kicker.textContent = steps[index].eyebrow || tour.title;
    meta.textContent = `Etapa ${index + 1} de ${steps.length}`;
    next.textContent = index === steps.length - 1 ? 'Concluir' : 'Próximo';
    back.hidden = false;
    skip.hidden = false;
    find('symbol').hidden = true;
    progress.hidden = false;
    progress.setAttribute('aria-valuemax', String(steps.length));
    progress.setAttribute('aria-valuenow', String(index + 1));
    progress.setAttribute('aria-valuetext', meta.textContent);
    find('progress-fill').style.width = `${((index + 1) / steps.length) * 100}%`;
    persist('in-progress', steps[index].id);
    rememberScroll(target);
    target.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' });
    layoutObserver?.observe(target);
    position();
    title.focus({ preventScroll: true });
  }

  function showWelcome() {
    mode = 'welcome';
    index = -1;
    target = null;
    card.dataset.mode = mode;
    title.textContent = tour.title;
    description.textContent = tour.description;
    kicker.textContent = 'VAMOS COMEÇAR';
    meta.textContent = `${steps.length} etapas · Cerca de 1 minuto`;
    next.textContent = 'Começar tour';
    back.hidden = true;
    skip.hidden = false;
    progress.hidden = true;
    find('symbol').hidden = false;
    position();
    title.focus({ preventScroll: true });
  }

  function showComplete() {
    mode = 'complete';
    target = null;
    card.dataset.mode = mode;
    title.textContent = 'Tudo pronto. Agora é com você!';
    description.textContent = 'Você já conhece os principais recursos desta tela. Para rever as dicas quando quiser, use o botão “Tour guiado”.';
    kicker.textContent = 'TOUR CONCLUÍDO';
    meta.textContent = 'Seu próximo projeto começa aqui.';
    next.textContent = 'Explorar';
    back.hidden = true;
    skip.hidden = true;
    progress.hidden = true;
    find('symbol').hidden = false;
    persist('completed');
    position();
    title.focus({ preventScroll: true });
  }

  function viewport() {
    const visual = window.visualViewport;
    return { left: visual?.offsetLeft || 0, top: visual?.offsetTop || 0,
      width: visual?.width || window.innerWidth, height: visual?.height || window.innerHeight };
  }

  function position() {
    if (!dialog.open) return;
    const view = viewport();
    const margin = 12;
    const gap = 18;
    card.style.maxHeight = `${Math.max(100, view.height - margin * 2)}px`;
    card.style.maxWidth = `${view.width - margin * 2}px`;
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    const minX = view.left + margin;
    const minY = view.top + margin;
    const maxX = Math.max(minX, view.left + view.width - width - margin);
    const maxY = Math.max(minY, view.top + view.height - height - margin);
    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
    let x = view.left + (view.width - width) / 2;
    let y = view.top + (view.height - height) / 2;
    shade.hidden = false;
    spotlight.hidden = true;
    card.dataset.placement = 'center';

    if (mode === 'step' && target?.isConnected) {
      const rect = target.getBoundingClientRect();
      // Clip the cutout to scroll containers, especially the Stories sidebars.
      let left = Math.max(view.left + 4, rect.left - 6);
      let top = Math.max(view.top + 4, rect.top - 6);
      let right = Math.min(view.left + view.width - 4, rect.right + 6);
      let bottom = Math.min(view.top + view.height - 4, rect.bottom + 6);
      for (let ancestor = target.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        const bounds = ancestor.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
          top = Math.max(top, bounds.top);
          bottom = Math.min(bottom, bounds.bottom);
        }
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
          left = Math.max(left, bounds.left);
          right = Math.min(right, bounds.right);
        }
      }
      if (right > left && bottom > top) {
        shade.hidden = true;
        spotlight.hidden = false;
        Object.assign(spotlight.style, { left: `${left}px`, top: `${top}px`,
          width: `${right - left}px`, height: `${bottom - top}px` });
        const centeredX = clamp((left + right - width) / 2, minX, maxX);
        const centeredY = clamp((top + bottom - height) / 2, minY, maxY);
        const candidates = {
          bottom: { x: centeredX, y: bottom + gap, fits: bottom + gap <= maxY },
          top: { x: centeredX, y: top - height - gap, fits: top - height - gap >= minY },
          right: { x: right + gap, y: centeredY, fits: right + gap <= maxX },
          left: { x: left - width - gap, y: centeredY, fits: left - width - gap >= minX },
        };
        const preferred = steps[index].placement || 'bottom';
        const order = [preferred, 'bottom', 'right', 'left', 'top'];
        const placement = order.find((side) => candidates[side]?.fits);
        if (placement) {
          ({ x, y } = candidates[placement]);
          card.dataset.placement = placement;
        } else {
          // Large targets / short viewports: dock opposite the target's center.
          y = (top + bottom) / 2 < view.top + view.height / 2 ? maxY : minY;
          card.dataset.placement = 'docked';
        }
      }
    }
    card.style.left = `${clamp(x, minX, maxX)}px`;
    card.style.top = `${clamp(y, minY, maxY)}px`;
  }

  function schedulePosition() {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; position(); });
  }

  function advance() {
    if (mode === 'complete') close(false);
    else showStep(index + 1);
  }

  function close(dismiss = true) {
    if (!dialog.open) return;
    if (dismiss && mode !== 'complete') persist('dismissed');
    sessionEvents?.abort();
    layoutObserver?.disconnect();
    cancelAnimationFrame(frame);
    frame = 0;
    dialog.close();
    document.documentElement.classList.remove('tour-is-open');
    document.dispatchEvent(new CustomEvent('story:tour-end'));
    for (const entry of scrollPositions) {
      entry.element.scrollTo({ top: entry.top, left: entry.left, behavior: 'instant' });
    }
    scrollPositions = [];
    const focus = previousFocus?.isConnected && previousFocus !== document.body ? previousFocus : launchers[0];
    focus?.focus({ preventScroll: true });
  }

  function open({ replay = false } = {}) {
    if (dialog.open) return;
    tour = currentTour();
    // Let the scanner or product dialog finish before offering onboarding.
    if ([...document.querySelectorAll('dialog[open], [aria-modal="true"]:not([hidden])')]
        .some((element) => element !== dialog && element.getClientRects().length)) return;
    const saved = storage.read();
    find('storage-note').hidden = storage.available;
    if (!replay && (saved.dismissed || ['completed', 'dismissed'].includes(saved.pages[page]?.status))) {
      autoPending = false;
      return;
    }
    steps = tour.steps.filter((step) => getTarget(step)
      || (['stories', 'feed', 'encarte'].includes(page) && document.body.classList.contains('is-mobile-editor')
        && document.querySelector(step.target)?.closest('[data-mobile-group]')));
    if (!steps.length) return;
    autoPending = false;
    clearTimeout(autoTimer);
    previousFocus = document.activeElement;
    scrollPositions = [{ element: document.scrollingElement,
      top: document.scrollingElement.scrollTop, left: document.scrollingElement.scrollLeft }];
    dialog.showModal();
    document.documentElement.classList.add('tour-is-open');
    sessionEvents = new AbortController();
    const { signal } = sessionEvents;
    window.addEventListener('resize', schedulePosition, { signal });
    document.addEventListener('scroll', schedulePosition, { capture: true, passive: true, signal });
    window.visualViewport?.addEventListener('resize', schedulePosition, { signal });
    window.visualViewport?.addEventListener('scroll', schedulePosition, { signal });
    layoutObserver = new ResizeObserver(schedulePosition);
    layoutObserver.observe(card);
    layoutObserver.observe(document.body);
    const resume = !replay && saved.pages[page]?.status === 'in-progress'
      ? steps.findIndex((step) => step.id === saved.pages[page].stepId) : -1;
    if (resume >= 0) showStep(resume);
    else showWelcome();
  }

  next.addEventListener('click', advance);
  back.addEventListener('click', () => showStep(index - 1));
  skip.addEventListener('click', () => close());
  find('close').addEventListener('click', () => close());
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  // Prevent the editor's document shortcuts from reacting to tour interactions.
  dialog.addEventListener('pointerdown', (event) => event.stopPropagation());
  dialog.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); advance(); }
    else if (event.key === 'ArrowLeft' && mode === 'step') { event.preventDefault(); showStep(index - 1); }
    else if (event.key === 'Tab') {
      const buttons = [...card.querySelectorAll('button')].filter((button) => !button.hidden && !button.disabled);
      const current = buttons.indexOf(document.activeElement);
      if (event.shiftKey && current <= 0) { event.preventDefault(); buttons.at(-1).focus(); }
      else if (!event.shiftKey && (current === buttons.length - 1 || current === -1)) {
        event.preventDefault(); buttons[0].focus();
      }
    }
  });
  launchers.forEach((button) => button.addEventListener('click', () => open({ replay: true })));
  if (new URLSearchParams(location.search).get('tour') === '1') {
    const url = new URL(location.href); url.searchParams.delete('tour');
    history.replaceState(history.state, '', url);
    open({ replay: true });
  }

  function offerTour() {
    if (!autoPending || document.visibilityState !== 'visible') return;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => {
      open();
      if (autoPending) offerTour();
    }, 700);
  }
  // Wait for the page, without waiting indefinitely for image downloads or API calls.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', offerTour, { once: true });
  else offerTour();
  document.addEventListener('visibilitychange', offerTour);
  window.addEventListener('pagehide', () => {
    clearTimeout(autoTimer);
    close(false);
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) { autoPending = true; offerTour(); }
  });
  window.addEventListener('storage', (event) => {
    if (event.key === TOUR_STORAGE_KEY && storage.read().dismissed) {
      autoPending = false;
      clearTimeout(autoTimer);
      close(false);
    }
  });
  document.addEventListener('artwork:format-change', () => {
    close(false);
    autoPending = false;
    clearTimeout(autoTimer);
    page = document.body.dataset.tourPage;
    tour = currentTour();
  });
}
