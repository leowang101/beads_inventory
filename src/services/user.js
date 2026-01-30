"use strict";

const { safeQuery } = require("../db/pool");
const { newToken } = require("../utils/helpers");

async function createSession(userId) {
  const token = newToken();
  // 默认 30 天有效期（与 MySQL 老表 schema 兼容，避免 expires_at 无默认值报错）
  await safeQuery(
    "INSERT INTO sessions(token, user_id, expires_at) VALUES(?,?, DATE_ADD(NOW(), INTERVAL 30 DAY))",
    [token, userId]
  );
  return token;
}

async function ensureUserDefaults(userId) {
  // seed inventory 221 with qty=0
  await safeQuery(
    `INSERT IGNORE INTO user_inventory(user_id, code, qty, hex)
     SELECT ?, p.code, 0, p.hex
     FROM palette p
     LEFT JOIN user_removed_codes r ON r.user_id=? AND r.code=p.code
     WHERE p.is_default=1 AND r.code IS NULL`,
    [userId, userId]
  );
  await safeQuery(
    `INSERT IGNORE INTO user_settings(user_id, skey, svalue) VALUES
     (?, 'criticalThreshold', '300')`,
    [userId]
  );
}

module.exports = {
  createSession,
  ensureUserDefaults,
};
