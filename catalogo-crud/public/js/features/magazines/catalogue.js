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
  const panel = node('section', undefined, 'filter-panel');
  panel.setAttribute('aria-label', 'Filtros da revista');
  panel.innerHTML = `<div class="filter-panel-heading"><div><p class="eyebrow">Encontre rapidamente</p><h3>Filtre a revista</h3></div><button class="filter-reset-button" type="button">Limpar filtros</button></div>
    <label class="search-field"><span class="search-icon" aria-hidden="true">⌕</span><input type="search" aria-label="Buscar produtos da revista" placeholder="Buscar por nome, EAN, fabricante ou princípio ativo" autocomplete="off" enterkeyhint="search"></label>
    <div class="category-filter-section"><div class="category-filter-heading"><span>Explore por categoria</span><small>Escolha uma categoria para refinar a listagem.</small></div><div class="category-chips" role="group" aria-label="Filtros por categoria"></div></div>
    <details class="catalogue-filter-details"><summary class="catalogue-filter-toggle"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 7h16M4 17h16M8 4v6M16 14v6" stroke-linecap="round" /></svg><span>Filtros <b id="catalogue-filter-count"></b></span><small></small><svg class="catalogue-filter-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6" stroke-linecap="round" stroke-linejoin="round" /></svg></summary><div class="filter-row"></div></details>`;
  document.getElementById('home-magazine-search').parentElement.replaceWith(panel);
  const search = panel.querySelector('input'); search.id = 'home-magazine-search';
  const categories = [...new Set(items.map(item => item.product.categoria_produtos).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'pt-BR'));
  function select(label, values) {
    const field = node('label'), control = node('select');
    values.forEach(([value, text]) => control.append(new Option(text, value)));
    field.append(node('span', label), control); panel.querySelector('.filter-row').append(field);
    return control;
  }
  const category = select('Categoria', [['', 'Todas as categorias'], ...categories.map(value => [value, value])]);
  const status = select('Status', [['', 'Todos'], ['pendente', 'Pendentes'], ['ativo', 'Ativos'], ['inativo', 'Inativos']]);
  const image = select('Imagem', [['', 'Todas'], ['com', 'Com imagem local'], ['sem', 'Sem imagem local']]);
  image.value = 'com';
  const mobile = matchMedia('(max-width: 900px)');
  const layout = () => { panel.querySelector('details').open = !mobile.matches; search.placeholder = mobile.matches ? 'Buscar nome, código ou fabricante' : 'Buscar por nome, EAN, fabricante ou princípio ativo'; };
  mobile.addEventListener('change', layout); layout();
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
    const filtered = items.filter(({ product: p, ean }) => {
      const hasImage = Boolean(p.possui_imagem_local && p.imagem_local_url);
      return [p.nome, ean, p.fabricante, p.principio_ativo, p.subtitulo].join(' ').toLocaleLowerCase('pt-BR').includes(query)
        && (!category.value || p.categoria_produtos === category.value)
        && (!status.value || (p.status || 'ativo') === status.value)
        && (!image.value || (image.value === 'com' ? hasImage : !hasImage));
    });
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
    panel.querySelector('summary small').textContent = [category, status, image].filter(field => field.value).map(field => field.selectedOptions[0].textContent).join(' · ') || 'Todos os produtos';
    const filterCount = panel.querySelector('#catalogue-filter-count');
    filterCount.textContent = String([category, status, image].filter(field => field.value).length);
    filterCount.hidden = filterCount.textContent === '0';
    panel.querySelector('.category-chips').replaceChildren(...['', ...categories].map(value => {
      const chip = node('button', value || 'Todas', `category-chip${category.value === value ? ' is-active' : ''}`);
      chip.type = 'button'; chip.setAttribute('aria-pressed', String(category.value === value));
      if (value) chip.append(node('small', String(items.filter(item => item.product.categoria_produtos === value).length)));
      chip.onclick = () => { category.value = value; page = 1; render(); }; return chip;
    }));
  }
  search.addEventListener('input', () => { page = 1; render(); });
  search.addEventListener('keydown', event => { if (event.key === 'Enter' && mobile.matches) search.blur(); });
  [category, status, image].forEach(field => field.addEventListener('change', () => { page = 1; render(); }));
  panel.querySelector('.filter-reset-button').onclick = () => { search.value = ''; category.value = ''; status.value = ''; image.value = 'com'; page = 1; render(); };
  render();
}
