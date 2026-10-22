// Synthetic EAN fixtures: encoded bars with quiet zones, no image or camera dependency.
const left = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const parity = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
const invert = (bits) => [...bits].map((bit) => bit === '1' ? '0' : '1').join('');

export function barcodePixels(code, { rotated = false, background = 255, foreground = 0 } = {}) {
  const isEan8 = code.length === 8;
  const half = isEan8 ? 4 : 6;
  const digits = isEan8 ? code : code.slice(1);
  const modes = isEan8 ? 'LLLL' : parity[Number(code[0])];
  const first = [...digits.slice(0, half)].map((digit, i) => (
    modes[i] === 'L' ? left[digit] : [...invert(left[digit])].reverse().join('')
  )).join('');
  const last = [...digits.slice(half)].map((digit) => invert(left[digit])).join('');
  const bars = '101' + first + '01010' + last + '101';
  const width = 640, height = 480, scale = 4;
  const start = Math.floor((width - bars.length * scale) / 2);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const bar = Math.floor((x - start) / scale);
      const color = y >= 150 && y < 330 && bar >= 0 && bar < bars.length && bars[bar] === '1' ? foreground : background;
      const offset = (rotated ? x * height + height - y - 1 : y * width + x) * 4;
      data[offset] = data[offset + 1] = data[offset + 2] = color;
      data[offset + 3] = 255;
    }
  }
  return { width: rotated ? height : width, height: rotated ? width : height, data };
}

export function pixelCanvas(pixels) {
  return { width: pixels.width, height: pixels.height, getContext: () => ({ getImageData: () => ({ data: pixels.data }) }) };
}
