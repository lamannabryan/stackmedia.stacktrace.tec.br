import { parentPort, workerData } from 'node:worker_threads';
import MagicWand from 'magic-wand-tool';

const { data, width, height } = workerData;

function removeBackground() {
  // Already transparent cutouts may contain an opaque white product. Preserve
  // their existing matte instead of treating that product as white background.
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return data;

  const paddedWidth = width + 2, paddedHeight = height + 2;
  const colors = new Uint8Array(paddedWidth * paddedHeight * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 4;
      const r = data[source], g = data[source + 1], b = data[source + 2];
      const min = Math.min(r, g, b), max = Math.max(r, g, b);
      // Keep the tolerance narrow: pale gray outlines separate white bottles
      // from the background. Wider thresholds can flood into the product.
      const white = min >= 250 && max - min <= 5;
      if (!white) {
        const target = ((y + 1) * paddedWidth + x + 1) * 3;
        colors[target] = colors[target + 1] = colors[target + 2] = 255;
      }
    }
  }
  // A one-pixel frame connects every image edge, including separate areas when
  // the product touches an edge. Enclosed white labels remain unselected.
  const mask = MagicWand.floodFill({ data: colors, width: paddedWidth, height: paddedHeight, bytes: 3 }, 0, 0, 0);
  let foreground = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask.data[(y + 1) * paddedWidth + x + 1]) data[(y * width + x) * 4 + 3] = 0;
      else foreground++;
    }
  }
  return foreground ? data : null;
}

const result = removeBackground();
if (result) parentPort.postMessage({ type: 'product:white-background', data: result }, [result.buffer]);
else parentPort.postMessage({ type: 'product:white-background', error: 'empty' });
