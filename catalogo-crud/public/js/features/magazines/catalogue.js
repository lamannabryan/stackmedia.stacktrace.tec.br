import { renderProductCard } from '../catalogue/product-card.js';
import { MAGAZINE_PRODUCT_LIMIT, magazineArtworkUrl } from './selection.js';

export function mountMagazineCatalogue(magazine) {
  const node = (tag, text, className) => {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  };
  const money = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  const items = magazine.items.filter(item => item.product);
  const selected = new Map();
  const search = document.getElementById('home-magazine-search');
  const mobile = matchMedia('(max-width: 900px)');
  const grid = document.getElementById('home-magazine-products'); grid.className = 'product-grid';
  const results = document.getElementById('home-magazine-status'); results.className = 'eyebrow';
  const heading = node('div', undefined, 'results-heading'); results.before(heading);
  const count = node('h3'), copy = node('div'); copy.append(results, count); heading.append(copy);
  let page = 1;
  const pageSize = 48, pagers = [];
  function pager(bottom) {
    const wrapper = node('div', undefined, bottom ? 'catalogue-bottom-pagination' : 'pagination');
    wrapper.setAttribute('aria-label', 'Paginação da revista');
    const previous = node('button', bottom ? '← Anterior' : '←', bottom ? 'ghost-button' : 'icon-button');
    const next = node('button', bottom ? 'Próxima →' : '→', bottom ? 'ghost-button' : 'icon-button');
    const indicator = node('span');
    for (const [button, direction, label] of [[previous, -1, 'Página anterior'], [next, 1, 'Próxima página']]) {
      button.type = 'button'; button.setAttribute('aria-label', label);
      button.addEventListener('click', () => { page += direction; render(); if (bottom) heading.scrollIntoView({ block: 'start' }); });
    }
    wrapper.append(previous, indicator, next); pagers.push({ wrapper, previous, next, indicator, bottom }); return wrapper;
  }
  heading.append(pager(false)); document.getElementById('home-magazine-more').replaceWith(pager(true));
  const selectionBar = node('div', undefined, 'magazine-selection-bar');
  selectionBar.setAttribute('role', 'group');
  selectionBar.setAttribute('aria-label', 'Criar com produtos selecionados');
  const selectionInfo = node('div', undefined, 'magazine-selection-info');
  const selectionCount = node('strong');
  selectionCount.setAttribute('role', 'status');
  const selectionHint = node('p');
  selectionInfo.append(selectionCount, selectionHint);
  const selectionActions = node('div', undefined, 'magazine-selection-actions');
  const clearSelection = node('button', 'Limpar seleção', 'magazine-selection-clear');
  clearSelection.type = 'button';
  clearSelection.onclick = () => { selected.clear(); syncSelection(); };
  const artworkButtons = ['encarte', 'tv'].map(format => {
    const button = node('button', format === 'tv' ? 'TV' : 'Encarte', 'magazine-selection-create');
    button.type = 'button';
    button.onclick = () => {
      if (selected.size > 1) window.location.assign(magazineArtworkUrl(format, [...selected.keys()]));
    };
    return button;
  });
  selectionActions.append(clearSelection, ...artworkButtons);
  const selectedItems = node('div', undefined, 'magazine-selected-items');
  selectionBar.append(selectionInfo, selectionActions, selectedItems);
  grid.before(selectionBar);

  function syncSelection() {
    selectionCount.textContent = `${selected.size} de ${MAGAZINE_PRODUCT_LIMIT} selecionados`;
    selectionHint.textContent = selected.size < 2 ? 'Selecione de 2 a 5 produtos para criar Encarte ou TV.'
      : selected.size === MAGAZINE_PRODUCT_LIMIT ? 'Seleção completa. Crie sua arte com os preços da revista.'
        : 'Pronto para criar. Você pode selecionar até 5 produtos.';
    clearSelection.disabled = selected.size === 0;
    artworkButtons.forEach(button => { button.disabled = selected.size < 2; });
    selectedItems.hidden = !selected.size;
    selectedItems.replaceChildren(...[...selected].map(([id, item]) => {
      const remove = node('button', `${item.product.nome} ×`, 'magazine-selected-item');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remover ${item.product.nome} da seleção`);
      remove.onclick = () => {
        selected.delete(id);
        syncSelection();
        (selectedItems.querySelector('button') || grid.querySelector('.magazine-product-select input:not(:disabled)'))?.focus();
      };
      return remove;
    }));
    grid.querySelectorAll('.magazine-product-select input').forEach(input => {
      const isSelected = selected.has(Number(input.value));
      input.checked = isSelected;
      input.disabled = input.dataset.unavailable === 'true' || (!isSelected && selected.size >= MAGAZINE_PRODUCT_LIMIT);
      input.closest('.product-card').classList.toggle('is-selected', isSelected);
      input.nextElementSibling.textContent = input.dataset.unavailable === 'true' ? 'Sem imagem' : isSelected ? 'Selecionado' : 'Selecionar';
    });
  }
  function render() {
    const query = search.value.trim().toLocaleLowerCase('pt-BR');
    const filtered = items.filter(({ product: p, ean }) =>
      [p.nome, ean, p.ean, p.fabricante, p.principio_ativo, p.subtitulo]
        .join(' ').toLocaleLowerCase('pt-BR').includes(query));
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize)); page = Math.min(page, pages);
    grid.replaceChildren(...filtered.slice((page - 1) * pageSize, page * pageSize).map(item => {
      const card = renderProductCard(item.product, null, { formats: ['stories', 'feed'] });
      const label = node('label', undefined, 'magazine-product-select');
      const input = node('input'); input.type = 'checkbox'; input.value = String(item.product.id);
      input.dataset.unavailable = String(!item.product.possui_imagem_local || !item.product.imagem_local_url);
      input.setAttribute('aria-label', `Selecionar ${item.product.nome} para Encarte ou TV`);
      input.onchange = () => {
        if (input.checked && selected.size < MAGAZINE_PRODUCT_LIMIT) selected.set(item.product.id, item);
        else selected.delete(item.product.id);
        syncSelection();
      };
      label.append(input, node('span', 'Selecionar'));
      card.querySelector('.product-image').prepend(label);
      card.querySelector('.product-card-actions').before(node('p', `Preço sugerido: ${money(item.preco_sugerido)}`, 'magazine-catalogue-price'));
      return card;
    }));
    syncSelection();
    grid.hidden = !filtered.length;
    results.textContent = filtered.length ? `Mostrando ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, filtered.length)} de ${filtered.length}` : 'Nenhum produto encontrado nesta edição.';
    count.textContent = `${filtered.length} ${filtered.length === 1 ? 'produto' : 'produtos'}`;
    pagers.forEach(({wrapper, previous, next, indicator, bottom}) => { previous.disabled = page <= 1; next.disabled = page >= pages; indicator.textContent = `${page} / ${pages}`; wrapper.hidden = bottom && pages === 1; });
  }
  search.addEventListener('input', () => { page = 1; render(); });
  search.addEventListener('keydown', event => { if (event.key === 'Enter' && mobile.matches) search.blur(); });
  render();
}
