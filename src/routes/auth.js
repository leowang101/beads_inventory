"use strict";

const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { sendJson } = require("../utils/respond");
const { dbEnabled, safeQuery, getPool } = require("../db/pool");
const {
  normUsername,
  isValidUsername,
  newSalt,
  hashPassword,
  newToken,
} = require("../utils/helpers");
const { ensureUserDefaults, createSession } = require("../services/user");
const { BUILD_TAG } = require("../utils/constants");
const { withHandler } = require("../utils/observability");

const router = express.Router();

router.get("/api/me", requireAuth, withHandler("me", (req, res) => {
  sendJson(res, 200, { ok: true, username: req.user.username, buildTag: BUILD_TAG });
}));

router.post("/api/register", withHandler("register", async (req, res) => {
  try {
    if (!dbEnabled()) return sendJson(res, 500, { ok: false, message: "服务端数据库未配置，无法注册账号" });

    const username = normUsername(req.body?.username);
    const password = String(req.body?.password || "");
    const confirmPassword = String(req.body?.confirmPassword || req.body?.password2 || "");

    if (!isValidUsername(username)) return sendJson(res, 400, { ok: false, message: "用户名需为 3~32 位（中英文/数字/下划线/短横线）" });
    if (!password || password.length < 6) return sendJson(res, 400, { ok: false, message: "密码至少 6 位" });
    if (password !== confirmPassword) return sendJson(res, 400, { ok: false, message: "两次密码不一致" });

    const [cntRows] = await safeQuery("SELECT COUNT(*) as c FROM users", []);
    const cnt = Number(cntRows?.[0]?.c || 0);
    if (cnt >= 1000) return sendJson(res, 400, { ok: false, message: "账号注册数量达到上限。" });

    const salt = newSalt();
    const pwdHash = hashPassword(password, salt);

    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [r] = await conn.query(
        "INSERT INTO users(username, password_salt, password_hash) VALUES(?,?,?)",
        [username, salt, pwdHash]
      );
      const userId = r.insertId;

      await conn.query(
        `INSERT IGNORE INTO user_settings(user_id, skey, svalue) VALUES
         (?, 'criticalThreshold', '300')`,
        [userId]
      );


      // Seed default 221 colors into this user's cloud inventory (qty=0)
      await conn.query(
        `INSERT IGNORE INTO user_inventory(user_id, code, qty, hex)
         SELECT ?, p.code, 0, p.hex FROM palette p WHERE p.is_default=1`,
        [userId]
      );
      const token = newToken();
      await conn.query("INSERT INTO sessions(token, user_id, expires_at) VALUES(?,?,DATE_ADD(NOW(), INTERVAL 30 DAY))", [token, userId]);

      await conn.commit();
      sendJson(res, 200, { ok: true, token, username, buildTag: BUILD_TAG });
    } catch (e) {
      await conn.rollback();
      sendJson(res, 400, { ok: false, message: e.message });
    } finally {
      conn.release();
    }
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
}));

router.post("/api/login", withHandler("login", async (req, res) => {
  try {
    if (!dbEnabled()) return sendJson(res, 500, { ok: false, message: "服务端数据库未配置，无法登录" });
    const username = normUsername(req.body?.username);
    const password = String(req.body?.password || "");
    if (!username || !password) return sendJson(res, 400, { ok: false, message: "missing username/password" });

    const [rows] = await safeQuery(
      "SELECT id, username, password_salt, password_hash FROM users WHERE username=? LIMIT 1",
      [username]
    );
    if (!rows || rows.length === 0) return sendJson(res, 400, { ok: false, message: "用户名或密码错误" });

    const u = rows[0];
    const calc = hashPassword(password, u.password_salt);
    if (calc !== u.password_hash) return sendJson(res, 400, { ok: false, message: "用户名或密码错误" });

    await ensureUserDefaults(u.id);

    const token = await createSession(u.id);
    sendJson(res, 200, { ok: true, token, username: u.username, buildTag: BUILD_TAG });
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
}));

router.post("/api/logout", requireAuth, withHandler("logout", async (req, res) => {
  try {
    const auth = String(req.headers.authorization || "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : auth.trim();
    if (token) await safeQuery("DELETE FROM sessions WHERE token=?", [token]);
    sendJson(res, 200, { ok: true });
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
}));

module.exports = router;
