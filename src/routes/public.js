"use strict";

const express = require("express");
const { sendJson } = require("../utils/respond");
const { withHandler } = require("../utils/observability");
const { dbEnabled, safeQuery } = require("../db/pool");
const { PALETTE_ALL } = require("../utils/palette");
const { BUILD_TAG } = require("../utils/constants");

const router = express.Router();

router.get("/api/public/palette", withHandler("publicPalette", async (req, res) => {
  try {
    if (dbEnabled()) {
      const [rows] = await safeQuery("SELECT code, hex, series, is_default AS isDefault FROM palette ORDER BY code", []);
      if (rows && rows.length > 0) return sendJson(res, 200, { ok: true, data: rows, buildTag: BUILD_TAG });
    }
    const data = PALETTE_ALL.map(x => ({ code: x.code, hex: x.hex, series: x.series, isDefault: x.isDefault ? 1 : 0 }));
    sendJson(res, 200, { ok: true, data, buildTag: BUILD_TAG, fallback: true });
  } catch (e) {
    const data = PALETTE_ALL.map(x => ({ code: x.code, hex: x.hex, series: x.series, isDefault: x.isDefault ? 1 : 0 }));
    sendJson(res, 200, { ok: true, data, buildTag: BUILD_TAG, fallback: true, warn: e.message });
  }
}));

module.exports = router;
