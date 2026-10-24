import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import mariadb from 'mariadb';
import { loadConfig } from '../src/config.mjs';

// Read the requested file explicitly: shell variables and .env cannot override it.
const env = parseEnv(await readFile(new URL('../.env.example', import.meta.url), 'utf8'));
for (const key of ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
  if (!env[key]) throw new Error(`Configuração ausente: ${key}`);
}
const quote = name => '`' + name.replaceAll('`', '``') + '`';
const sql = await readFile(new URL('./mariadb-schema.sql', import.meta.url), 'utf8');
const statements = sql.replace(/^--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean);
const expected = statements.map(s => s.match(/^CREATE TABLE (\w+)/)[1]);
const sqlite = new DatabaseSync(loadConfig(env).databasePath, { readOnly: true });
let connection;
try {
  sqlite.exec('BEGIN');
  const actual = sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name);
  if (JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error('As tabelas SQLite mudaram. Atualize mariadb-schema.sql antes de executar.');
  }
  if (sqlite.prepare('PRAGMA foreign_key_check').all().length) {
    throw new Error('SQLite contém referências inválidas; corrija antes de preparar a importação.');
  }
  // Verify bounded fields against current data without logging their contents.
  for (const statement of statements) {
    const table = statement.match(/^CREATE TABLE (\w+)/)[1];
    for (const match of statement.matchAll(/^\s+`?(\w+)`? VARCHAR\((\d+)\)/gm)) {
      const [, column, size] = match;
      const { maximum } = sqlite.prepare(`SELECT MAX(length(${quote(column)})) AS maximum FROM ${quote(table)}`).get();
      if (maximum > Number(size)) throw new Error(`Campo excede o destino: ${table}.${column}`);
    }
  }
  connection = await mariadb.createConnection({
    host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER,
    password: env.DB_PASSWORD, database: env.DB_NAME,
    charset: 'utf8mb4', connectTimeout: 15000, socketTimeout: 30000,
  });
  const [server] = await connection.query('SELECT VERSION() AS version, DATABASE() AS db');
  console.log(JSON.stringify({ server: server.version, database: server.db }));
  if (!server.version.toLowerCase().includes('mariadb')) throw new Error('O destino não é MariaDB.');
  const existing = await connection.query('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
  console.log(JSON.stringify({ existingTables: existing.map(row => row.name), sourceTables: expected }));
  if (!process.argv.includes('--apply') && !process.argv.includes('--verify')) {
    console.log('Inspeção concluída. Use --apply para criar ou --verify para conferir.');
  } else {
    if (process.argv.includes('--apply')) {
      const collisions = existing.filter(row => expected.includes(row.name));
      if (collisions.length) throw new Error('Há tabelas de destino existentes. Nenhuma tabela será substituída. Use --verify para conferir.');
      for (const statement of statements) await connection.query(statement);
    }
    for (const table of expected) {
      const sourceColumns = sqlite.prepare(`PRAGMA table_info(${quote(table)})`).all().map(row => row.name);
      const targetColumns = await connection.query(`SHOW COLUMNS FROM ${quote(table)}`);
      if (JSON.stringify(sourceColumns) !== JSON.stringify(targetColumns.map(row => row.Field))) {
        throw new Error(`Colunas divergentes: ${table}`);
      }
      const [row] = await connection.query(`SELECT COUNT(*) AS total FROM ${quote(table)}`);
      console.log(`${table}: ${targetColumns.length} colunas, ${row.total} registros no destino`);
    }
    const relationships = await connection.query("SELECT CONSTRAINT_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME IN ('user_sessions', 'magazine_items')");
    for (const name of ['fk_user_sessions_user', 'fk_magazine_items_magazine', 'fk_magazine_items_product']) {
      if (!relationships.some(row => row.CONSTRAINT_NAME === name)) throw new Error(`Relacionamento ausente: ${name}`);
    }
    console.log('Estrutura conferida: 9 tabelas e 3 relacionamentos. Dados não importados.');
  }
} catch (error) {
  // Driver errors can contain connection details or SQL; keep output sanitized.
  console.error(error.sqlState || error.code ? `Falha MariaDB: ${error.code ?? error.sqlState}` : error.message);
  process.exitCode = 1;
} finally {
  sqlite.close();
  if (connection) await connection.end();
}
