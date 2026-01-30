"use strict";

const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { sendJson } = require("../utils/respond");
const { safeQuery, withTransaction, q } = require("../db/pool");
const {
  normPatternUrl,
  normPatternKey,
  categoryDisplayLength,
  normCategoryName,
  parseCategoryId,
  normalizeTodoItems,
  newBatchId,
} = require("../utils/helpers");
const { MAX_PATTERN_CATEGORIES } = require("../utils/constants");
const { withHandler } = require("../utils/observability");

const router = express.Router();

// ====== Pattern Categories ======
router.get("/api/patternCategories", requireAuth, withHandler("patternCategoriesGet", async (req, res) => {
  try{
    const [rows] = await safeQuery(
      `SELECT id, name, created_at AS createdAt
       FROM user_pattern_categories
       WHERE user_id=?
       ORDER BY created_at ASC, id ASC`,
      [req.user.id]
    );
    sendJson(res, 200, { ok:true, data: rows });
  }catch(e){
    sendJson(res, 500, { ok:false, message: e.message });
  }
}));

router.post("/api/patternCategories", requireAuth, withHandler("patternCategoriesCreate", async (req, res) => {
  try{
    const name = normCategoryName(req.body?.name);
    if(!name) return sendJson(res, 400, { ok:false, message:"请输入分类名称" });
    if(categoryDisplayLength(name) > 12){
      return sendJson(res, 400, { ok:false, message:"分类名称最多6个中文或12个英文" });
    }

    const [[countRow]] = await safeQuery(
      "SELECT COUNT(1) AS cnt FROM user_pattern_categories WHERE user_id=?",
      [req.user.id]
    );
    const cnt = Number(countRow?.cnt || 0);
    if(cnt >= MAX_PATTERN_CATEGORIES){
      return sendJson(res, 400, { ok:false, message:`最多只能创建${MAX_PATTERN_CATEGORIES}个分类` });
    }

    const [exists] = await safeQuery(
      "SELECT id FROM user_pattern_categories WHERE user_id=? AND name=? LIMIT 1",
      [req.user.id, name]
    );
    if(exists && exists.length > 0){
      return sendJson(res, 400, { ok:false, message:"分类已存在" });
    }

    const [result] = await safeQuery(
      "INSERT INTO user_pattern_categories(user_id, name) VALUES(?, ?)",
      [req.user.id, name]
    );
    sendJson(res, 200, { ok:true, id: result?.insertId, name });
  }catch(e){
    sendJson(res, 500, { ok:false, message: e.message });
  }
}));

router.post("/api/patternCategoryDelete", requireAuth, withHandler("patternCategoryDelete", async (req, res) => {
  try{
    const id = parseCategoryId(req.body?.id);
    if(!id) return sendJson(res, 400, { ok:false, message:"invalid id" });

    await withTransaction(async(conn)=>{
      await q(conn, "UPDATE user_history SET pattern_category_id=NULL WHERE user_id=? AND pattern_category_id=?", [req.user.id, id]);
      await q(conn, "UPDATE user_todo_patterns SET pattern_category_id=NULL WHERE user_id=? AND pattern_category_id=?", [req.user.id, id]);
      const [delRes] = await q(conn, "DELETE FROM user_pattern_categories WHERE user_id=? AND id=?", [req.user.id, id]);
      if(!delRes || delRes.affectedRows === 0){
        throw new Error("not found");
      }
    });

    sendJson(res, 200, { ok:true });
  }catch(e){
    if(String(e.message||"") === "not found"){
      return sendJson(res, 404, { ok:false, message:"分类不存在" });
    }
    sendJson(res, 500, { ok:false, message: e.message });
  }
}));

