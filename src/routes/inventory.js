"use strict";

const express = require("express");
const crypto = require("crypto");
const { requireAuth } = require("../middleware/auth");
const { sendJson } = require("../utils/respond");
const { safeQuery, withTransaction, q } = require("../db/pool");
const { ensureUserDefaults } = require("../services/user");
const {
  normPatternUrl,
  normPatternKey,
  parseCategoryId,
  newBatchId,
} = require("../utils/helpers");
const { NON_DEFAULT_SERIES } = require("../utils/palette");
const { BUILD_TAG } = require("../utils/constants");
const { withHandler } = require("../utils/observability");

const router = express.Router();

// ---- idempotency（防止网络抖动/重复点击导致重复入库） ----
// 说明：
// - 优先使用前端传入的 x-idempotency-key（2分钟内相同 key 直接返回同结果）
// - /api/adjustBatch 还会额外基于 body hash 做短期去重，避免前端重复生成不同 key 时仍重复入库
const _idempoCache = new Map(); // key -> {ts:number, payload:any}
const IDEMPO_TTL_MS = 2 * 60 * 1000;
const IDEMPO_MAX_SIZE = 10000;

function _idempoKey(req){
  const k = req.get("x-idempotency-key");
  if(!k) return null;
  const s = String(k).slice(0, 128);
  if(!s) return null;
  return `${req.user.id}:${s}`;
}
function _idempoGet(key){
  if(!key) return null;
  const v = _idempoCache.get(key);
  if(!v) return null;
  if(Date.now() - v.ts > IDEMPO_TTL_MS){
    _idempoCache.delete(key);
    return null;
  }
  return v.payload;
}
function _idempoSet(key, payload){
  if(!key) return;
  _idempoCache.set(key, {ts: Date.now(), payload});
  if(_idempoCache.size > IDEMPO_MAX_SIZE){
    _idempoSweep();
  }
}

function _idempoSweep(){
  if(_idempoCache.size <= IDEMPO_MAX_SIZE) return;
  const now = Date.now();
  for(const [k, v] of _idempoCache.entries()){
    if(now - v.ts > IDEMPO_TTL_MS){
      _idempoCache.delete(k);
    }
  }
  if(_idempoCache.size <= IDEMPO_MAX_SIZE) return;
  const entries = Array.from(_idempoCache.entries());
  entries.sort((a, b) => a[1].ts - b[1].ts);
  const over = _idempoCache.size - IDEMPO_MAX_SIZE;
  for(let i = 0; i < over; i++){
    _idempoCache.delete(entries[i][0]);
  }
}

