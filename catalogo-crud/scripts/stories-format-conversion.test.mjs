import assert from 'node:assert/strict';
import test from 'node:test';
import { convertArtworkTransforms, findConvertedBackground, otherArtworkFormat } from '../public/js/features/stories/format-conversion.js';
import { getArtworkFormat } from '../public/js/features/stories/formats.js';

test('converts both directions without mutating the source or stretching product proportions', () => {
  const input = { product: { x: 100, y: 500, width: 500 }, text: { x: 200, y: 1100, width: 620 }, secondary: null };
  const before = structuredClone(input);
  for (const source of ['stories', 'feed']) {
    const target = otherArtworkFormat(source);
    const result = convertArtworkTransforms(input, source, target);
    const from = getArtworkFormat(source), to = getArtworkFormat(target);
    const scale = Math.min(to.width / from.width, (to.height - to.safeTop - to.safeBottom) / (from.height - from.safeTop - from.safeBottom));
    assert.equal(result.product.width / input.product.width, scale);
    assert.equal(result.text.width / input.text.width, scale);
    assert.ok(Math.abs((result.text.y - result.product.y) - (input.text.y - input.product.y) * scale) < 1e-9);
    assert.equal(result.secondary, null);
    assert.notEqual(result.product, input.product);
  }
  assert.deepEqual(input, before);
});

test('identity conversion preserves coordinates; invalid dimensions and formats are rejected', () => {
  const input = { product: { x: 160, y: 400, width: 500 } };
  assert.deepEqual(convertArtworkTransforms(input, 'stories', 'stories'), input);
  for (const width of [0, -1, NaN, Infinity]) {
    assert.throws(() => convertArtworkTransforms({ product: { ...input.product, width } }, 'stories', 'feed'));
  }
  assert.throws(() => otherArtworkFormat('indoor'));
  assert.throws(() => convertArtworkTransforms(input, 'stories', 'invalid'));
});

test('matches native campaign backgrounds despite format suffixes, accents and extensions', () => {
  const source = { nome: 'Promoção de Verão', arquivo: 'GABARITO PROMOCAO_DE_VERAO - STORIES.webp' };
  const target = { nome: 'Promocao de Verao', arquivo: 'PROMOCAO_DE_VERAO_FEED.png' };
  const unrelated = { nome: 'Natal', arquivo: 'NATAL_FEED.png' };
  assert.equal(findConvertedBackground(source, [unrelated, target]), target);
  assert.equal(findConvertedBackground({ arquivo: source.arquivo }, [target]), target);
  assert.equal(findConvertedBackground(target, [source]), source);
});

test('missing or ambiguous campaign matches never select a different background', () => {
  assert.equal(findConvertedBackground({ nome: 'Verão' }, [{ nome: 'Natal' }]), null);
  assert.equal(findConvertedBackground({ nome: 'Verão' }, [{ nome: 'Verão' }, { nome: 'Verao' }]), null);
  assert.equal(findConvertedBackground(null, []), null);
  assert.equal(findConvertedBackground({}, [{}]), null);
});
