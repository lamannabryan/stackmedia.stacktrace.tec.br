import { suggestedMagazinePrice } from '../stories/price-input.js';

export const PRODUCT_LIMIT = 5;

export function addProduct(selection, product) {
  if (!product?.id || !product.imagem_local_url || selection.length >= PRODUCT_LIMIT
      || selection.some((item) => item.product.id === product.id)) return selection;
  return [...selection, { product, price: suggestedMagazinePrice(product) }];
}

export function removeProduct(selection, id) {
  return selection.filter((item) => item.product.id !== id);
}

export function moveProduct(selection, id, direction) {
  const index = selection.findIndex((item) => item.product.id === id);
  const target = index + direction;
  if (index < 0 || ![-1, 1].includes(direction) || target < 0 || target >= selection.length) return selection;
  const result = [...selection];
  [result[index], result[target]] = [result[target], result[index]];
  return result;
}

export function canContinue(selection) {
  return selection.length === PRODUCT_LIMIT
    && new Set(selection.map((item) => item.product.id)).size === PRODUCT_LIMIT
    && selection.every((item) => Boolean(item.product.imagem_local_url));
}
