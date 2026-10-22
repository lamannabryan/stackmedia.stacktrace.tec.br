const mobile = window.matchMedia('(max-width: 900px)');
const details = document.querySelector('#catalogue-filter-details');
const filters = ['category-filter', 'status-filter', 'image-filter'].map((id) => document.getElementById(id));
const filterCount = document.querySelector('#catalogue-filter-count');
const filterSummary = document.querySelector('#catalogue-filter-summary');
const search = document.querySelector('#search-input');
const dialog = document.querySelector('#product-dialog');
const deleteButton = document.querySelector('#delete-product-button');
const dialogFooter = document.querySelector('.dialog-footer');
const formFields = document.querySelector('.form-fields');
const toast = document.querySelector('#toast');
const toastHome = toast.parentElement;
const grid = document.querySelector('#product-grid');
const pageIndicator = document.querySelector('#page-indicator');
const previous = document.querySelector('#previous-page-button');
const next = document.querySelector('#next-page-button');
const previousBottom = document.querySelector('#catalogue-previous-bottom');
const nextBottom = document.querySelector('#catalogue-next-bottom');
const paginationBottom = document.querySelector('#catalogue-bottom-pagination');
const pageBottom = document.querySelector('#catalogue-page-bottom');
let filtersOpenBeforeTour = false;
let tourActive = false;

function updateFilterSummary() {
  const active = filters.filter((field) => field.value);
  filterCount.textContent = String(active.length);
  filterCount.hidden = !active.length;
  filterSummary.textContent = active.map((field) => field.selectedOptions[0]?.textContent).filter(Boolean).join(' · ') || 'Todos os produtos';
  details.querySelector('summary').setAttribute('aria-label', `Filtros: ${filterSummary.textContent}`);
}

function updatePagination() {
  const loading = Boolean(grid.querySelector('.skeleton'));
  previousBottom.disabled = loading || previous.disabled;
  nextBottom.disabled = loading || next.disabled;
  pageBottom.textContent = pageIndicator.textContent;
  paginationBottom.hidden = grid.hidden || (previous.disabled && next.disabled);
}

function setDialogViewport() {
  if (!mobile.matches || !dialog.open) {
    dialog.style.removeProperty('--catalogue-viewport-height');
    dialog.style.removeProperty('--catalogue-viewport-top');
    return;
  }
  const viewport = window.visualViewport;
  dialog.style.setProperty('--catalogue-viewport-height', `${Math.round(viewport?.height || window.innerHeight)}px`);
  dialog.style.setProperty('--catalogue-viewport-top', `${Math.round(viewport?.offsetTop || 0)}px`);
}

function syncDialog() {
  document.documentElement.classList.toggle('catalogue-dialog-open', mobile.matches && dialog.open);
  // A modal sits above the document: validation feedback must share its top layer.
  if (mobile.matches && dialog.open) dialog.append(toast);
  else if (toast.parentElement !== toastHome) toastHome.append(toast);
  setDialogViewport();
  if (dialog.open) document.querySelector('.form-layout').scrollTop = 0;
}

function applyLayout() {
  details.open = !mobile.matches || tourActive;
  if (mobile.matches) formFields.append(deleteButton);
  else dialogFooter.insertBefore(deleteButton, dialogFooter.firstElementChild);
  search.placeholder = mobile.matches ? 'Buscar nome, código ou fabricante' : 'Buscar por nome, EAN, fabricante ou princípio ativo';
  syncDialog();
}

filters.forEach((field) => field.addEventListener('change', updateFilterSummary));
document.querySelector('#category-chips').addEventListener('click', () => queueMicrotask(updateFilterSummary));
document.querySelector('#clear-filters-button').addEventListener('click', () => queueMicrotask(updateFilterSummary));
search.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && mobile.matches) search.blur();
});

for (const [button, original] of [[previousBottom, previous], [nextBottom, next]]) {
  button.addEventListener('click', () => {
    if (original.disabled) return;
    original.click();
    document.querySelector('.results-heading').scrollIntoView({ block: 'start', behavior: 'instant' });
  });
}

const paginationObserver = new MutationObserver(updatePagination);
paginationObserver.observe(pageIndicator, { childList: true, subtree: true, characterData: true });
paginationObserver.observe(previous, { attributes: true, attributeFilter: ['disabled'] });
paginationObserver.observe(next, { attributes: true, attributeFilter: ['disabled'] });
paginationObserver.observe(grid, { childList: true, attributes: true, attributeFilter: ['hidden'] });
new MutationObserver(syncDialog).observe(dialog, { attributes: true, attributeFilter: ['open'] });

// The existing tour targets the filter section. Open it while the tour is visible,
// then restore the user's disclosure state when the tour closes.
new MutationObserver(() => {
  const active = document.documentElement.classList.contains('tour-is-open');
  if (active === tourActive) return;
  tourActive = active;
  if (active) {
    filtersOpenBeforeTour = details.open;
    details.open = true;
  } else if (mobile.matches) details.open = filtersOpenBeforeTour;
}).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

window.visualViewport?.addEventListener('resize', setDialogViewport, { passive: true });
window.visualViewport?.addEventListener('scroll', setDialogViewport, { passive: true });
window.addEventListener('resize', setDialogViewport, { passive: true });
mobile.addEventListener('change', applyLayout);
applyLayout();
updateFilterSummary();
updatePagination();