router.get("/api/all", requireAuth, withHandler("all", async (req, res) => {
  try {
    // Ensure this user has the full default palette in inventory (221 colors, qty=0)
    await ensureUserDefaults(req.user.id);

    const [rows] = await safeQuery(
      `SELECT 
         ui.code AS code,
         COALESCE(p.hex, ui.hex) AS hex,
         ui.qty AS qty,
         COALESCE(p.series, '') AS series,
         COALESCE(p.is_default, 0) AS isDefault
       FROM user_inventory ui
       LEFT JOIN palette p ON ui.code=p.code
       WHERE ui.user_id=?
       ORDER BY ui.code`,
      [req.user.id]
    );
// Frontend expects { ok: true, data: [...] }
    sendJson(res, 200, { ok: true, data: rows, buildTag: BUILD_TAG });
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
}));

router.post("/api/adjust", requireAuth, withHandler("adjust", async (req, res) => {
  try {
    const code = String(req.body?.code || "").toUpperCase();
    const type = String(req.body?.type || "");
    const qty = Number(req.body?.qty);
    const pattern = req.body?.pattern ? String(req.body.pattern).slice(0, 64) : null;
    const patternUrlRaw = Object.prototype.hasOwnProperty.call(req.body || {}, "patternUrl")
      ? req.body?.patternUrl
      : null;
    const patternUrl = normPatternUrl(patternUrlRaw);
    const patternKeyRaw = Object.prototype.hasOwnProperty.call(req.body || {}, "patternKey")
      ? req.body?.patternKey
      : null;
    const patternKey = normPatternKey(patternKeyRaw);
    const patternCategoryRaw = req.body?.patternCategoryId;
    const source = req.body?.source ? String(req.body.source).slice(0, 32) : null;

    if (!code) return sendJson(res, 400, { ok: false, message: "missing code" });
    if (!["consume", "restock"].includes(type)) return sendJson(res, 400, { ok: false, message: "invalid type" });
    if (!Number.isFinite(qty) || qty <= 0) return sendJson(res, 400, { ok: false, message: "invalid qty" });

    let earlyResponse = null;
    await withTransaction(async (conn) => {
      let patternCategoryId = null;
      if(type === "consume"){
        const cid = parseCategoryId(patternCategoryRaw);
        if(patternCategoryRaw !== undefined && patternCategoryRaw !== null && patternCategoryRaw !== "" && !cid){
          earlyResponse = { status: 400, payload: { ok:false, message:"invalid category" } };
          return;
        }
        if(cid){
          const [[cat]] = await q(
            conn,
            "SELECT id FROM user_pattern_categories WHERE user_id=? AND id=? LIMIT 1",
            [req.user.id, cid]
          );
          if(!cat){
            earlyResponse = { status: 400, payload: { ok:false, message:"分类不存在" } };
            return;
          }
          patternCategoryId = cid;
        }
      }

      const delta = type === "consume" ? -Math.abs(Math.floor(qty)) : Math.abs(Math.floor(qty));

      // 校验色号是否存在于全局 palette；非默认色号必须先“按系列添加”到库存
      const [[p]] = await q(
        conn,
        "SELECT hex, is_default AS isDefault FROM palette WHERE code=? LIMIT 1",
        [code]
      );
      if (!p){
        earlyResponse = { status: 400, payload: { ok: false, message: "unknown code" } };
        return;
      }

      // 已删除的色号不允许直接调整（避免被自动补齐/重新写入）
      const [[rm]] = await q(
        conn,
        "SELECT 1 AS ok FROM user_removed_codes WHERE user_id=? AND code=? LIMIT 1",
        [req.user.id, code]
      );
      if (rm) {
        earlyResponse = { status: 400, payload: { ok: false, message: "该色号已被删除，请先在设置中重新添加色号" } };
        return;
      }

      if (Number(p.isDefault) === 0) {
        const [[exists]] = await q(
          conn,
          "SELECT 1 AS ok FROM user_inventory WHERE user_id=? AND code=? LIMIT 1",
          [req.user.id, code]
        );
        if (!exists) {
          earlyResponse = { status: 400, payload: { ok: false, message: "该色号属于非默认系列，请先在设置中添加对应系列" } };
          return;
        }
      } else {
        // 默认色号：缺失则自动补齐（qty=0）
        await q(
          conn,
          "INSERT IGNORE INTO user_inventory(user_id, code, qty, hex) VALUES(?,?,0,?)",
          [req.user.id, code, String(p.hex || "#CCCCCC").toUpperCase()]
        );
      }

      await q(
        conn,
        "UPDATE user_inventory SET qty = qty + ? WHERE user_id=? AND code=?",
        [delta, req.user.id, code]
      );
      const batchId = newBatchId();
      const finalPatternUrl = type === "consume" ? patternUrl : null;
      const finalPatternKey = type === "consume" ? patternKey : null;
      const finalPatternCategoryId = type === "consume" ? patternCategoryId : null;
      await q(
        conn,
        "INSERT INTO user_history(user_id, code, htype, qty, pattern, pattern_url, pattern_key, pattern_category_id, source, batch_id) VALUES(?,?,?,?,?,?,?,?,?,?)",
        [req.user.id, code, type, Math.abs(Math.floor(qty)), pattern, finalPatternUrl, finalPatternKey, finalPatternCategoryId, source, batchId]
      );
    });
    if (earlyResponse) return sendJson(res, earlyResponse.status, earlyResponse.payload);
    sendJson(res, 200, { ok: true });
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
}));

router.post("/api/resetAll", requireAuth, withHandler("resetAll", async (req, res) => {
  try {
    await withTransaction(async (conn) => {
      // 全部色号数量归零 + 清空历史记录
      await q(conn, "UPDATE user_inventory SET qty=0 WHERE user_id=?", [req.user.id]);
      await q(conn, "DELETE FROM user_history WHERE user_id=?", [req.user.id]);
      await q(conn, "DELETE FROM user_todo_patterns WHERE user_id=?", [req.user.id]);

      // 移除所有非默认色号
      await q(
        conn,
        "DELETE ui FROM user_inventory ui JOIN palette p ON ui.code=p.code WHERE ui.user_id=? AND p.is_default=0",
        [req.user.id]
      );
    });

    // 清理该用户的幂等缓存，避免“重置后短时间内重复请求被误判为重复”
    try{
      const prefix = `${req.user.id}:`;
      for(const k of Array.from(_idempoCache.keys())){
        if(String(k).startsWith(prefix)) _idempoCache.delete(k);
      }
    }catch{}

    sendJson(res, 200, { ok: true });
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
}));

router.post("/api/adjustBatch", requireAuth, withHandler("adjustBatch", async (req, res) => {
  try {
    // 1) 优先用 x-idempotency-key
    const __idemKey = _idempoKey(req);

    // 2) 再用 body hash 兜底（避免前端重复生成不同 key 时仍重复入库）
    const __bodyHash = crypto.createHash("sha256").update(JSON.stringify(req.body||{})).digest("hex").slice(0, 32);
    const __hashKey = `${req.user.id}:hash:${__bodyHash}`;

    let __cached = null;
    if(__idemKey){
      __cached = _idempoGet(__idemKey);
    }else{
      __cached = _idempoGet(__hashKey);
    }
    if(__cached) return sendJson(res, 200, __cached);

    const typeDefault = String(req.body?.type || "");
    const patternDefault = req.body?.pattern ? String(req.body.pattern).slice(0, 64) : null;
    const patternUrlDefault = Object.prototype.hasOwnProperty.call(req.body || {}, "patternUrl")
      ? req.body?.patternUrl
      : null;
    const patternKeyDefault = Object.prototype.hasOwnProperty.call(req.body || {}, "patternKey")
      ? req.body?.patternKey
      : null;
    const hasPatternCategoryDefault = Object.prototype.hasOwnProperty.call(req.body || {}, "patternCategoryId");
    const patternCategoryDefaultRaw = hasPatternCategoryDefault ? req.body?.patternCategoryId : null;
    const sourceDefault = req.body?.source ? String(req.body.source).slice(0, 32) : null;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    if (!items.length) return sendJson(res, 400, { ok: false, message: "empty" });
    if (items.length > 500) return sendJson(res, 400, { ok: false, message: "too many items" });

    // Normalize & validate
    const normalized = [];
    const categoryIdSet = new Set();
    for (const it of items) {
      const code = String(it?.code || "").toUpperCase();
      const qty = Number(it?.qty);
      const type = String(it?.type || typeDefault || "");
      const pattern = it?.pattern ? String(it.pattern).slice(0, 64) : patternDefault;
      const patternUrlRaw = Object.prototype.hasOwnProperty.call(it || {}, "patternUrl")
        ? it?.patternUrl
        : patternUrlDefault;
      const patternUrl = normPatternUrl(patternUrlRaw);
      const patternKeyRaw = Object.prototype.hasOwnProperty.call(it || {}, "patternKey")
        ? it?.patternKey
        : patternKeyDefault;
      const patternKey = normPatternKey(patternKeyRaw);
      const patternCategoryRaw = Object.prototype.hasOwnProperty.call(it || {}, "patternCategoryId")
        ? it?.patternCategoryId
        : patternCategoryDefaultRaw;
      const source = it?.source ? String(it.source).slice(0, 32) : sourceDefault;

      if (!code) return sendJson(res, 400, { ok: false, message: "missing code" });
      if (!["consume", "restock"].includes(type)) return sendJson(res, 400, { ok: false, message: "invalid type" });
      if (!Number.isFinite(qty) || qty <= 0) return sendJson(res, 400, { ok: false, message: "invalid qty" });

      let patternCategoryId = null;
      if(type === "consume"){
        const cid = parseCategoryId(patternCategoryRaw);
        if(patternCategoryRaw !== undefined && patternCategoryRaw !== null && patternCategoryRaw !== "" && !cid){
          return sendJson(res, 400, { ok:false, message:"invalid category" });
        }
        if(cid){
          patternCategoryId = cid;
          categoryIdSet.add(cid);
        }
      }

      normalized.push({
        code,
        qty: Math.abs(Math.floor(qty)),
        type,
        pattern,
        patternUrl: type === "consume" ? patternUrl : null,
        patternKey: type === "consume" ? patternKey : null,
        patternCategoryId: type === "consume" ? patternCategoryId : null,
        source,
      });
    }

    if(categoryIdSet.size > 0){
      const ids = Array.from(categoryIdSet.values());
      const inPh = ids.map(()=>"?").join(",");
      const [rows] = await safeQuery(
        `SELECT id FROM user_pattern_categories WHERE user_id=? AND id IN (${inPh})`,
        [req.user.id, ...ids]
      );
      const found = new Set((rows||[]).map(r=>Number(r.id)));
      for(const id of ids){
        if(!found.has(id)){
          return sendJson(res, 400, { ok:false, message:"分类不存在" });
        }
      }
    }

    // Aggregate inventory delta per code
    const deltaByCode = new Map();
    for (const it of normalized) {
      const delta = it.type === "consume" ? -it.qty : it.qty;
      deltaByCode.set(it.code, (deltaByCode.get(it.code) || 0) + delta);
    }
    const codes = Array.from(deltaByCode.keys());

    // 校验：色号必须存在于 palette；非默认色号必须先“按系列添加”到库存
    {
      const inPh = codes.map(() => "?").join(",");
      const [pRows] = await safeQuery(
        `SELECT code, is_default AS isDefault FROM palette WHERE code IN (${inPh})`,
        codes
      );
      const pMap = new Map((pRows || []).map(r => [String(r.code).toUpperCase(), Number(r.isDefault)]));
      for (const c of codes) {
        if (!pMap.has(c)) return sendJson(res, 400, { ok: false, message: `unknown code: ${c}` });
      }

      // 已删除的色号禁止批量调整（避免被重新写入）
      {
        const rmPh = codes.map(() => "?").join(",");
        const [rmRows] = await safeQuery(
          `SELECT code FROM user_removed_codes WHERE user_id=? AND code IN (${rmPh})`,
          [req.user.id, ...codes]
        );
        if (rmRows && rmRows.length > 0) {
          return sendJson(res, 400, { ok: false, message: "包含已删除的色号，请先在设置中重新添加色号" });
        }
      }
      const nonDefaultCodes = codes.filter(c => pMap.get(c) === 0);
      if (nonDefaultCodes.length > 0) {
        const inPh2 = nonDefaultCodes.map(() => "?").join(",");
        const [invRows] = await safeQuery(
          `SELECT code FROM user_inventory WHERE user_id=? AND code IN (${inPh2})`,
          [req.user.id, ...nonDefaultCodes]
        );
        const invSet = new Set((invRows || []).map(r => String(r.code).toUpperCase()));
        for (const c of nonDefaultCodes) {
          if (!invSet.has(c)) {
            return sendJson(res, 400, { ok: false, message: "包含未添加到库存的非默认色号，请先在设置中添加对应系列" });
          }
        }
      }
    }

    const batchId = newBatchId();

    // One transaction, 3 SQLs total
    await withTransaction(async (conn) => {
      // Ensure inventory rows exist ONLY for default codes (INSERT IGNORE)
      {
        const inPh = codes.map(() => "?").join(",");
        const params = [req.user.id, ...codes];
        await q(conn,
          `INSERT IGNORE INTO user_inventory(user_id, code, qty, hex)
           SELECT ?, p.code, 0, p.hex
           FROM palette p
           WHERE p.is_default=1 AND p.code IN (${inPh})`,
          params
        );
      }

      // Update inventory in one statement
      {
        const cases = [];
        const params = [];
        for (const [code, delta] of deltaByCode.entries()) {
          cases.push("WHEN ? THEN ?");
          params.push(code, delta);
        }
        const inPlaceholders = codes.map(() => "?").join(",");
        const sql = `
          UPDATE user_inventory
          SET qty = qty + CASE code
            ${cases.join(" ")}
            ELSE 0
          END
          WHERE user_id = ? AND code IN (${inPlaceholders})
        `;
        params.push(req.user.id, ...codes);
        await q(conn, sql, params);
      }

      // Insert history rows (bulk)
      {
        const vals = [];
        const params = [];
        for (const it of normalized) {
          vals.push("(?,?,?,?,?,?,?,?,?,?)");
          params.push(req.user.id, it.code, it.type, it.qty, it.pattern, it.patternUrl, it.patternKey, it.patternCategoryId, it.source, batchId);
        }
        await q(conn, `INSERT INTO user_history(user_id, code, htype, qty, pattern, pattern_url, pattern_key, pattern_category_id, source, batch_id) VALUES ${vals.join(",")}`, params);
      }
    });

    const __payload = { ok: true };
    if(__idemKey){
      _idempoSet(__idemKey, __payload);
    }else{
      _idempoSet(__hashKey, __payload);
    }
    sendJson(res, 200, __payload);
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
}));

router.post("/api/addSeries", requireAuth, withHandler("addSeries", async (req, res) => {
  try {
    const series = String(req.body?.series || "").trim();
    if (!series) return sendJson(res, 400, { ok: false, message: "missing series" });
    if (!NON_DEFAULT_SERIES.includes(series)) {
      return sendJson(res, 400, { ok: false, message: "invalid series" });
    }

    await safeQuery(
      `INSERT IGNORE INTO user_inventory(user_id, code, qty, hex)
       SELECT ?, p.code, 0, p.hex
       FROM palette p
       LEFT JOIN user_removed_codes r ON r.user_id=? AND r.code=p.code
       WHERE p.series=? AND p.is_default=0 AND r.code IS NULL`,
      [req.user.id, req.user.id, series]
    );

    sendJson(res, 200, { ok: true });
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
}));

router.post("/api/removeSeries", requireAuth, withHandler("removeSeries", async (req, res) => {
  try {
    const series = String(req.body?.series || "").trim();
    if (!series) return sendJson(res, 400, { ok: false, message: "missing series" });
    if (!NON_DEFAULT_SERIES.includes(series)) {
      return sendJson(res, 400, { ok: false, message: "invalid series" });
    }

    await withTransaction(async (conn) => {
      // 删除该系列所有历史记录 + 移除库存行
      await q(
        conn,
        `DELETE h FROM user_history h
       JOIN palette p ON h.code=p.code
       WHERE h.user_id=? AND p.series=? AND p.is_default=0`,
        [req.user.id, series]
      );
      await q(
        conn,
        `DELETE ui FROM user_inventory ui
       JOIN palette p ON ui.code=p.code
       WHERE ui.user_id=? AND p.series=? AND p.is_default=0`,
        [req.user.id, series]
      );
    });

    sendJson(res, 200, { ok: true });
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
}));

// 添加色号（仅支持 MARD 色号）：库存为 0
router.post("/api/addColor", requireAuth, withHandler("addColor", async (req, res) => {
  try {
    const code = String(req.body?.code || "").trim().toUpperCase();
    if (!code) return sendJson(res, 400, { ok: false, message: "missing code" });

    let earlyResponse = null;
    await withTransaction(async (conn) => {
      const [[p]] = await q(
        conn,
        "SELECT code, hex FROM palette WHERE code=? LIMIT 1",
        [code]
      );
      if (!p){
        earlyResponse = { status: 400, payload: { ok: false, message: "非MARD色号，请检查后重新输入" } };
        return;
      }

      const [[exists]] = await q(
        conn,
        "SELECT 1 AS ok FROM user_inventory WHERE user_id=? AND code=? LIMIT 1",
        [req.user.id, code]
      );
      if (exists){
        earlyResponse = { status: 400, payload: { ok: false, message: "色号已存在" } };
        return;
      }

      await q(
        conn,
        "INSERT INTO user_inventory(user_id, code, qty, hex) VALUES(?,?,0,?)",
        [req.user.id, code, String(p.hex || "#CCCCCC").toUpperCase()]
      );
      // 如果之前被删除过，则清除删除标记
      await q(
        conn,
        "DELETE FROM user_removed_codes WHERE user_id=? AND code=?",
        [req.user.id, code]
      );
    });
    if (earlyResponse) return sendJson(res, earlyResponse.status, earlyResponse.payload);
    sendJson(res, 200, { ok: true });
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
}));

// 删除色号：清空库存 + 明细
router.post("/api/removeColor", requireAuth, withHandler("removeColor", async (req, res) => {
  try {
    const code = String(req.body?.code || "").trim().toUpperCase();
    if (!code) return sendJson(res, 400, { ok: false, message: "missing code" });

    let earlyResponse = null;
    await withTransaction(async (conn) => {
      // 仅允许删除 MARD 色号（与前端校验一致）
      const [[p]] = await q(
        conn,
        "SELECT 1 AS ok FROM palette WHERE code=? LIMIT 1",
        [code]
      );
      if (!p){
        earlyResponse = { status: 400, payload: { ok: false, message: "非MARD色号，请检查后重新输入" } };
        return;
      }

      await q(conn, "DELETE FROM user_history WHERE user_id=? AND code=?", [req.user.id, code]);
      await q(conn, "DELETE FROM user_inventory WHERE user_id=? AND code=?", [req.user.id, code]);
      await q(
        conn,
        "INSERT INTO user_removed_codes(user_id, code, removed_at) VALUES(?,?,NOW()) ON DUPLICATE KEY UPDATE removed_at=NOW()",
        [req.user.id, code]
      );
    });
    if (earlyResponse) return sendJson(res, earlyResponse.status, earlyResponse.payload);
    sendJson(res, 200, { ok: true });
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
}));

module.exports = router;
