import { readFileSync, writeFileSync } from 'node:fs';
// Run from catalogo-crud after updating catalogue styles to refresh this scoped copy.
const sheets = ['styles.css', 'catalogue.css', 'catalogue-mobile.css'];
const css = sheets.map(file => readFileSync(`public/${file}`, 'utf8').replaceAll(':root', ':scope').replaceAll('.catalogue-page', ':scope')).join('\n');
writeFileSync('public/magazine-catalogue.css', '/* Scoped copy of catalogue styles; isolated from the home header and hero. */\n@scope (.home-magazine) {\n' + css + '\n}\n');
