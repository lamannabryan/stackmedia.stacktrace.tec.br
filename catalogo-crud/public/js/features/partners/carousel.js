import { sessionReady } from '../../session.js';
import { logoArtwork } from './logo-artwork.js';
import { currentMagazine, magazineMonth } from '../magazines/home.js';
const root = document.querySelector('#partner-carousel');
const get = (name) => document.querySelector(`#partner-${name}`);
const logoImages = [...root.querySelectorAll('.partner-logo-frame img')];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let partners = [];
let index = 0;
let paused = reducedMotion.matches;
let hovered = false;
let timer;
const SLIDE_DURATION = 5000;
const LOGO_MOTION_DURATION = 2500;
let remaining = SLIDE_DURATION;
let startedAt = null;
let progressAnimation;
let artworkAnimation;
let switching = false;
let displayedIndex = null;
let transitionId = 0;
let animations = [];
const slideParts = [root.querySelector('.partner-slide-copy'), root.querySelector('.partner-logo-stage')];

async function animateSlide(entering, direction) {
  const starts = slideParts.map((part) => {
    const style = getComputedStyle(part);
    return { opacity: style.opacity, transform: style.transform };
  });
  animations.forEach((animation) => animation.cancel());
  animations = slideParts.map((part, i) => part.animate(entering ? [
    { opacity: 0, transform: `translateX(${direction * (i ? 20 : 14)}px)` },
    { opacity: 1, transform: 'translateX(0)' },
  ] : [
    starts[i],
    { opacity: 0, transform: `translateX(${-direction * 12}px)` },
  ], {
    duration: entering ? 440 : 160,
    delay: entering ? i * 45 : 0,
    easing: entering ? 'cubic-bezier(.22, 1, .36, 1)' : 'cubic-bezier(.4, 0, 1, 1)',
    fill: 'both',
  }));
  await Promise.all(animations.map((animation) => animation.finished.catch(() => {})));
}

function stopClock() {
  clearTimeout(timer);
  if (startedAt !== null) remaining = Math.max(0, remaining - (performance.now() - startedAt));
  startedAt = null;
  progressAnimation?.pause();
  artworkAnimation?.pause();
}

function resetArtworkMotion() {
  artworkAnimation?.cancel();
  artworkAnimation = null;
  if (reducedMotion.matches) return;
  const artwork = root.querySelector('.magazine-cover:not([hidden]), .partner-logo-frame:not([hidden])');
  if (!artwork || typeof artwork.animate !== 'function') return;
  // Animate translation independently to preserve the magazine's tilted cover
  // and the stage's existing entrance/exit transitions.
  artworkAnimation = artwork.animate([
    { translate: '-12px 0' },
    { translate: '12px 0' },
  ], {
    duration: artwork.matches('.partner-logo-frame') ? LOGO_MOTION_DURATION : SLIDE_DURATION,
    easing: 'linear',
    fill: 'both',
  });
  artworkAnimation.pause();
  artworkAnimation.currentTime = SLIDE_DURATION - remaining;
}

function resetClock() {
  stopClock();
  remaining = SLIDE_DURATION;
  progressAnimation?.cancel();
  progressAnimation = get('progress-fill').animate([
    { transform: 'scaleX(0)' }, { transform: 'scaleX(1)' },
  ], { duration: SLIDE_DURATION, easing: 'linear', fill: 'both' });
  progressAnimation.pause();
  progressAnimation.currentTime = 0;
  resetArtworkMotion();
}

function schedule() {
  stopClock();
  get('play').textContent = paused ? 'Reproduzir' : 'Pausar';
  get('play').setAttribute('aria-label', paused ? 'Reproduzir carrossel' : 'Pausar carrossel');
  const stopped = paused || hovered || document.hidden;
  get('time').textContent = stopped ? 'Pausado' : '5 s por destaque';
  if (displayedIndex === null || switching || stopped) return;
  if (artworkAnimation) {
    artworkAnimation.currentTime = SLIDE_DURATION - remaining;
    artworkAnimation.play();
  }
  if (partners.length < 2) {
    startedAt = performance.now();
    return;
  }
  startedAt = performance.now();
  if (progressAnimation) {
    progressAnimation.currentTime = SLIDE_DURATION - remaining;
    progressAnimation.play();
  }
  timer = setTimeout(() => show(index + 1), remaining);
}

