export const MAGAZINE_PRODUCT_LIMIT = 5;

export function selectedProductIds(search, limit = MAGAZINE_PRODUCT_LIMIT) {
  const params = new URLSearchParams(search);
  const values = (params.get('productIds') ?? params.get('productId') ?? '').split(',');
  return [...new Set(values.filter(value => /^[1-9]\d*$/.test(value))
    .map(Number).filter(Number.isSafeInteger))].slice(0, limit);
}

export function magazineArtworkUrl(format, ids) {
  const path = format === 'tv' ? 'indoor-h' : 'encarte';
  const params = new URLSearchParams({ productIds: ids.slice(0, MAGAZINE_PRODUCT_LIMIT).join(',') });
  return `/artes/${path}?${params}`;
}

export async function loadSelectedProducts(ids, requestJson) {
  return Promise.all(ids.map(async id => {
    const product = await requestJson(`/api/products/${id}`);
    if (product?.id !== id) throw new Error('Não foi possível carregar um dos produtos selecionados.');
    return product;
  }));
}
