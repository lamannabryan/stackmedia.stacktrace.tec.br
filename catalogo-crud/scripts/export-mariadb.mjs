import { closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.resolve(root, process.argv[2] || 'data/catalogo.sqlite');
const stamp = new Date().toISOString().replaceAll(':', '-');
const output = path.resolve(root, process.argv[3] || `data/exports/catalogo-mariadb-${stamp}.sql`);
const schema = readFileSync(new URL('./mariadb-schema.sql', import.meta.url), 'utf8');
const definitions = schema.replace(/^--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean);
const tables = definitions.map(s => s.match(/^CREATE TABLE (\w+)/)[1]);
const quote = name => '`' + name.replaceAll('`', '``') + '`';

// Hex UTF-8 avoids dependence on backslash escaping and preserves NUL/newlines.
export function literal(value) {
  if (value === null) return 'NULL';
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string') return `CONVERT(X'${Buffer.from(value, 'utf8').toString('hex')}' USING utf8mb4)`;
  throw new Error('Tipo SQLite inesperado para o esquema de destino.');
}

const database = new DatabaseSync(source, { readOnly: true });
let fd;
try {
  database.exec('BEGIN');
  const integrity = database.prepare('PRAGMA quick_check').all();
  if (integrity.length !== 1 || Object.values(integrity[0])[0] !== 'ok') throw new Error('SQLite falhou na verificação de integridade.');
  if (database.prepare('PRAGMA foreign_key_check').all().length) throw new Error('SQLite contém referências inválidas.');
  const actual = database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name);
  if (JSON.stringify(actual.sort()) !== JSON.stringify([...tables].sort())) throw new Error('As tabelas de origem divergem do esquema MariaDB.');
  mkdirSync(path.dirname(output), { recursive: true });
  fd = openSync(output + '.partial', 'wx');
  const hash = createHash('sha256');
  const write = text => {
    const buffer = Buffer.from(text, 'utf8');
    let offset = 0;
    while (offset < buffer.length) offset += writeSync(fd, buffer, offset);
    hash.update(buffer);
  };
  const summary = { createdAt: new Date().toISOString(), source, output, tables: {}, totalRows: 0 };
  write('-- Dump de DADOS SQLite para o esquema mariadb-schema.sql.\n-- Importar em banco vazio já estruturado; interromper ao primeiro erro, sem --force.\n');
  write("SET NAMES utf8mb4;\nSET @dump_old_sql_mode = @@SESSION.sql_mode;\nSET SESSION sql_mode = 'STRICT_ALL_TABLES,NO_AUTO_VALUE_ON_ZERO';\nSET SESSION foreign_key_checks = 1;\nSTART TRANSACTION;\n");
  for (const [index, table] of tables.entries()) {
    const columns = database.prepare(`PRAGMA table_info(${quote(table)})`).all();
    const destinationColumns = [...definitions[index].matchAll(/^\s+`?(\w+)`? (?:BIGINT|VARCHAR|LONGTEXT)\b/gm)].map(m => m[1]);
    if (JSON.stringify(columns.map(c => c.name)) !== JSON.stringify(destinationColumns)) throw new Error(`Colunas divergentes: ${table}`);
    const bounds = new Map([...definitions[index].matchAll(/^\s+`?(\w+)`? VARCHAR\((\d+)\)/gm)].map(m => [m[1], Number(m[2])]));
    const query = database.prepare(`SELECT * FROM ${quote(table)} ORDER BY ${columns.filter(c => c.pk).sort((a,b) => a.pk-b.pk).map(c => quote(c.name)).join(', ')}`);
    query.setReadBigInts(true);
    let count = 0;
    write(`\n-- ${table}\n`);
    for (const row of query.iterate()) {
      const values = columns.map(column => {
        const value = row[column.name];
        if (value === null && (column.notnull || column.pk)) throw new Error(`NULL incompatível: ${table}.${column.name}`);
        if (value !== null && column.type === 'INTEGER' && typeof value !== 'bigint') throw new Error(`Inteiro incompatível: ${table}.${column.name}`);
        if (value !== null && column.type === 'TEXT' && typeof value !== 'string') throw new Error(`Texto incompatível: ${table}.${column.name}`);
        if (typeof value === 'string' && bounds.has(column.name) && [...value].length > bounds.get(column.name)) throw new Error(`Texto excede limite: ${table}.${column.name}`);
        const encoded = literal(value);
        if (typeof value === 'string') {
          const decoded = Buffer.from(encoded.match(/X'([0-9a-f]*)'/)[1], 'hex').toString('utf8');
          if (decoded !== value) throw new Error(`Falha de codificação: ${table}.${column.name}`);
        }
        return encoded;
      });
      write(`INSERT INTO ${quote(table)} (${columns.map(c => quote(c.name)).join(', ')}) VALUES (${values.join(', ')});\n`);
      count++;
    }
    const expected = database.prepare(`SELECT count(*) AS total FROM ${quote(table)}`).get().total;
    if (count !== expected) throw new Error(`Contagem divergente: ${table}`);
    summary.tables[table] = count;
    summary.totalRows += count;
  }
  write('\nCOMMIT;\nSET SESSION sql_mode = @dump_old_sql_mode;\n');
  database.exec('COMMIT');
  closeSync(fd);
  fd = undefined;
  renameSync(output + '.partial', output);
  summary.sha256 = hash.digest('hex');
  summary.bytes = statSync(output).size;
  writeFileSync(output + '.manifest.json', JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(summary, null, 2));
} finally {
  if (fd !== undefined) closeSync(fd);
  database.close();
}
