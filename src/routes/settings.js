"use strict";

const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { sendJson } = require("../utils/respond");
const { safeQuery } = require("../db/pool");
const { BUILD_TAG } = require("../utils/constants");
const { withHandler } = require("../utils/observability");

const router = express.Router();

router.get("/api/settings", requireAuth, withHandler("settingsGet", async (req, res) => {
  try {
    const [rows] = await safeQuery(
      "SELECT skey, svalue FROM user_settings WHERE user_id=?",
      [req.user.id]
    );
    const map = Object.create(null);
    (rows || []).forEach(r => map[r.skey] = r.svalue);
    sendJson(res, 200, {
      ok: true,
      criticalThreshold: Number(map.criticalThreshold ?? 300),
      buildTag: BUILD_TAG
    });
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
}));

router.post("/api/settings", requireAuth, withHandler("settingsUpdate", async (req, res) => {
  try {
    const critical = Number(req.body?.criticalThreshold);
    if (!Number.isInteger(critical) || critical <= 0) return sendJson(res, 400, { ok: false, message: "告急数量必须为正整数" });

    await safeQuery(
      "INSERT INTO user_settings(user_id, skey, svalue) VALUES(?,?,?) ON DUPLICATE KEY UPDATE svalue=VALUES(svalue)",
      [req.user.id, "criticalThreshold", String(critical)]
    );

    // 历史字段：remindThreshold 不再使用（保留不影响兼容），也可选择性清理
    // await safeQuery("DELETE FROM user_settings WHERE user_id=? AND skey='remindThreshold'", [req.user.id]);

    sendJson(res, 200, { ok: true, criticalThreshold: critical });
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
}));

module.exports = router;
