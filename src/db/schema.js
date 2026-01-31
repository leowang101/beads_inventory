"use strict";

const { dbEnabled, getPool, safeQuery } = require("./pool");
const { PALETTE_ALL } = require("../utils/palette");

async function ensureSchema() {
  if (!dbEnabled()) {
    console.warn("[WARN] DB_* 环境变量未配置完整，后端将只提供访客模式所需的 public 接口。");
    return;
  }
  const pool = getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      username VARCHAR(64) NOT NULL UNIQUE,
      password_salt VARCHAR(64) NOT NULL,
      password_hash VARCHAR(128) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token VARCHAR(64) PRIMARY KEY,
      user_id BIGINT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMP NULL,
      INDEX idx_user_id(user_id),
      CONSTRAINT fk_sessions_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // 兼容老版本：sessions.expires_at 可能是 NOT NULL 且无默认值，做一次 schema 修正
  try {
    await safeQuery("ALTER TABLE sessions MODIFY expires_at TIMESTAMP NULL");
  } catch (e) {
    // 忽略：可能无权限或已是目标 schema
  }


  await pool.query(`
    CREATE TABLE IF NOT EXISTS palette (
      code VARCHAR(16) PRIMARY KEY,
      hex VARCHAR(16) NOT NULL DEFAULT '#CCCCCC',
      series VARCHAR(64) NOT NULL DEFAULT '',
      is_default TINYINT(1) NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // 兼容老版本：palette 可能只有 code/hex，补齐 series / is_default
  try { await safeQuery("ALTER TABLE palette ADD COLUMN series VARCHAR(64) NOT NULL DEFAULT ''"); } catch (e) {}
  try { await safeQuery("ALTER TABLE palette ADD COLUMN is_default TINYINT(1) NOT NULL DEFAULT 0"); } catch (e) {}

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_inventory (
      user_id BIGINT NOT NULL,
      code VARCHAR(16) NOT NULL,
      qty INT NOT NULL DEFAULT 0,
      hex VARCHAR(16) NOT NULL DEFAULT '#CCCCCC',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, code),
      CONSTRAINT fk_inv_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id BIGINT NOT NULL,
      skey VARCHAR(64) NOT NULL,
      svalue VARCHAR(256) NOT NULL,
      PRIMARY KEY(user_id, skey),
      CONSTRAINT fk_settings_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_pattern_categories (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      user_id BIGINT NOT NULL,
      name VARCHAR(32) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_user_category(user_id, name),
      INDEX idx_user_category_user(user_id),
      CONSTRAINT fk_pattern_category_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_removed_codes (
      user_id BIGINT NOT NULL,
      code VARCHAR(16) NOT NULL,
      removed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, code),
      CONSTRAINT fk_removed_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_history (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      user_id BIGINT NOT NULL,
      code VARCHAR(16) NOT NULL,
      htype VARCHAR(16) NOT NULL,
      qty INT NOT NULL,
      pattern VARCHAR(64) NULL,
      pattern_url VARCHAR(512) NULL,
      pattern_key VARCHAR(512) NULL,
      pattern_category_id BIGINT NULL,
      source VARCHAR(32) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user_code_time(user_id, code, created_at),
      CONSTRAINT fk_history_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_todo_patterns (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      user_id BIGINT NOT NULL,
      pattern VARCHAR(64) NULL,
      pattern_url VARCHAR(512) NOT NULL,
      pattern_key VARCHAR(512) NULL,
      pattern_category_id BIGINT NULL,
      items_json MEDIUMTEXT NOT NULL,
      total_qty INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_todo_user_time(user_id, created_at),
      INDEX idx_todo_user_category(user_id, pattern_category_id),
      CONSTRAINT fk_todo_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_todo_pattern_category FOREIGN KEY(pattern_category_id) REFERENCES user_pattern_categories(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_works (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      user_id BIGINT NOT NULL,
      record_gid VARCHAR(96) NOT NULL,
      record_type VARCHAR(16) NOT NULL DEFAULT 'consume',
      image_url VARCHAR(512) NOT NULL,
      image_key VARCHAR(512) NULL,
      duration VARCHAR(32) NULL,
      duration_minutes INT NULL,
      note VARCHAR(256) NULL,
      finished_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_user_record(user_id, record_gid),
      INDEX idx_works_user(user_id),
      CONSTRAINT fk_works_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // 兼容老版本：补齐字段/索引（best-effort）
  try { await safeQuery("ALTER TABLE user_works ADD COLUMN record_type VARCHAR(16) NOT NULL DEFAULT 'consume'"); } catch (e) {}
  try { await safeQuery("ALTER TABLE user_works ADD COLUMN image_url VARCHAR(512) NOT NULL"); } catch (e) {}
  try { await safeQuery("ALTER TABLE user_works ADD COLUMN image_key VARCHAR(512) NULL"); } catch (e) {}
  try { await safeQuery("ALTER TABLE user_works ADD COLUMN duration VARCHAR(32) NULL"); } catch (e) {}
  try { await safeQuery("ALTER TABLE user_works ADD COLUMN duration_minutes INT NULL"); } catch (e) {}
  try { await safeQuery("ALTER TABLE user_works ADD COLUMN note VARCHAR(256) NULL"); } catch (e) {}
  try { await safeQuery("ALTER TABLE user_works ADD COLUMN finished_at DATETIME NULL"); } catch (e) {}
  try { await safeQuery("CREATE UNIQUE INDEX uniq_user_record ON user_works(user_id, record_gid)"); } catch (e) {}


  // best-effort: 兼容旧库，为“拼豆记录”增加 batch_id（把一次操作的多条明细归并）
  try { await pool.query("ALTER TABLE user_history ADD COLUMN batch_id VARCHAR(64) NULL"); } catch (e) {}
  try { await pool.query("CREATE INDEX idx_user_history_user_batch ON user_history(user_id, batch_id)"); } catch (e) {}
  try { await pool.query("ALTER TABLE user_history ADD COLUMN pattern_url VARCHAR(512) NULL"); } catch (e) {}
  try { await pool.query("ALTER TABLE user_history ADD COLUMN pattern_key VARCHAR(512) NULL"); } catch (e) {}
  try { await pool.query("ALTER TABLE user_history ADD COLUMN pattern_category_id BIGINT NULL"); } catch (e) {}
  try { await pool.query("CREATE INDEX idx_history_user_category ON user_history(user_id, pattern_category_id)"); } catch (e) {}
  try { await pool.query("ALTER TABLE user_history ADD CONSTRAINT fk_history_pattern_category FOREIGN KEY(pattern_category_id) REFERENCES user_pattern_categories(id) ON DELETE SET NULL"); } catch (e) {}

  // seed global palette (all codes) - ignore duplicates
  if (PALETTE_ALL.length > 0) {
    const valuesSql = PALETTE_ALL.map(() => "(?, ?, ?, ?)").join(",");
    const params = PALETTE_ALL.flatMap(x => [
      String(x.code).toUpperCase(),
      String(x.hex).toUpperCase(),
      String(x.series || ""),
      x.isDefault ? 1 : 0,
    ]);
    await pool.query(
      "INSERT INTO palette(code, hex, series, is_default) VALUES " + valuesSql +
        " ON DUPLICATE KEY UPDATE hex=VALUES(hex), series=VALUES(series), is_default=VALUES(is_default)",
      params
    );
  }
}

module.exports = {
  ensureSchema,
};
