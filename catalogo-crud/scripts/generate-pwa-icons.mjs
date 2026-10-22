import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const publicDirectory = new URL('../public/', import.meta.url);
const source = new URL('branding/stackmedia-icon.svg', publicDirectory);
const icons = new URL('pwa-icons/', publicDirectory);
await mkdir(icons, { recursive: true });
for (const [name, size] of [
  ['icon-192.png', 192], ['icon-512.png', 512],
  ['icon-maskable-512.png', 512], ['apple-touch-icon.png', 180],
]) {
  await sharp(fileURLToPath(source)).resize(size, size).png()
    .toFile(fileURLToPath(new URL(name, icons)));
}
for (const name of ['apple-touch-icon.png', 'apple-touch-icon-precomposed.png']) {
  await copyFile(new URL('apple-touch-icon.png', icons), new URL(name, publicDirectory));
}
console.log('Ícones _stackmedia atualizados em public/.');
