export const DEFAULT_THEME_COLOR = '#0e746c';

/** Group nearby colors so image compression and gradients do not split the theme. */
export function dominantThemeColor(pixels) {
  const colors = new Map();
  for (let index = 0; index < pixels.length; index += 4) {
    const [red, green, blue, alpha] = pixels.subarray(index, index + 4);
    if (alpha < 200) continue;
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    const saturation = maximum ? (maximum - minimum) / maximum : 0;
    // Ignore white space and near-black printed text when finding the campaign ink.
    if (maximum < 28 || minimum > 235) continue;
    const key = [red, green, blue].map(value => Math.floor(value / 32)).join(',');
    const weight = 1 + saturation * 2;
    const bucket = colors.get(key) || { weight: 0, rgb: [0, 0, 0] };
    bucket.weight += weight;
    [red, green, blue].forEach((value, channel) => { bucket.rgb[channel] += value * weight; });
    colors.set(key, bucket);
  }
  const dominant = [...colors.values()].sort((a, b) => b.weight - a.weight)[0];
  return dominant ? `#${dominant.rgb.map(value => Math.round(value / dominant.weight).toString(16).padStart(2, '0')).join('')}`
    : DEFAULT_THEME_COLOR;
}

/** Sample only while preparing a snapshot, never inside the animation loop. */
export function sampleThemeColor(image, createCanvas = () => document.createElement('canvas')) {
  try {
    const canvas = createCanvas();
    canvas.width = 96;
    canvas.height = 54;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const scale = Math.max(canvas.width / width, canvas.height / height);
    context.drawImage(image, (canvas.width - width * scale) / 2, (canvas.height - height * scale) / 2, width * scale, height * scale);
    return dominantThemeColor(context.getImageData(0, 0, canvas.width, canvas.height).data);
  } catch {
    // Unreadable/cross-origin pixels must not prevent playback or MP4 export.
    return DEFAULT_THEME_COLOR;
  }
}
