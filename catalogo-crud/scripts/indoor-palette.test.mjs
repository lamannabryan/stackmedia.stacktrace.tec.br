import assert from 'node:assert/strict';
import test from 'node:test';
import { dominantThemeColor, sampleThemeColor, DEFAULT_THEME_COLOR } from '../public/js/features/indoor/palette.js';

const pixels = (...colors) => new Uint8ClampedArray(colors.flat());

test('theme color ignores blank space, transparent pixels and near-black printed text', () => {
  const color = dominantThemeColor(pixels(
    ...Array(20).fill([255, 255, 255, 255]),
    ...Array(20).fill([0, 0, 0, 255]),
    ...Array(20).fill([0, 255, 0, 0]),
    [220, 36, 90, 255], [220, 36, 90, 255], [30, 90, 220, 255],
  ));
  assert.equal(color, '#dc245a');
});

test('nearby shades count together; muted campaigns retain their own palette', () => {
  assert.equal(dominantThemeColor(pixels([220, 36, 90, 255], [218, 38, 92, 255], [30, 90, 220, 255])), '#db255b');
  assert.equal(dominantThemeColor(pixels([120, 120, 120, 255])), '#787878');
  assert.equal(dominantThemeColor(pixels()), DEFAULT_THEME_COLOR);
  assert.equal(dominantThemeColor(pixels([255, 255, 255, 255])), DEFAULT_THEME_COLOR);
});

test('sampling matches cover crop and gracefully handles unreadable images', () => {
  const draws = [];
  const canvas = { getContext: () => ({
    drawImage: (...args) => draws.push(args),
    getImageData: () => ({ data: pixels([32, 96, 160, 255]) }),
  }) };
  const image = { width: 1000, height: 1000 };
  assert.equal(sampleThemeColor(image, () => canvas), '#2060a0');
  assert.deepEqual(draws[0], [image, 0, -21, 96, 96]);
  assert.equal(sampleThemeColor(image, () => { throw new Error('SecurityError'); }), DEFAULT_THEME_COLOR);
});
