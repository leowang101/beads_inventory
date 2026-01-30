"use strict";

const { sendJson } = require("../utils/respond");
const { safeQuery } = require("../db/pool");

async function getUserByToken(token) {
  const [rows] = await safeQuery(
    "SELECT s.user_id as id, u.username as username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND (s.expires_at IS NULL OR s.expires_at > NOW()) LIMIT 1",
    [token]
  );
  if (!rows || rows.length === 0) return null;
  return { id: rows[0].id, username: rows[0].username };
}

async function requireAuth(req, res, next) {
  try {
    const auth = String(req.headers.authorization || "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : auth.trim();
    if (!token) return sendJson(res, 401, { ok: false, message: "请先登录" });
    const u = await getUserByToken(token);
    if (!u) return sendJson(res, 401, { ok: false, message: "登录已失效，请重新登录" });
    req.user = u;
    next();
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
}

module.exports = {
  requireAuth,
};
