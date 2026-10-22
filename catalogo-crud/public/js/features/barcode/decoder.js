import { isValidEan } from './code.js';

// Loaded only after the user chooses the camera; no CDN or native BarcodeDetector required.
export async function createBarcodeDecoder() {
  await import('../../vendor/zxing-library-0.23.0.js');
  return createCanvasDecoder(globalThis.ZXing);
}

export function createCanvasDecoder(zxing) {
  const hints = new Map([
    [zxing.DecodeHintType.POSSIBLE_FORMATS, [
      zxing.BarcodeFormat.EAN_13, zxing.BarcodeFormat.EAN_8,
      zxing.BarcodeFormat.UPC_A, zxing.BarcodeFormat.ITF, zxing.BarcodeFormat.CODE_128,
    ]],
  ]);
  // Restrict work to retail 1D formats; avoid scanning every image row on each video frame.
  const reader = new zxing.MultiFormatOneDReader(hints);
  function decode(luminance, width, height) {
    try {
      const bitmap = new zxing.BinaryBitmap(new zxing.HybridBinarizer(
        new zxing.RGBLuminanceSource(luminance, width, height),
      ));
      const code = reader.decode(bitmap, hints).getText();
      return isValidEan(code) ? code : null;
    } catch (error) {
      if (error instanceof zxing.NotFoundException || error instanceof zxing.ChecksumException
        || error instanceof zxing.FormatException) return null;
      throw error;
    } finally {
      reader.reset();
    }
  }
  return (canvas) => {
    const { width, height } = canvas;
    const pixels = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data;
    const luminance = new Uint8ClampedArray(width * height);
    for (let i = 0; i < luminance.length; i++) {
      const offset = i * 4;
      luminance[i] = pixels[offset + 3] === 0 ? 255
        : (pixels[offset] + pixels[offset + 1] * 2 + pixels[offset + 2]) >> 2;
    }
    const code = decode(luminance, width, height);
    if (code) return code;
    // Retail barcodes also need to work when the device or package is rotated.
    const rotated = new Uint8ClampedArray(luminance.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) rotated[x * height + height - y - 1] = luminance[y * width + x];
    }
    return decode(rotated, height, width);
  };
}
