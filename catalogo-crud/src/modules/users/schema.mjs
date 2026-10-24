const userTable = (name) => `CREATE TABLE ${name} (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('superadministrador', 'administrador', 'cliente')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  access_expires_at TEXT,
  artwork_limit INTEGER CHECK (artwork_limit IS NULL OR (typeof(artwork_limit) = 'integer' AND artwork_limit >= 0)),
  artwork_limit_period TEXT NOT NULL DEFAULT 'total' CHECK (artwork_limit_period IN ('monthly', 'total'))
)`;

export function initializeUserSchema(database) {
  // SQLite cannot alter the old role CHECK. Rebuild atomically while retaining
  // IDs, password hashes, sessions, indexes and triggers; never promote accounts.
  const foreignKeys = database.prepare('PRAGMA foreign_keys').get().foreign_keys;
  database.exec('PRAGMA foreign_keys = OFF');
  let transaction = false;
  try {
    database.exec('BEGIN IMMEDIATE');
    transaction = true;
    const existing = database.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'users'").get();
    if (!existing) {
      database.exec(userTable('users'));
    } else if (!existing.sql.includes("'superadministrador'")) {
      const dependentSql = database.prepare("SELECT sql FROM sqlite_schema WHERE tbl_name = 'users' AND type IN ('index', 'trigger') AND sql IS NOT NULL").all();
      database.exec(userTable('users_commercial_migration'));
      database.exec(`INSERT INTO users_commercial_migration (id, name, email, password_hash, role, active, created_at, updated_at)
        SELECT id, name, email, password_hash, role, active, created_at, updated_at FROM users;
        DROP TABLE users;
        ALTER TABLE users_commercial_migration RENAME TO users;`);
      for (const { sql } of dependentSql) database.exec(sql);
    }
    database.exec(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        csrf_token TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_expiry ON user_sessions(expires_at);
      CREATE TABLE IF NOT EXISTS login_attempts (
        key TEXT PRIMARY KEY,
        attempts INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS artwork_generations (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        idempotency_key TEXT NOT NULL,
        format TEXT NOT NULL CHECK (format IN ('stories', 'feed', 'encarte', 'indoor-h')),
        output TEXT NOT NULL CHECK (output IN ('png', 'mp4')),
        period_month TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (user_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS idx_artwork_generations_user_month ON artwork_generations(user_id, period_month);
    `);
    if (database.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Migração de usuários contém referências inválidas.');
    database.exec('COMMIT');
  } catch (error) {
    if (transaction) database.exec('ROLLBACK');
    throw error;
  } finally {
    database.exec(`PRAGMA foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
  }
}
