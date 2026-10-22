document.documentElement.classList.add('js-ready');

const menuButton = document.querySelector('.menu-toggle');
const navigation = document.querySelector('.site-nav');

function closeMenu() {
  if (!menuButton || !navigation) return;
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-label', 'Abrir menu');
  menuButton.innerHTML = '<i class="fa-solid fa-bars" aria-hidden="true"></i>';
  navigation.classList.remove('is-open');
}

if (menuButton && navigation) {
  menuButton.addEventListener('click', () => {
    const open = menuButton.getAttribute('aria-expanded') !== 'true';
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
    menuButton.innerHTML = `<i class="fa-solid ${open ? 'fa-xmark' : 'fa-bars'}" aria-hidden="true"></i>`;
    navigation.classList.toggle('is-open', open);
  });

  navigation.addEventListener('click', (event) => {
    if (event.target.closest('a')) closeMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 760) closeMenu();
  });
}

const year = document.querySelector('#current-year');
if (year) year.textContent = String(new Date().getFullYear());

const screenshotFilters = document.querySelector('.screenshot-filters');
const screenshotGroups = [...document.querySelectorAll('[data-shot-group]')];
const screenshotStatus = document.querySelector('#screenshots-status');
const galleryShots = [...document.querySelectorAll('.screenshots [data-screenshot]')];

if (screenshotFilters && screenshotGroups.length) {
  screenshotFilters.hidden = false;
  screenshotFilters.addEventListener('click', (event) => {
    const button = event.target.closest('[data-shot-filter]');
    if (!button) return;

    const filter = button.dataset.shotFilter;
    screenshotFilters.querySelectorAll('[data-shot-filter]').forEach((item) => {
      const active = item === button;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    screenshotGroups.forEach((group) => {
      group.hidden = filter !== 'all' && group.dataset.shotGroup !== filter;
    });

    const count = galleryShots.filter((shot) => !shot.closest('[data-shot-group]').hidden).length;
    if (screenshotStatus) screenshotStatus.textContent = `${count} telas exibidas.`;
  });
}

const screenshotDialog = document.querySelector('#screenshot-dialog');

// Keep the original image links working in browsers without native dialogs.
if (screenshotDialog && typeof screenshotDialog.showModal === 'function') {
  const dialogImage = screenshotDialog.querySelector('#screenshot-dialog-image');
  const dialogTitle = screenshotDialog.querySelector('#screenshot-dialog-title');
  const dialogDescription = screenshotDialog.querySelector('#screenshot-dialog-description');
  const dialogCounter = screenshotDialog.querySelector('#screenshot-dialog-counter');
  const originalImage = screenshotDialog.querySelector('#screenshot-original');
  let currentShots = [];
  let currentShot = 0;
  let opener = null;

  function showScreenshot(index) {
    if (!currentShots.length) return;
    currentShot = (index + currentShots.length) % currentShots.length;
    const shot = currentShots[currentShot];
    dialogImage.src = shot.href;
    dialogImage.alt = shot.querySelector('img')?.alt || shot.dataset.shotTitle;
    dialogTitle.textContent = shot.dataset.shotTitle;
    dialogDescription.textContent = shot.dataset.shotDescription;
    dialogCounter.textContent = `${currentShot + 1} / ${currentShots.length}`;
    originalImage.href = shot.href;
  }

  document.querySelectorAll('[data-screenshot]').forEach((link) => {
    link.addEventListener('click', (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const fromGallery = Boolean(link.closest('.screenshots'));
      currentShots = fromGallery
        ? galleryShots.filter((shot) => !shot.closest('[data-shot-group]').hidden)
        : galleryShots;
      const index = currentShots.findIndex((shot) => shot.href === link.href);
      if (index < 0) return;

      event.preventDefault();
      opener = link;
      showScreenshot(index);
      screenshotDialog.showModal();
      document.body.classList.add('screenshot-viewing');
    });
  });

  screenshotDialog.querySelector('.screenshot-dialog-close').addEventListener('click', () => screenshotDialog.close());
  screenshotDialog.querySelector('[data-shot-previous]').addEventListener('click', () => showScreenshot(currentShot - 1));
  screenshotDialog.querySelector('[data-shot-next]').addEventListener('click', () => showScreenshot(currentShot + 1));

  screenshotDialog.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      showScreenshot(currentShot + (event.key === 'ArrowLeft' ? -1 : 1));
    }
    // Escape and focus containment are handled by the native modal dialog.
  });

  screenshotDialog.addEventListener('click', (event) => {
    if (event.target !== screenshotDialog) return;
    const bounds = screenshotDialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
      screenshotDialog.close();
    }
  });

  screenshotDialog.addEventListener('close', () => {
    document.body.classList.remove('screenshot-viewing');
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  });
}

if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const observer = new IntersectionObserver((entries, currentObserver) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-visible');
      currentObserver.unobserve(entry.target);
    }
  }, { threshold: 0.12 });

  document.querySelectorAll('[data-reveal]').forEach((element) => observer.observe(element));
} else {
  document.querySelectorAll('[data-reveal]').forEach((element) => element.classList.add('is-visible'));
}
