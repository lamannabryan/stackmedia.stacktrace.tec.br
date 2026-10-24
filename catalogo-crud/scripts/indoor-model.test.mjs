import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRODUCT_LIMIT, addProduct, removeProduct, moveProduct, canContinue,
} from '../public/js/features/indoor/model.js';

function product(id, overrides = {}) {
  return { id, nome: `Produto ${id}`, imagem_local_url: `/images/${id}.png`, ...overrides };
}

function completeSelection() {
  return Array.from({ length: 5 }, (_, index) => ({ product: product(index + 1), price: `${index + 1},90` }));
}

test('magazine price is the editable initial price and adding another item preserves edits', () => {
  const first = addProduct([], product(1, { revista_preco_centavos: 123456 }));
  assert.equal(first[0].price, '1.234,56');
  first[0].price = '9,99';
  const second = addProduct(first, product(2));
  assert.equal(second[0].price, '9,99');
  assert.equal(second[1].price, '');
});

test('selection accepts two to five distinct products with local images', () => {
  assert.equal(PRODUCT_LIMIT, 5);
  let selection = [];
  assert.equal(canContinue(selection), false);
  for (let id = 1; id <= 5; id += 1) {
    selection = addProduct(selection, product(id));
    assert.equal(canContinue(selection), id >= 2);
  }
  const duplicates = completeSelection();
  duplicates[4] = { product: product(1), price: '' };
  assert.equal(canContinue(duplicates), false);
  const missingImage = completeSelection();
  missingImage[2] = { product: product(3, { imagem_local_url: '' }), price: '' };
  assert.equal(canContinue(missingImage), false);
  assert.equal(canContinue([...completeSelection(), { product: product(6), price: '' }]), false);
});

test('adding a sixth product or the same catalogue ID twice preserves the existing selection', () => {
  const original = completeSelection();
  assert.strictEqual(addProduct(original, product(6)), original);
  const partial = original.slice(0, 3);
  const duplicate = product(2, { nome: 'Outro objeto do mesmo produto' });
  assert.strictEqual(addProduct(partial, duplicate), partial);
  assert.deepEqual(partial, original.slice(0, 3));
});

test('products without an ID or local image cannot be selected', () => {
  const selection = completeSelection().slice(0, 1);
  for (const unavailable of [null, undefined, product(null), product(2, { imagem_local_url: '' }), { id: 3 }]) {
    assert.strictEqual(addProduct(selection, unavailable), selection);
  }
  assert.equal(selection.length, 1);
});

test('adding a product keeps existing prices and initializes the new price as optional', () => {
  const original = completeSelection().slice(0, 2);
  const before = structuredClone(original);
  const added = addProduct(original, product(3));
  assert.notStrictEqual(added, original);
  assert.deepEqual(original, before);
  assert.deepEqual(added.map((entry) => entry.price), ['1,90', '2,90', '']);
  const withoutPrices = completeSelection().map((entry) => ({ ...entry, price: '' }));
  assert.equal(canContinue(withoutPrices), true);
});

test('moving products changes the video order while prices stay attached to their products', () => {
  const original = completeSelection();
  const before = structuredClone(original);
  const moved = moveProduct(original, 3, -1);
  assert.deepEqual(moved.map((entry) => entry.product.id), [1, 3, 2, 4, 5]);
  assert.deepEqual(moved.map((entry) => entry.price), ['1,90', '3,90', '2,90', '4,90', '5,90']);
  assert.deepEqual(moveProduct(moved, 3, 1), original);
  assert.deepEqual(original, before);
  assert.equal(canContinue(moved), true);
});

test('moving beyond the ends or requesting an invalid direction preserves every offer', () => {
  const selection = completeSelection();
  for (const [id, direction] of [[1, -1], [5, 1], [999, 1], [3, 0], [3, 2], [3, -2]]) {
    assert.strictEqual(moveProduct(selection, id, direction), selection);
  }
  assert.deepEqual(selection, completeSelection());
});

test('removing a product preserves the remaining prices and requires at least two items', () => {
  const original = completeSelection();
  const removed = removeProduct(original, 3);
  assert.equal(canContinue(removed), true);
  assert.equal(canContinue(removed.slice(0, 1)), false);
  assert.deepEqual(removed.map((entry) => entry.product.id), [1, 2, 4, 5]);
  assert.deepEqual(removed.map((entry) => entry.price), ['1,90', '2,90', '4,90', '5,90']);
  const replacement = addProduct(removed, product(6));
  assert.equal(canContinue(replacement), true);
  assert.deepEqual(replacement.map((entry) => entry.product.id), [1, 2, 4, 5, 6]);
  assert.equal(replacement[4].price, '');
  assert.deepEqual(original, completeSelection());
  assert.deepEqual(removeProduct(original, 999), original);
});
