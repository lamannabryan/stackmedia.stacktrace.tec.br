import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseEnv } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mariadb from 'mariadb';

const root = fileURLToPath(new URL('../', import.meta.url));
if (!process.argv[2]) throw new Error('Informe o caminho do dump SQL.');
const file = path.resolve(root, process.argv[2]);
const content = await readFile(file);
const manifest = JSON.parse(await readFile(file + '.manifest.json', 'utf8'));
if (createHash('sha256').update(content).digest('hex') !== manifest.sha256 || content.length !== manifest.bytes) {
  throw new Error('Dump não corresponde ao manifesto.');
}
const quote = name => '`' + name.replaceAll('`', '``') + '`';
const data = new Map(Object.keys(manifest.tables).map(table => [table, { columns: [], rows: [], values: [] }]));
for (const line of content.toString('utf8').split('\n')) {
  if (!line.startsWith('INSERT ')) continue;
  const match = line.match(/^INSERT INTO `(\w+)` \(([^)]+)\) VALUES \((.*)\);$/);
  if (!match || !data.has(match[1])) throw new Error('INSERT inesperado.');
  const [, table, columns, values] = match;
  const entry = data.get(table);
  const names = columns.split(', ').map(c => c.replaceAll('`', ''));
  if (entry.columns.length && JSON.stringify(entry.columns) !== JSON.stringify(names)) throw new Error('Colunas inconsistentes.');
  entry.columns = names;
  entry.values.push(values);
  entry.rows.push(values.split(', ').map(value => {
    if (value === 'NULL') return null;
    if (/^-?\d+$/.test(value)) return value;
    const text = value.match(/^CONVERT\(X'([0-9a-f]*)' USING utf8mb4\)$/);
    if (!text) throw new Error('Valor não reconhecido no dump.');
    return Buffer.from(text[1], 'hex').toString('utf8');
  }));
}
for (const [table, entry] of data) {
  if (entry.rows.length !== manifest.tables[table]) throw new Error(`Contagem incorreta no dump: ${table}`);
}
const env = parseEnv(await readFile(new URL('../.env.example', import.meta.url), 'utf8'));
let connection;
let committed = false;
try {
  connection = await mariadb.createConnection({
    host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER,
    password: env.DB_PASSWORD, database: env.DB_NAME,
    charset: 'utf8mb4', connectTimeout: 15000, socketTimeout: 60000,
  });
  const metadata = await connection.query('SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
  for (const [table, entry] of data) {
    if (!metadata.some(t => t.name === table && t.engine === 'InnoDB')) throw new Error(`Tabela InnoDB ausente: ${table}`);
    const columns = await connection.query(`SHOW COLUMNS FROM ${quote(table)}`);
    if (entry.columns.length && JSON.stringify(columns.map(c => c.Field)) !== JSON.stringify(entry.columns)) throw new Error(`Colunas divergentes: ${table}`);
    const [count] = await connection.query(`SELECT COUNT(*) AS total FROM ${quote(table)}`);
    if (Number(count.total) !== 0) throw new Error(`Destino não está vazio: ${table}. Importação cancelada.`);
  }
  await connection.query("SET SESSION sql_mode = 'STRICT_ALL_TABLES,NO_AUTO_VALUE_ON_ZERO'");
  await connection.query('SET SESSION foreign_key_checks = 1');
  await connection.beginTransaction();
  for (const [table, entry] of data) {
    for (let offset = 0; offset < entry.values.length; offset += 100) {
      const values = entry.values.slice(offset, offset + 100).map(value => `(${value})`).join(',\n');
      const result = await connection.query(`INSERT INTO ${quote(table)} (${entry.columns.map(quote).join(', ')}) VALUES ${values}`);
      if (result.warningStatus) throw new Error(`Aviso durante inserção em ${table}; transação será revertida.`);
    }
    console.log(`${table}: ${entry.rows.length} registros inseridos na transação`);
  }
  // Compare every field, not only counts, before committing the transaction.
  for (const [table, entry] of data) {
    const rows = await connection.query(`SELECT * FROM ${quote(table)}`);
    const actual = rows.map(row => JSON.stringify(entry.columns.map(column => row[column] === null ? null : String(row[column])))).sort();
    const expected = entry.rows.map(row => JSON.stringify(row)).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Dados divergentes: ${table}`);
  }
  await connection.commit();
  committed = true;
  const counts = {};
  for (const table of data.keys()) {
    const [row] = await connection.query(`SELECT COUNT(*) AS total FROM ${quote(table)}`);
    counts[table] = Number(row.total);
    if (counts[table] !== manifest.tables[table]) throw new Error(`Contagem pós-commit divergente: ${table}`);
  }
  const receipt = { importedAt: new Date().toISOString(), database: env.DB_NAME, dumpSha256: manifest.sha256, tables: counts, totalRows: manifest.totalRows, validation: 'Todos os campos comparados antes do COMMIT; contagens conferidas após COMMIT.' };
  await writeFile(file + '.import-result.json', JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt, null, 2));
} catch (error) {
  if (connection && !committed) await connection.rollback().catch(() => {});
  console.error(committed ? 'COMMIT efetuado; falha na verificação ou recibo posterior.' : 'Importação não confirmada; rollback solicitado.');
  console.error(error.code ? `Erro: ${error.code}` : error.message);
  process.exitCode = 1;
} finally {
  if (connection) await connection.end();
}
