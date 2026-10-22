export function initializeMagazineSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS magazines (
      id INTEGER PRIMARY KEY,
      month TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS magazine_items (
      magazine_id INTEGER NOT NULL REFERENCES magazines(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
      ean TEXT NOT NULL,
      price_cents INTEGER NOT NULL CHECK(price_cents > 0 AND price_cents <= 99999999),
      position INTEGER NOT NULL,
      PRIMARY KEY (magazine_id, ean)
    );
    CREATE INDEX IF NOT EXISTS idx_magazine_items_product ON magazine_items(product_id);
  `);
}