router.post("/api/patternCategoryUpdate", requireAuth, withHandler("patternCategoryUpdate", async (req, res) => {
  try{
    const id = parseCategoryId(req.body?.id);
    const name = normCategoryName(req.body?.name);
    if(!id) return sendJson(res, 400, { ok:false, message:"invalid id" });
    if(!name) return sendJson(res, 400, { ok:false, message:"请输入分类名称" });
    if(categoryDisplayLength(name) > 12){
      return sendJson(res, 400, { ok:false, message:"分类名称最多6个中文或12个英文" });
    }

    const [[base]] = await safeQuery(
      "SELECT id, name FROM user_pattern_categories WHERE user_id=? AND id=? LIMIT 1",
      [req.user.id, id]
    );
    if(!base) return sendJson(res, 404, { ok:false, message:"分类不存在" });
    if(String(base.name || "") === name){
      return sendJson(res, 200, { ok:true });
    }

    const [exists] = await safeQuery(
      "SELECT id FROM user_pattern_categories WHERE user_id=? AND name=? AND id<>? LIMIT 1",
      [req.user.id, name, id]
    );
    if(exists && exists.length > 0){
      return sendJson(res, 400, { ok:false, message:"分类已存在" });
    }

    await safeQuery(
      "UPDATE user_pattern_categories SET name=? WHERE user_id=? AND id=?",
      [name, req.user.id, id]
    );
    sendJson(res, 200, { ok:true });
  }catch(e){
    sendJson(res, 500, { ok:false, message: e.message });
  }
}));