async function show(next, announce = false) {
  const direction = next < index ? -1 : 1;
  const previous = index;
  index = (next + partners.length) % partners.length;
  if (index === previous && displayedIndex === index) return;
  const currentTransition = ++transitionId;
  switching = true;
  stopClock();
  const animated = displayedIndex !== null && !reducedMotion.matches && typeof slideParts[0].animate === 'function';
  if (animated) {
    await animateSlide(false, direction);
    if (currentTransition !== transitionId) return;
  } else {
    animations.forEach((animation) => animation.cancel());
    animations = [];
  }
  const partner = partners[index];
  const magazine = partner.magazine;
  const artwork = magazine ? null : await logoArtwork(partner.logo_url);
  if (currentTransition !== transitionId) return;
  document.getElementById('magazine-cover').hidden = !magazine;
  root.querySelector('.partner-logo-frame').hidden = Boolean(magazine);
  get('caption').textContent = magazine ? 'SUA SELEÇÃO DO MÊS' : 'MARCAS QUE CONECTAM';
  get('edition').textContent = String(index + 1).padStart(2, '0');
  if (magazine) {
    get('name').textContent = magazine.title;
    get('tag').textContent = `Revista atual · ${magazineMonth(magazine.month)}`;
    get('description').textContent = `${magazine.items.length} produtos selecionados, com preços sugeridos para inspirar suas próximas campanhas. Descubra a edição deste mês.`;
    get('products').href = '#revista-atual';
    get('products').textContent = 'Explorar a revista do mês →';
    document.getElementById('magazine-cover-month').textContent = magazine.month.slice(5);
    document.getElementById('magazine-cover-year').textContent = ` / ${magazine.month.slice(0, 4)}`;
    document.getElementById('magazine-cover-count').textContent = `${magazine.items.length} produtos para destacar`;
  } else {
  get('name').textContent = partner.fabricante;
  get('tag').textContent = 'Fabricante parceiro';
  get('description').textContent = partner.total
    ? `${partner.total.toLocaleString('pt-BR')} ${partner.total === 1 ? 'produto deste fabricante disponível' : 'produtos deste fabricante disponíveis'} no catálogo. Encontre sua próxima oferta e transforme em campanha.`
    : 'Conheça este parceiro e explore os produtos do catálogo para criar sua próxima campanha.';
  get('products').href = `/catalogo?fabricante=${encodeURIComponent(partner.fabricante)}`;
  get('products').textContent = 'Explorar produtos →';
  logoImages.forEach(image => { image.hidden = Boolean(artwork.failed); });
  get('logo-placeholder').hidden = !artwork.failed;
  get('logo').alt = `Logotipo de ${partner.fabricante}`;
  if (!artwork.failed) {
    logoImages.forEach(image => { image.src = artwork.src; });
    await Promise.all(logoImages.map(image => image.decode().catch(() => {})));
    if (currentTransition !== transitionId) return;
  } else logoImages.forEach(image => image.removeAttribute('src'));
  }
  get('slide').setAttribute('aria-label', `${index + 1} de ${partners.length}: ${partner.fabricante}`);
  get('counter').textContent = `${index + 1} / ${partners.length}`;
  Array.from(get('dots').children).forEach((dot, i) => dot.setAttribute('aria-pressed', String(i === index)));
  if (announce) get('announcement').textContent = `${partner.fabricante}, destaque ${index + 1} de ${partners.length}.`;
  displayedIndex = index;
  switching = false;
  resetClock();
  schedule();
  if (animated && !reducedMotion.matches) {
    await animateSlide(true, direction);
    if (currentTransition !== transitionId) return;
  }
  animations.forEach((animation) => animation.cancel());
  animations = [];
}

get('logo').addEventListener('error', () => {
  logoImages.forEach(image => { image.hidden = true; });
  get('logo-placeholder').hidden = false;
});
get('previous').addEventListener('click', () => show(index - 1, true));
get('next').addEventListener('click', () => show(index + 1, true));
get('play').addEventListener('click', () => { paused = !paused; schedule(); });
root.addEventListener('pointerenter', (event) => { if (event.pointerType === 'mouse') { hovered = true; schedule(); } });
root.addEventListener('pointerleave', () => { hovered = false; schedule(); });
// Stop on keyboard focus and resume only when explicitly requested.
root.addEventListener('focusin', (event) => {
  if (event.target === get('play')) return;
  paused = true;
  schedule();
});
document.addEventListener('visibilitychange', schedule);
window.addEventListener('pagehide', stopClock);
window.addEventListener('pageshow', schedule);
reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) {
    paused = true;
    animations.forEach((animation) => animation.cancel());
    artworkAnimation?.cancel();
    artworkAnimation = null;
    schedule();
  } else {
    resetArtworkMotion();
    schedule();
  }
});

async function load() {
  root.setAttribute('aria-busy', 'true');
  get('loading').hidden = false;
  get('retry').hidden = true;
  try {
    const [partnerResult, magazine] = await Promise.all([
      fetch('/api/featured-partners', { cache: 'no-store', signal: AbortSignal.timeout(15000) })
        .then(async response => { if (!response.ok) throw new Error('load'); return (await response.json()).items; })
        .catch(() => null),
      currentMagazine,
    ]);
    if (!partnerResult && !magazine) throw new Error('load');
    partners = partnerResult || [];
    const { user } = await sessionReady;
    // Decode every partner, including the prepared crops, before revealing home.
    await Promise.all(partners.map(partner => logoArtwork(partner.logo_url)));
    if (magazine) partners.unshift({ fabricante: magazine.title, magazine });
    get('products').hidden = false;
    get('controls').hidden = partners.length < 2;
    get('progress').hidden = partners.length < 2;
    get('dots').replaceChildren(...partners.map((partner, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', `Mostrar ${partner.fabricante}`);
      button.addEventListener('click', () => show(i, true));
      return button;
    }));
    if (partners.length) await show(0);
    else {
      get('name').textContent = 'Sua próxima campanha começa aqui.';
      get('description').textContent = 'Explore os produtos do catálogo e prepare sua próxima campanha.';
      get('products').href = user.role === 'administrador' ? '/parceiros' : '/catalogo';
      get('products').textContent = user.role === 'administrador' ? 'Cadastrar parceiros →' : 'Explorar catálogo →';
    }
  } catch {
    get('name').textContent = 'Destaques indisponíveis';
    get('description').textContent = 'Não foi possível carregar os destaques. Tente novamente em instantes.';
    get('products').hidden = true;
    get('retry').hidden = false;
  } finally {
    get('loading').hidden = true;
    root.setAttribute('aria-busy', 'false');
  }
}
get('retry').addEventListener('click', load);
load();
