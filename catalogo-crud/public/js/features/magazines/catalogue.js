import { renderProductCard } from '../catalogue/product-card.js';

export function mountMagazineCatalogue(magazine) {
  const section = document.getElementById('revista-atual');
  const node = (tag, text, className) => {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  };
  const money = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  const items = magazine.items.filter(item => item.product);
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
  const dialog = node('dialog', undefined, 'product-dialog');
  dialog.setAttribute('aria-label', 'Detalhes do produto'); section.append(dialog);
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  function openProduct(id) {
    const item = items.find(item => String(item.product.id) === String(id));
    if (!item) return;
    const product = item.product, header = node('header', undefined, 'dialog-header');
    const close = node('button', '×', 'close-button'); close.type = 'button'; close.setAttribute('aria-label', 'Fechar produto'); close.onclick = () => dialog.close();
    header.append(node('h2', product.nome), close);
    const content = node('div', undefined, 'form-fields'), card = renderProductCard(product, () => {});
    content.append(card.querySelector('.product-image'));
    for (const [label, value] of [['EAN', product.ean], ['Fabricante', product.fabricante], ['Categoria', product.categoria_produtos], ['Princípio ativo', product.principio_ativo], ['Descrição', product.descricao], ['Preço sugerido', money(item.preco_sugerido)]]) {
      if (value) { const line = node('p'); line.append(node('strong', `${label}: `), document.createTextNode(value)); content.append(line); }
    }
    const actions = card.querySelector('.product-card-actions'); actions.querySelector('button').remove(); content.append(actions);
    dialog.replaceChildren(header, content); dialog.showModal(); close.focus();
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
      const card = renderProductCard(item.product, openProduct);
      card.querySelector('.product-card-actions').before(node('p', `Preço sugerido: ${money(item.preco_sugerido)}`, 'magazine-catalogue-price'));
      return card;
    }));
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
