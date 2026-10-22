import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initializeUserSchema } from '../modules/users/user-service.mjs';
import { initializeMagazineSchema } from '../modules/magazines/schema.mjs';

function nowSqlTimestamp() {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

function initializeSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY,
      nome TEXT NOT NULL,
      subtitulo TEXT,
      caracteres TEXT,
      grupo TEXT,
      principio_ativo TEXT,
      ms TEXT,
      fabricante TEXT,
      categoria_id INTEGER,
      categoria_produtos TEXT,
      categoria_nome TEXT,
      frases_encarte TEXT,
      status TEXT NOT NULL DEFAULT 'ativo',
      data_vigencia_inicio TEXT,
      data_vigencia_fim TEXT,
      generico INTEGER NOT NULL DEFAULT 0,
      produto_destaque INTEGER NOT NULL DEFAULT 0,
      ean TEXT,
      direcao_imagem TEXT,
      imagem_arquivo TEXT,
      imagem_status TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_products_nome ON products(nome);
    CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
    CREATE INDEX IF NOT EXISTS idx_products_categoria ON products(categoria_produtos);
    CREATE INDEX IF NOT EXISTS idx_products_ean ON products(ean);

    CREATE TABLE IF NOT EXISTS product_image_credits (
      imagem_arquivo TEXT PRIMARY KEY,
      source_name TEXT NOT NULL,
      source_page TEXT NOT NULL,
      license_url TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS featured_partners (
      slot INTEGER PRIMARY KEY CHECK (slot BETWEEN 1 AND 3),
      fabricante TEXT NOT NULL COLLATE NOCASE UNIQUE,
      logo_file TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const productColumns = database.prepare('PRAGMA table_info(products)').all();
  if (productColumns.some((column) => column.name === 'imagem_url')) {
    database.exec('ALTER TABLE products DROP COLUMN imagem_url');
  }
}

async function importCatalogIfNeeded(database, config) {
  const existing = database.prepare('SELECT COUNT(*) AS count FROM products').get().count;
  if (existing > 0) return;

  if (!existsSync(config.sourceCatalogPath)) {
    throw new Error(`Arquivo de catálogo não encontrado: ${config.sourceCatalogPath}`);
  }
  if (!existsSync(config.sourceManifestPath)) {
    throw new Error(`Manifesto de imagens não encontrado: ${config.sourceManifestPath}`);
  }

  console.log('Importando o catálogo inicial para SQLite...');
  const [catalogContent, manifestContent] = await Promise.all([
    fs.readFile(config.sourceCatalogPath, 'utf8'),
    fs.readFile(config.sourceManifestPath, 'utf8'),
  ]);
  const catalog = JSON.parse(catalogContent);
  const manifest = JSON.parse(manifestContent);

  if (!Array.isArray(catalog.produtos) || !Array.isArray(manifest.produtos)) {
    throw new Error('O catálogo ou o manifesto possui um formato inválido.');
  }

  const imagesByProductId = new Map(
    manifest.produtos.map((entry) => [
      Number(entry.produto_id),
      ['baixado', 'existente'].includes(entry.status)
        ? { arquivo: entry.arquivo, status: entry.status }
        : { arquivo: null, status: entry.status || 'sem_imagem' },
    ]),
  );

  const insert = database.prepare(`
    INSERT INTO products (
      id, nome, subtitulo, caracteres, grupo, principio_ativo, ms, fabricante,
      categoria_id, categoria_produtos, categoria_nome, frases_encarte, status,
      data_vigencia_inicio, data_vigencia_fim, generico, produto_destaque, ean,
      direcao_imagem, imagem_arquivo, imagem_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  database.exec('BEGIN');
  try {
    for (const product of catalog.produtos) {
      const image = imagesByProductId.get(Number(product.id)) || { arquivo: null, status: 'sem_imagem' };
      insert.run(
        Number(product.id),
        product.nome || 'Produto sem nome',
        product.subtitulo ?? null,
        product.caracteres ?? null,
        product.grupo ?? null,
        product.principio_ativo ?? null,
        product.ms ?? null,
        product.fabricante ?? null,
        product.categoria_id ?? null,
        product.categoria_produtos ?? null,
        product.categoria_nome ?? null,
        product.frases_encarte ?? null,
        product.status || 'ativo',
        product.data_vigencia_inicio ?? null,
        product.data_vigencia_fim ?? null,
        product.generico ? 1 : 0,
        product.produto_destaque ? 1 : 0,
        product.ean ?? null,
        product.direcao_imagem ?? null,
        image.arquivo,
        image.status,
        product.created_at || nowSqlTimestamp(),
        product.updated_at || nowSqlTimestamp(),
      );
    }

    database.prepare('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)').run(
      'catalog_imported_at',
      new Date().toISOString(),
    );
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }

  console.log(`${catalog.produtos.length} produtos importados.`);
}

export async function initializeCatalogDatabase(config) {
  await fs.mkdir(path.dirname(config.databasePath), { recursive: true });

  const database = new DatabaseSync(config.databasePath);
  try {
    database.exec('PRAGMA journal_mode = WAL');
    database.exec('PRAGMA busy_timeout = 5000');
    database.exec('PRAGMA foreign_keys = ON');
    initializeSchema(database);
    initializeUserSchema(database);
    initializeMagazineSchema(database);
    await importCatalogIfNeeded(database, config);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
