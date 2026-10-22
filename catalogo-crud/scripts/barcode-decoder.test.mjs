import assert from 'node:assert/strict';
import test from 'node:test';
import { createBarcodeDecoder } from '../public/js/features/barcode/decoder.js';
import { isValidEan } from '../public/js/features/barcode/code.js';
import { barcodePixels, pixelCanvas } from './fixtures/barcode.mjs';

const decode = await createBarcodeDecoder();

test('the bundled decoder reads EAN-13 and EAN-8 from pixels without BarcodeDetector', () => {
  assert.equal(decode(pixelCanvas(barcodePixels('7894900011517'))), '7894900011517');
  assert.equal(decode(pixelCanvas(barcodePixels('96385074'))), '96385074');
});

test('UPC-A is returned with its original 12 digits', () => {
  assert.equal(decode(pixelCanvas(barcodePixels('0036000291452'))), '036000291452');
});

test('vertical barcodes and lower contrast images can also be decoded', () => {
  assert.equal(decode(pixelCanvas(barcodePixels('7894900011517', { rotated: true }))), '7894900011517');
  assert.equal(decode(pixelCanvas(barcodePixels('7894900011517', { foreground: 60, background: 190 }))), '7894900011517');
});

test('blank images and bad checksums produce no code', () => {
  assert.equal(decode(pixelCanvas(barcodePixels('7894900011517', { foreground: 255 }))), null);
  assert.equal(decode(pixelCanvas(barcodePixels('7894900011518'))), null);
  assert.equal(isValidEan('00000000'), false);
  assert.equal(isValidEan('ABC7894900011517'), false);
});
