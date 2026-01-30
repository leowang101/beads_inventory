"use strict";

const express = require("express");
const { sendJson } = require("../utils/respond");
const { withHandler } = require("../utils/observability");
const { BUILD_TAG } = require("../utils/constants");

const router = express.Router();

router.get("/api/health", withHandler("health", (req, res) => {
  sendJson(res, 200, { ok: true, buildTag: BUILD_TAG, ts: new Date().toISOString() });
}));

module.exports = router;
