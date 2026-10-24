-- Estrutura de destino para as tabelas de data/catalogo.sqlite.
-- Datas permanecem texto para preservar formatos e valores do SQLite.
-- Execute no banco selecionado pela conexão, sem DROP ou substituição de dados.
CREATE TABLE app_meta (
  `key` VARCHAR(768) NOT NULL PRIMARY KEY,
  value LONGTEXT NOT NULL
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE products (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  nome LONGTEXT NOT NULL,
  subtitulo LONGTEXT,
  caracteres LONGTEXT,
  grupo LONGTEXT,
  principio_ativo LONGTEXT,
  ms LONGTEXT,
  fabricante LONGTEXT,
  categoria_id BIGINT,
  categoria_produtos LONGTEXT,
  categoria_nome LONGTEXT,
  frases_encarte LONGTEXT,
  status LONGTEXT NOT NULL DEFAULT 'ativo',
  data_vigencia_inicio LONGTEXT,
  data_vigencia_fim LONGTEXT,
  generico BIGINT NOT NULL DEFAULT 0,
  produto_destaque BIGINT NOT NULL DEFAULT 0,
  ean LONGTEXT,
  direcao_imagem LONGTEXT,
  imagem_arquivo LONGTEXT,
  imagem_status LONGTEXT,
  created_at LONGTEXT NOT NULL,
  updated_at LONGTEXT NOT NULL,
  INDEX idx_products_nome (nome(191)),
  INDEX idx_products_status (status(191)),
  INDEX idx_products_categoria (categoria_produtos(191)),
  INDEX idx_products_ean (ean(191))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE product_image_credits (
  imagem_arquivo VARCHAR(768) NOT NULL PRIMARY KEY,
  source_name LONGTEXT NOT NULL,
  source_page LONGTEXT NOT NULL,
  license_url LONGTEXT NOT NULL
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE featured_partners (
  slot BIGINT NOT NULL PRIMARY KEY CHECK (slot BETWEEN 1 AND 3),
  fabricante VARCHAR(768) COLLATE utf8mb4_unicode_ci NOT NULL UNIQUE,
  logo_file LONGTEXT NOT NULL,
  updated_at LONGTEXT NOT NULL
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE users (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name LONGTEXT NOT NULL,
  email VARCHAR(768) COLLATE utf8mb4_unicode_ci NOT NULL UNIQUE,
  password_hash LONGTEXT NOT NULL,
  role VARCHAR(32) NOT NULL CHECK (role IN ('superadministrador', 'administrador', 'cliente')),
  active BIGINT NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at LONGTEXT NOT NULL,
  updated_at LONGTEXT NOT NULL,
  access_expires_at LONGTEXT,
  artwork_limit BIGINT CHECK (artwork_limit IS NULL OR artwork_limit >= 0),
  artwork_limit_period VARCHAR(16) NOT NULL DEFAULT 'total' CHECK (artwork_limit_period IN ('monthly', 'total'))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE user_sessions (
  token_hash VARCHAR(768) NOT NULL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  csrf_token LONGTEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  INDEX idx_user_sessions_user (user_id),
  INDEX idx_user_sessions_expiry (expires_at),
  CONSTRAINT fk_user_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE login_attempts (
  `key` VARCHAR(768) NOT NULL PRIMARY KEY,
  attempts BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE artwork_generations (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  format VARCHAR(16) NOT NULL CHECK (format IN ('stories', 'feed', 'encarte', 'indoor-h')),
  output VARCHAR(8) NOT NULL CHECK (output IN ('png', 'mp4')),
  period_month VARCHAR(7) NOT NULL,
  created_at LONGTEXT NOT NULL,
  UNIQUE KEY idx_artwork_generations_key (user_id, idempotency_key),
  INDEX idx_artwork_generations_user_month (user_id, period_month),
  CONSTRAINT fk_artwork_generations_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE magazines (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  month VARCHAR(768) NOT NULL UNIQUE,
  title LONGTEXT NOT NULL,
  active BIGINT NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  revision BIGINT NOT NULL DEFAULT 1,
  created_at LONGTEXT NOT NULL,
  updated_at LONGTEXT NOT NULL,
  background LONGTEXT
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE magazine_items (
  magazine_id BIGINT NOT NULL,
  product_id BIGINT,
  ean VARCHAR(191) NOT NULL,
  price_cents BIGINT NOT NULL CHECK (price_cents > 0 AND price_cents <= 99999999),
  position BIGINT NOT NULL,
  PRIMARY KEY (magazine_id, ean),
  INDEX idx_magazine_items_product (product_id),
  CONSTRAINT fk_magazine_items_magazine FOREIGN KEY (magazine_id) REFERENCES magazines(id) ON DELETE CASCADE,
  CONSTRAINT fk_magazine_items_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
