function createElement(tagName, className, textContent) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (textContent !== undefined && textContent !== null) element.textContent = textContent;
  return element;
}

function attachImage(container, product) {
  const frame = createElement('div', 'product-image-frame');
  if (!product.possui_imagem_local || !product.imagem_local_url) {
    frame.append(createElement('div', 'image-placeholder', '⌁'));
    container.append(frame);
    return;
  }

  const image = new Image();
  image.alt = product.nome || 'Imagem do produto';
  image.loading = 'lazy';
  image.decoding = 'async';
  image.src = product.imagem_local_url;
  image.addEventListener('error', () => {
    image.remove();
    if (!frame.childElementCount) frame.append(createElement('div', 'image-placeholder', '⌁'));
  });
  frame.append(image);
  container.append(frame);
}

export function renderProductCard(product, openProduct) {
  const card = createElement('article', 'product-card');
  card.dataset.productId = product.id;

  const image = createElement('div', 'product-image');
  attachImage(image, product);

  const content = createElement('div', 'product-card-content');
  const meta = createElement('div', 'product-card-meta');
  const status = product.status || 'ativo';
  const category = createElement(
    'span',
    `badge ${status === 'inativo' ? 'inactive' : status === 'pendente' ? 'pending' : ''}`,
    status === 'pendente' ? 'Pendente' : product.categoria_produtos || (status === 'inativo' ? 'Inativo' : 'Sem categoria'),
  );
  meta.append(category);
  if (product.produto_destaque) {
    const featured = createElement('span', 'favorite-dot');
    featured.title = 'Produto em destaque';
    featured.setAttribute('aria-label', 'Produto em destaque');
    meta.append(featured);
  }

  const title = createElement('h4', null, product.nome || 'Produto sem nome');
  const subtitle = createElement('p', 'product-subtitle', product.subtitulo || product.fabricante || 'Sem subtítulo');
  const footer = createElement('div', 'product-footer');
  footer.append(createElement('span', null, product.ean ? `EAN ${product.ean}` : `ID ${product.id}`));
  footer.append(createElement('span', null, product.fabricante || product.grupo || 'Sem fabricante'));

  const actions = createElement('div', 'product-card-actions');
  const openButton = createElement('button', 'product-open-button', 'Detalhes');
  openButton.type = 'button';
  openButton.setAttribute('aria-label', `Ver detalhes de ${product.nome}`);
  openButton.addEventListener('click', () => openProduct(product.id));

  const storyLink = createElement('a', 'product-story-action', 'Story');
  storyLink.href = `/artes/stories?productId=${encodeURIComponent(String(product.id))}`;
  storyLink.setAttribute('aria-label', `Criar Story para ${product.nome}`);
  storyLink.append(createElement('span', 'product-story-action-icon', '→'));
  const feedLink = createElement('a', 'product-story-action', 'Feed');
  feedLink.href = `/artes/feed?productId=${encodeURIComponent(String(product.id))}`;
  feedLink.setAttribute('aria-label', `Criar Feed para ${product.nome}`);
  feedLink.append(createElement('span', 'product-story-action-icon', '→'));
  const encarteLink = createElement('a', 'product-story-action', 'Encarte');
  encarteLink.href = '/artes/encarte?productId=' + encodeURIComponent(String(product.id));
  encarteLink.setAttribute('aria-label', 'Criar Encarte para ' + product.nome);
  encarteLink.append(createElement('span', 'product-story-action-icon', '→'));
  actions.append(openButton, storyLink, feedLink, encarteLink);

  content.append(meta, title, subtitle, footer, actions);
  card.append(image, content);
  return card;
}

