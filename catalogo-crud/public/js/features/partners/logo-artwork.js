// Trim transparent margins for presentation. CSS controls monochrome rendering;
// the original upload and the cropped pixels retain their original colors.
const cache = new Map();
export function logoArtwork(url) {
  if (cache.has(url)) return cache.get(url);
  const result = (async () => {
    const image = new Image(); image.src = url;
    let timeout;
    try {
      await Promise.race([image.decode(), new Promise((_, reject) => {
        timeout = setTimeout(() => { image.src = ''; reject(new Error('Logo timeout')); }, 15000);
      })]);
    } finally { clearTimeout(timeout); }
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1200 / image.naturalWidth, 800 / image.naturalHeight);
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let left = canvas.width, top = canvas.height, right = -1, bottom = -1;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      if (data[i + 3] < 16) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    if (right < left) return { src: url };
    const crop = document.createElement('canvas');
    crop.width = right - left + 1; crop.height = bottom - top + 1;
    crop.getContext('2d').drawImage(canvas, left, top, crop.width, crop.height, 0, 0, crop.width, crop.height);
    const src = crop.toDataURL('image/png');
    const prepared = new Image(); prepared.src = src; await prepared.decode();
    return { src };
  })().catch(() => ({ src: '', failed: true }));
  cache.set(url, result);
  return result;
}