// ====== 待拼图纸 ======
router.post("/api/todoPatternAdd", requireAuth, withHandler("todoPatternAdd", async (req, res) => {
  try {
    const pattern = req.body?.pattern ? String(req.body.pattern).slice(0, 64) : null;
    const patternUrl = normPatternUrl(req.body?.patternUrl);
    const patternKey = normPatternKey(req.body?.patternKey);
    const patternCategoryRaw = req.body?.patternCategoryId;
    const items = normalizeTodoItems(req.body?.items || []);

    if (!patternUrl) return sendJson(res, 400, { ok: false, message: "missing patternUrl" });
    if (items.length === 0) return sendJson(res, 400, { ok: false, message: "empty items" });
    if (items.length > 500) return sendJson(res, 400, { ok: false, message: "too many items" });

    let patternCategoryId = null;
    if (patternCategoryRaw !== undefined && patternCategoryRaw !== null && patternCategoryRaw !== "") {
      const cid = parseCategoryId(patternCategoryRaw);
      if (!cid) return sendJson(res, 400, { ok: false, message: "invalid category" });
      const [rows] = await safeQuery(
        "SELECT id FROM user_pattern_categories WHERE user_id=? AND id=? LIMIT 1",
        [req.user.id, cid]
      );
      if (!rows || rows.length === 0) return sendJson(res, 400, { ok: false, message: "分类不存在" });
      patternCategoryId = cid;
    }

    const codes = items.map(it => it.code);
    {
      const inPh = codes.map(() => "?").join(",");
      const [pRows] = await safeQuery(
        `SELECT code FROM palette WHERE code IN (${inPh})`,
        codes
      );
      const pSet = new Set((pRows || []).map(r => String(r.code).toUpperCase()));
      for (const c of codes) {
        if (!pSet.has(c)) return sendJson(res, 400, { ok: false, message: `unknown code: ${c}` });
      }
      const [rmRows] = await safeQuery(
        `SELECT code FROM user_removed_codes WHERE user_id=? AND code IN (${inPh})`,
        [req.user.id, ...codes]
      );
      if (rmRows && rmRows.length > 0) {
        return sendJson(res, 400, { ok: false, message: "包含已删除的色号，请先在设置中重新添加色号" });
      }
    }

    const totalQty = items.reduce((acc, it) => acc + (Number(it.qty) || 0), 0);
    const itemsJson = JSON.stringify(items);
    const [result] = await safeQuery(
      "INSERT INTO user_todo_patterns(user_id, pattern, pattern_url, pattern_key, pattern_category_id, items_json, total_qty) VALUES(?,?,?,?,?,?,?)",
      [req.user.id, pattern, patternUrl, patternKey, patternCategoryId, itemsJson, totalQty]
    );
    sendJson(res, 200, { ok: true, id: result?.insertId || null });
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
}));

router.get("/api/todoPatterns", requireAuth, withHandler("todoPatternsList", async (req, res) => {
  try {
    const rawCategory = req.query?.patternCategoryId;
    const categoryId = parseCategoryId(rawCategory);
    if (rawCategory !== undefined && rawCategory !== null && rawCategory !== "" && !categoryId) {
      return sendJson(res, 400, { ok: false, message: "invalid category" });
    }
    const categoryClause = categoryId ? " AND pattern_category_id=? " : "";
    const params = categoryId ? [req.user.id, categoryId] : [req.user.id];
    const [rows] = await safeQuery(
      `
      SELECT id,
             UNIX_TIMESTAMP(created_at)*1000 AS ts,
             pattern,
             pattern_url AS patternUrl,
             pattern_key AS patternKey,
             pattern_category_id AS patternCategoryId,
             total_qty AS total
        FROM user_todo_patterns
       WHERE user_id=? ${categoryClause}
       ORDER BY created_at DESC, id DESC
      `,
      params
    );
    sendJson(res, 200, { ok: true, data: rows || [] });
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
}));

router.get("/api/todoPatternDetail", requireAuth, withHandler("todoPatternDetail", async (req, res) => {
  try {
    const id = Number(req.query?.id);
    if (!Number.isInteger(id) || id <= 0) return sendJson(res, 400, { ok: false, message: "invalid id" });
    const [rows] = await safeQuery(
      "SELECT items_json AS itemsJson FROM user_todo_patterns WHERE user_id=? AND id=? LIMIT 1",
      [req.user.id, id]
    );
    if (!rows || rows.length === 0) return sendJson(res, 404, { ok: false, message: "not found" });
    let items = [];
    try { items = JSON.parse(rows[0].itemsJson || "[]") || []; } catch {}
    sendJson(res, 200, { ok: true, data: items });
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
}));

router.post("/api/todoPatternUpdate", requireAuth, withHandler("todoPatternUpdate", async (req, res) => {
  try {
    const id = Number(req.body?.id);
    if (!Number.isInteger(id) || id <= 0) return sendJson(res, 400, { ok: false, message: "invalid id" });

    const [rows] = await safeQuery(
      "SELECT pattern_url AS patternUrl, pattern_key AS patternKey FROM user_todo_patterns WHERE user_id=? AND id=? LIMIT 1",
      [req.user.id, id]
    );
    if (!rows || rows.length === 0) return sendJson(res, 404, { ok: false, message: "not found" });
    const base = rows[0] || {};

    const pattern = req.body?.pattern ? String(req.body.pattern).slice(0, 64) : null;
    const hasPatternUrl = Object.prototype.hasOwnProperty.call(req.body || {}, "patternUrl");
    const hasPatternKey = Object.prototype.hasOwnProperty.call(req.body || {}, "patternKey");
    const patternUrl = hasPatternUrl ? normPatternUrl(req.body?.patternUrl) : normPatternUrl(base.patternUrl);
    const patternKey = hasPatternKey ? normPatternKey(req.body?.patternKey) : normPatternKey(base.patternKey);
    if (!patternUrl) return sendJson(res, 400, { ok: false, message: "patternUrl required" });

    const patternCategoryRaw = req.body?.patternCategoryId;
    let patternCategoryId = null;
    if (patternCategoryRaw !== undefined && patternCategoryRaw !== null && patternCategoryRaw !== "") {
      const cid = parseCategoryId(patternCategoryRaw);
      if (!cid) return sendJson(res, 400, { ok: false, message: "invalid category" });
      const [catRows] = await safeQuery(
        "SELECT id FROM user_pattern_categories WHERE user_id=? AND id=? LIMIT 1",
        [req.user.id, cid]
      );
      if (!catRows || catRows.length === 0) return sendJson(res, 400, { ok: false, message: "分类不存在" });
      patternCategoryId = cid;
    }

    const items = normalizeTodoItems(req.body?.items || []);
    if (items.length === 0) return sendJson(res, 400, { ok: false, message: "empty items" });
    if (items.length > 500) return sendJson(res, 400, { ok: false, message: "too many items" });

    const codes = items.map(it => it.code);
    {
      const inPh = codes.map(() => "?").join(",");
      const [pRows] = await safeQuery(
        `SELECT code FROM palette WHERE code IN (${inPh})`,
        codes
      );
      const pSet = new Set((pRows || []).map(r => String(r.code).toUpperCase()));
      for (const c of codes) {
        if (!pSet.has(c)) return sendJson(res, 400, { ok: false, message: `unknown code: ${c}` });
      }
      const [rmRows] = await safeQuery(
        `SELECT code FROM user_removed_codes WHERE user_id=? AND code IN (${inPh})`,
        [req.user.id, ...codes]
      );
      if (rmRows && rmRows.length > 0) {
        return sendJson(res, 400, { ok: false, message: "包含已删除的色号，请先在设置中重新添加色号" });
      }
    }

    const totalQty = items.reduce((acc, it) => acc + (Number(it.qty) || 0), 0);
    const itemsJson = JSON.stringify(items);
    await safeQuery(
      "UPDATE user_todo_patterns SET pattern=?, pattern_url=?, pattern_key=?, pattern_category_id=?, items_json=?, total_qty=? WHERE user_id=? AND id=?",
      [pattern, patternUrl, patternKey, patternCategoryId, itemsJson, totalQty, req.user.id, id]
    );
    sendJson(res, 200, { ok: true });
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
}));

router.post("/api/todoPatternDelete", requireAuth, withHandler("todoPatternDelete", async (req, res) => {
  try {
    const id = Number(req.body?.id);
    if (!Number.isInteger(id) || id <= 0) return sendJson(res, 400, { ok: false, message: "invalid id" });
    await safeQuery("DELETE FROM user_todo_patterns WHERE user_id=? AND id=?", [req.user.id, id]);
    sendJson(res, 200, { ok: true });
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
}));

router.post("/api/todoPatternComplete", requireAuth, withHandler("todoPatternComplete", async (req, res) => {
  try {
    const id = Number(req.body?.id);
    if (!Number.isInteger(id) || id <= 0) return sendJson(res, 400, { ok: false, message: "invalid id" });

    const [rows] = await safeQuery(
      "SELECT pattern, pattern_url AS patternUrl, pattern_key AS patternKey, pattern_category_id AS patternCategoryId, items_json AS itemsJson FROM user_todo_patterns WHERE user_id=? AND id=? LIMIT 1",
      [req.user.id, id]
    );
    if (!rows || rows.length === 0) return sendJson(res, 404, { ok: false, message: "not found" });
    const row = rows[0] || {};
    if (!row.patternUrl) return sendJson(res, 400, { ok: false, message: "patternUrl required" });

    let items = [];
    try { items = JSON.parse(row.itemsJson || "[]") || []; } catch {}
    const normalized = normalizeTodoItems(items);
    if (normalized.length === 0) return sendJson(res, 400, { ok: false, message: "empty items" });
    if (normalized.length > 500) return sendJson(res, 400, { ok: false, message: "too many items" });

    const codes = normalized.map(it => it.code);
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
      const [rmRows] = await safeQuery(
        `SELECT code FROM user_removed_codes WHERE user_id=? AND code IN (${inPh})`,
        [req.user.id, ...codes]
      );
      if (rmRows && rmRows.length > 0) {
        return sendJson(res, 400, { ok: false, message: "包含已删除的色号，请先在设置中重新添加色号" });
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
    await withTransaction(async (conn) => {
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

      {
        const cases = [];
        const params = [];
        for (const it of normalized) {
          cases.push("WHEN ? THEN ?");
          params.push(it.code, -Math.abs(Math.floor(it.qty)));
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

      {
        const vals = [];
        const params = [];
        for (const it of normalized) {
          vals.push("(?,?,?,?,?,?,?,?,?,?)");
          params.push(
            req.user.id,
            it.code,
            "consume",
            Math.abs(Math.floor(it.qty)),
            row.pattern || null,
            row.patternUrl,
            row.patternKey || null,
            row.patternCategoryId || null,
            "todo",
            batchId
          );
        }
        await q(conn,
          `INSERT INTO user_history(user_id, code, htype, qty, pattern, pattern_url, pattern_key, pattern_category_id, source, batch_id)
           VALUES ${vals.join(",")}`,
          params
        );
      }

      await q(conn, "DELETE FROM user_todo_patterns WHERE user_id=? AND id=?", [req.user.id, id]);
    });

    sendJson(res, 200, { ok: true });
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
}));

module.exports = router;
