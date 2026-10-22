import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roots = [
  'server.mjs',
  'src',
  'public/app.js',
  'public/home.js',
  'public/stories.js',
  'public/sw.js',
  'public/js',
  'scripts',
];

async function collectJavaScriptFiles(target) {
  const absoluteTarget = path.join(projectDirectory, target);
  if (path.extname(absoluteTarget)) return [absoluteTarget];

  const entries = await readdir(absoluteTarget, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const relativePath = path.join(target, entry.name);
    if (entry.isDirectory()) return collectJavaScriptFiles(relativePath);
    return /\.(?:m?js)$/.test(entry.name) ? [path.join(projectDirectory, relativePath)] : [];
  }));
  return nested.flat();
}

const files = [...new Set((await Promise.all(roots.map(collectJavaScriptFiles))).flat())]
  .sort((first, second) => first.localeCompare(second));

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status === 0) continue;
  process.stderr.write(result.stderr || result.stdout || `Falha ao verificar ${file}\n`);
  process.exitCode = 1;
  break;
}

if (!process.exitCode) {
  console.log(`Sintaxe validada em ${files.length} arquivos JavaScript.`);
}
