"use strict";

const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { sendJson } = require("../utils/respond");
const { safeQuery, withTransaction, q } = require("../db/pool");
const { parseCategoryId, normPatternUrl, normPatternKey } = require("../utils/helpers");
const { BUILD_TAG } = require("../utils/constants");
const { withHandler } = require("../utils/observability");

const router = express.Router();

router.get("/api/history", requireAuth, withHandler("history", async (req, res) => {
  try {
    const code = req.query?.code ? String(req.query.code).toUpperCase() : null;
    if (!code) return sendJson(res, 400, { ok: false, message: "missing code" });

    const limit = Math.min(200, Math.max(1, Number(req.query?.limit || 100)));

    // 当前余量
    const [[inv]] = await safeQuery(
      "SELECT qty AS remain FROM user_inventory WHERE user_id=? AND code=? LIMIT 1",
      [req.user.id, code]
    );

    // 明细：统一字段名，保持与访客模式一致：ts/type/qty/pattern/source
    const [rows] = await safeQuery(
      `SELECT UNIX_TIMESTAMP(created_at)*1000 AS ts, htype AS type, qty, pattern, pattern_url AS patternUrl, pattern_key AS patternKey, source
       FROM user_history
       WHERE user_id=? AND code=?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      [req.user.id, code, limit]
    );

    // 汇总
    const [[sumRow]] = await safeQuery(
      `SELECT
         IFNULL(SUM(CASE WHEN htype='consume' THEN qty ELSE 0 END),0) AS totalConsume,
         IFNULL(SUM(CASE WHEN htype='restock' THEN qty ELSE 0 END),0) AS totalRestock
       FROM user_history
       WHERE user_id=? AND code=?`,
      [req.user.id, code]
    );

    sendJson(res, 200, {
      ok: true,
      remain: inv?.remain ?? 0,
      totalConsume: sumRow?.totalConsume ?? 0,
      totalRestock: sumRow?.totalRestock ?? 0,
      data: rows,
      buildTag: BUILD_TAG,
    });
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
}));

// 消耗统计：按色号汇总消耗数量（仅展示消耗>0）
router.get("/api/consumeStats", requireAuth, withHandler("consumeStats", async (req, res) => {
  try {
    const [rows] = await safeQuery(
      `SELECT h.code, SUM(h.qty) AS qty, p.hex
       FROM user_history h
       LEFT JOIN palette p ON p.code=h.code
       WHERE h.user_id=? AND h.htype='consume'
       GROUP BY h.code
       HAVING SUM(h.qty) > 0
       ORDER BY qty DESC, h.code ASC`,
      [req.user.id]
    );

    sendJson(res, 200, { ok: true, data: rows, buildTag: BUILD_TAG });
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
}));


router.get("/api/recordGroups", requireAuth, withHandler("recordGroups", async (req, res) => {
  try{
    const type = String(req.query?.type || "").toLowerCase();
    const onlyWithPattern = String(req.query?.onlyWithPattern || "") === "1";
    const rawCategory = req.query?.patternCategoryId;
    const categoryId = (type === "consume") ? parseCategoryId(rawCategory) : null;
    const hasLimitParam = Object.prototype.hasOwnProperty.call(req.query || {}, "limit");
    const hasCursorParam = Object.prototype.hasOwnProperty.call(req.query || {}, "cursor");
    const pagingEnabled = hasLimitParam || hasCursorParam;

    if(!["consume","restock"].includes(type)){
      return sendJson(res, 400, { ok:false, message:"invalid type" });
    }
    if(type === "consume" && rawCategory !== undefined && rawCategory !== null && rawCategory !== "" && !categoryId){
      return sendJson(res, 400, { ok:false, message:"invalid category" });
    }

    const patternClause = (type==="consume" && onlyWithPattern) ? " AND pattern IS NOT NULL AND pattern<>'' " : "";
    const categoryClause = (type==="consume" && categoryId) ? " AND pattern_category_id=? " : "";

    let limit = 30;
    if(pagingEnabled){
      if(hasLimitParam){
        const rawLimit = Number(req.query?.limit);
        if(!Number.isInteger(rawLimit) || rawLimit <= 0 || rawLimit > 200){
          return sendJson(res, 400, { ok:false, message:"invalid limit" });
        }
        limit = rawLimit;
      }
    }
    let cursorTs = null;
    let cursorMaxId = null;
    if(pagingEnabled && hasCursorParam){
      const rawCursor = String(req.query?.cursor ?? "").trim();
      if(!rawCursor) return sendJson(res, 400, { ok:false, message:"invalid cursor" });
      const parts = rawCursor.split(":");
      if(parts.length !== 2) return sendJson(res, 400, { ok:false, message:"invalid cursor" });
      const tsVal = Number(parts[0]);
      const maxIdVal = Number(parts[1]);
      if(!Number.isFinite(tsVal) || !Number.isFinite(maxIdVal)){
        return sendJson(res, 400, { ok:false, message:"invalid cursor" });
      }
      cursorTs = tsVal;
      cursorMaxId = maxIdVal;
    }

    const baseSql = `
      SELECT gid, ts, pattern, patternUrl, patternKey, patternCategoryId, total, maxId FROM (
        SELECT
          CONCAT('b:', batch_id) AS gid,
          UNIX_TIMESTAMP(MAX(created_at))*1000 AS ts,
          MAX(pattern) AS pattern,
          MAX(pattern_url) AS patternUrl,
          MAX(pattern_key) AS patternKey,
          MAX(pattern_category_id) AS patternCategoryId,
          SUM(qty) AS total,
          MAX(id) AS maxId
        FROM user_history
        WHERE user_id=? AND htype=? AND batch_id IS NOT NULL
        ${patternClause}
        ${categoryClause}
        GROUP BY batch_id

        UNION ALL

        SELECT
          CONCAT('i:', MIN(id)) AS gid,
          UNIX_TIMESTAMP(MAX(created_at))*1000 AS ts,
          MAX(pattern) AS pattern,
          MAX(pattern_url) AS patternUrl,
          MAX(pattern_key) AS patternKey,
          MAX(pattern_category_id) AS patternCategoryId,
          SUM(qty) AS total,
          MAX(id) AS maxId
        FROM user_history
        WHERE user_id=? AND htype=? AND batch_id IS NULL
        ${patternClause}
        ${categoryClause}
        GROUP BY created_at, IFNULL(pattern,''), IFNULL(source,''), IFNULL(pattern_category_id,0)
      ) t
    `;

    const params = [
      req.user.id,
      type,
      ...(categoryClause ? [categoryId] : []),
      req.user.id,
      type,
      ...(categoryClause ? [categoryId] : [])
    ];

    let sql = baseSql;
    if(pagingEnabled && cursorTs !== null && cursorMaxId !== null){
      sql += ` WHERE (t.ts < ?) OR (t.ts = ? AND t.maxId < ?) `;
      params.push(cursorTs, cursorTs, cursorMaxId);
    }
    sql += ` ORDER BY t.ts DESC, t.maxId DESC `;
    if(pagingEnabled){
      sql += ` LIMIT ? `;
      params.push(limit + 1);
    }

    const [rowsRaw] = await safeQuery(sql, params);
    const rows = Array.isArray(rowsRaw) ? rowsRaw : [];
    if(!pagingEnabled){
      const data = rows.map(r => {
        const { maxId, ...rest } = r;
        return rest;
      });
      return sendJson(res, 200, { ok:true, data, buildTag: BUILD_TAG });
    }

    let hasMore = false;
    let trimmed = rows;
    if(rows.length > limit){
      hasMore = true;
      trimmed = rows.slice(0, limit);
    }
    const nextCursor = (() => {
      if(trimmed.length === 0) return null;
      const last = trimmed[trimmed.length - 1];
      return `${last.ts}:${last.maxId}`;
    })();
    const data = trimmed.map(r => {
      const { maxId, ...rest } = r;
      return rest;
    });
    sendJson(res, 200, { ok:true, data, buildTag: BUILD_TAG, hasMore, nextCursor });
  }catch(e){
    sendJson(res, 500, { ok:false, message:e.message });
  }
}));

router.get("/api/recordGroupDetail", requireAuth, withHandler("recordGroupDetail", async (req, res) => {
  try{
    const gid = String(req.query?.gid || "");
    const type = String(req.query?.type || "").toLowerCase();
    if(!gid) return sendJson(res, 400, { ok:false, message:"missing gid" });
    if(!["consume","restock"].includes(type)) return sendJson(res, 400, { ok:false, message:"invalid type" });

    if(gid.startsWith("b:")){
      const batchId = gid.slice(2);
      const [rows] = await safeQuery(
        `SELECT h.code, SUM(h.qty) AS qty, p.hex
         FROM user_history h
         LEFT JOIN palette p ON p.code=h.code
         WHERE h.user_id=? AND h.htype=? AND h.batch_id=?
         GROUP BY h.code
         ORDER BY qty DESC, h.code ASC`,
        [req.user.id, type, batchId]
      );
      return sendJson(res, 200, { ok:true, data: rows, buildTag: BUILD_TAG });
    }

    if(gid.startsWith("i:")){
      const anchorId = Number(gid.slice(2));
      if(!Number.isFinite(anchorId) || anchorId<=0){
        return sendJson(res, 400, { ok:false, message:"invalid gid" });
      }
      const [[base]] = await safeQuery(
        `SELECT created_at, IFNULL(pattern,'') AS patternKey, IFNULL(source,'') AS sourceKey, IFNULL(pattern_category_id,0) AS categoryKey
         FROM user_history
         WHERE user_id=? AND id=? AND htype=? LIMIT 1`,
        [req.user.id, anchorId, type]
      );
      if(!base) return sendJson(res, 404, { ok:false, message:"group not found" });

      const [rows] = await safeQuery(
        `SELECT h.code, SUM(h.qty) AS qty, p.hex
         FROM user_history h
         LEFT JOIN palette p ON p.code=h.code
         WHERE h.user_id=? AND h.htype=? AND h.batch_id IS NULL
           AND h.created_at=? AND IFNULL(h.pattern,'')=? AND IFNULL(h.source,'')=? AND IFNULL(h.pattern_category_id,0)=?
         GROUP BY h.code
         ORDER BY qty DESC, h.code ASC`,
        [req.user.id, type, base.created_at, base.patternKey, base.sourceKey, base.categoryKey]
      );
      return sendJson(res, 200, { ok:true, data: rows, buildTag: BUILD_TAG });
    }

    return sendJson(res, 400, { ok:false, message:"invalid gid" });
  }catch(e){
    sendJson(res, 500, { ok:false, message:e.message });
  }
}));

router.post("/api/recordGroupUpdate", requireAuth, withHandler("recordGroupUpdate", async (req, res) => {
  try{
    // Edit a grouped record: compute inventory delta (new - old) and rewrite group history.
    const gid = String(req.body?.gid || "");
    const type = String(req.body?.type || "").toLowerCase();
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const hasPattern = Object.prototype.hasOwnProperty.call(req.body || {}, "pattern");
    const patternRaw = hasPattern ? String(req.body?.pattern || "") : "";
    const hasPatternUrl = Object.prototype.hasOwnProperty.call(req.body || {}, "patternUrl");
    const patternUrlRaw = hasPatternUrl ? req.body?.patternUrl : null;
    const hasPatternKey = Object.prototype.hasOwnProperty.call(req.body || {}, "patternKey");
    const patternKeyRaw = hasPatternKey ? req.body?.patternKey : null;
    const hasPatternCategoryId = Object.prototype.hasOwnProperty.call(req.body || {}, "patternCategoryId");
    const patternCategoryRaw = hasPatternCategoryId ? req.body?.patternCategoryId : null;

    if(!gid) return sendJson(res, 400, { ok:false, message:"missing gid" });
    if(!["consume","restock"].includes(type)) return sendJson(res, 400, { ok:false, message:"invalid type" });
    if(!items.length) return sendJson(res, 400, { ok:false, message:"empty items" });
    if(items.length > 500) return sendJson(res, 400, { ok:false, message:"too many items" });

    const normPattern = (val)=>{
      const s = (val === null || val === undefined) ? "" : String(val);
      const t = s.trim();
      return t ? t.slice(0, 64) : null;
    };
    const pattern = hasPattern ? normPattern(patternRaw) : null;
    const patternUrl = hasPatternUrl ? normPatternUrl(patternUrlRaw) : null;
    const patternKey = hasPatternKey ? normPatternKey(patternKeyRaw) : null;
    let patternCategoryId = null;
    if(type === "consume" && hasPatternCategoryId){
      const cid = parseCategoryId(patternCategoryRaw);
      if(patternCategoryRaw !== null && patternCategoryRaw !== undefined && patternCategoryRaw !== "" && !cid){
        return sendJson(res, 400, { ok:false, message:"invalid category" });
      }
      if(cid){
        const [[cat]] = await safeQuery(
          "SELECT id FROM user_pattern_categories WHERE user_id=? AND id=? LIMIT 1",
          [req.user.id, cid]
        );
        if(!cat) return sendJson(res, 400, { ok:false, message:"分类不存在" });
        patternCategoryId = cid;
      }
    }

    // Normalize items (merge same code)
    const newMap = new Map();
    for(const it of items){
      const code = String(it?.code || "").trim().toUpperCase();
      const qty = Number(it?.qty);
      if(!code) return sendJson(res, 400, { ok:false, message:"missing code" });
      if(!Number.isFinite(qty) || qty <= 0) return sendJson(res, 400, { ok:false, message:"invalid qty" });
      const n = Math.abs(Math.floor(qty));
      newMap.set(code, (newMap.get(code) || 0) + n);
    }
    const normalized = Array.from(newMap.entries()).map(([code, qty])=>({code, qty}));
    if(normalized.length === 0) return sendJson(res, 400, { ok:false, message:"empty items" });

    let whereSql = "";
    let whereParams = [];
    let batchId = null;
    let baseCreatedAt = null;
    let basePattern = null;
    let basePatternUrl = null;
    let baseSource = null;
    let basePatternKey = null;
    let basePatternCategoryId = null;
    let basePatternCategoryKey = 0;

    if(gid.startsWith("b:")){
      batchId = gid.slice(2);
      if(!batchId) return sendJson(res, 400, { ok:false, message:"invalid gid" });
      const [[base]] = await safeQuery(
        `SELECT MAX(created_at) AS created_at, MAX(pattern) AS pattern, MAX(pattern_url) AS pattern_url, MAX(pattern_key) AS pattern_key, MAX(source) AS source, MAX(pattern_category_id) AS pattern_category_id
         FROM user_history
         WHERE user_id=? AND htype=? AND batch_id=?`,
        [req.user.id, type, batchId]
      );
      if(!base || !base.created_at){
        return sendJson(res, 404, { ok:false, message:"group not found" });
      }
      baseCreatedAt = base.created_at;
      basePattern = base.pattern;
      basePatternUrl = base.pattern_url;
      baseSource = base.source;
      basePatternKey = base.pattern_key;
      basePatternCategoryId = base.pattern_category_id === null || base.pattern_category_id === undefined ? null : Number(base.pattern_category_id);
      basePatternCategoryKey = basePatternCategoryId ? Number(basePatternCategoryId) : 0;
      whereSql = " AND batch_id=? ";
      whereParams = [batchId];
    }else if(gid.startsWith("i:")){
      const anchorId = Number(gid.slice(2));
      if(!Number.isFinite(anchorId) || anchorId<=0){
        return sendJson(res, 400, { ok:false, message:"invalid gid" });
      }
      const [[base]] = await safeQuery(
        `SELECT created_at, IFNULL(pattern,'') AS patternNameKey, IFNULL(pattern_url,'') AS patternUrlKey, IFNULL(pattern_key,'') AS patternObjKey, IFNULL(source,'') AS sourceKey, IFNULL(pattern_category_id,0) AS categoryKey
         FROM user_history
         WHERE user_id=? AND id=? AND htype=? LIMIT 1`,
        [req.user.id, anchorId, type]
      );
      if(!base) return sendJson(res, 404, { ok:false, message:"group not found" });
      baseCreatedAt = base.created_at;
      basePattern = base.patternNameKey;
      basePatternUrl = base.patternUrlKey;
      baseSource = base.sourceKey;
      basePatternKey = base.patternObjKey;
      basePatternCategoryKey = Number(base.categoryKey) || 0;
      basePatternCategoryId = basePatternCategoryKey > 0 ? basePatternCategoryKey : null;
      whereSql = " AND batch_id IS NULL AND created_at=? AND IFNULL(pattern,'')=? AND IFNULL(source,'')=? AND IFNULL(pattern_category_id,0)=? ";
      whereParams = [baseCreatedAt, basePattern, baseSource, basePatternCategoryKey];
    }else{
      return sendJson(res, 400, { ok:false, message:"invalid gid" });
    }

    const [oldRows] = await safeQuery(
      `SELECT code, SUM(qty) AS qty
       FROM user_history
       WHERE user_id=? AND htype=? ${whereSql}
       GROUP BY code`,
      [req.user.id, type, ...whereParams]
    );
    if(!oldRows || oldRows.length===0){
      return sendJson(res, 404, { ok:false, message:"group not found" });
    }
    const oldMap = new Map((oldRows||[]).map(r=>[String(r.code).toUpperCase(), Number(r.qty)||0]));

    const codes = Array.from(newMap.keys());
    // Validate codes exist in palette and inventory
    if(codes.length>0){
      const inPh = codes.map(()=>"?").join(",");
      const [pRows] = await safeQuery(
        `SELECT code, is_default AS isDefault FROM palette WHERE code IN (${inPh})`,
        codes
      );
      const pMap = new Map((pRows||[]).map(r=>[String(r.code).toUpperCase(), Number(r.isDefault)]));
      for(const c of codes){
        if(!pMap.has(c)) return sendJson(res, 400, { ok:false, message:`unknown code: ${c}` });
      }

      // removed codes check
      {
        const rmPh = codes.map(()=>"?").join(",");
        const [rmRows] = await safeQuery(
          `SELECT code FROM user_removed_codes WHERE user_id=? AND code IN (${rmPh})`,
          [req.user.id, ...codes]
        );
        if(rmRows && rmRows.length>0){
          return sendJson(res, 400, { ok:false, message:"包含已删除的色号，请先在设置中重新添加色号" });
        }
      }

      const nonDefaultCodes = codes.filter(c=> pMap.get(c) === 0);
      if(nonDefaultCodes.length>0){
        const inPh2 = nonDefaultCodes.map(()=>"?").join(",");
        const [invRows] = await safeQuery(
          `SELECT code FROM user_inventory WHERE user_id=? AND code IN (${inPh2})`,
          [req.user.id, ...nonDefaultCodes]
        );
        const invSet = new Set((invRows||[]).map(r=>String(r.code).toUpperCase()));
        for(const c of nonDefaultCodes){
          if(!invSet.has(c)){
            return sendJson(res, 400, { ok:false, message:"包含未添加到库存的非默认色号，请先在设置中添加对应系列" });
          }
        }
      }
    }

    const unionCodes = Array.from(new Set([...oldMap.keys(), ...newMap.keys()]));
    const deltaEntries = [];
    for(const code of unionCodes){
      const oldQty = oldMap.get(code) || 0;
      const newQty = newMap.get(code) || 0;
      const diff = newQty - oldQty;
      if(diff === 0) continue;
      const delta = (type==="consume" ? -diff : diff);
      if(delta !== 0) deltaEntries.push({code, delta});
    }

    const finalPattern = (() => {
      const base = normPattern(basePattern);
      if(type !== "consume") return base;
      if(hasPattern) return pattern;
      return base;
    })();
    const finalPatternUrl = (() => {
      const base = normPatternUrl(basePatternUrl);
      if(type !== "consume") return base;
      if(hasPatternUrl) return patternUrl;
      return base;
    })();
    const finalPatternKey = (() => {
      const base = normPatternKey(basePatternKey);
      if(type !== "consume") return base;
      if(hasPatternKey) return patternKey;
      return base;
    })();
    const finalPatternCategoryId = (() => {
      if(type !== "consume") return null;
      if(hasPatternCategoryId) return patternCategoryId;
      return basePatternCategoryId;
    })();
    const finalSource = (() => {
      const s = (baseSource === null || baseSource === undefined) ? "" : String(baseSource);
      const t = s.trim();
      return t ? t.slice(0, 32) : null;
    })();
    const createdAt = baseCreatedAt || new Date();

    await withTransaction(async (conn)=>{
      // Ensure inventory rows for default codes
      if(codes.length>0){
        const inPh = codes.map(()=>"?").join(",");
        const params = [req.user.id, ...codes];
        await q(conn,
          `INSERT IGNORE INTO user_inventory(user_id, code, qty, hex)
           SELECT ?, p.code, 0, p.hex
           FROM palette p
           WHERE p.is_default=1 AND p.code IN (${inPh})`,
          params
        );
      }

      if(deltaEntries.length>0){
        const cases = deltaEntries.map(()=> "WHEN ? THEN ?").join(" ");
        const placeholders = deltaEntries.map(()=> "?").join(",");
        const params = [];
        for(const d of deltaEntries){
          params.push(d.code, d.delta);
        }
        params.push(req.user.id, ...deltaEntries.map(d=>d.code));
        await q(
          conn,
          `UPDATE user_inventory
           SET qty = qty + CASE code ${cases} ELSE 0 END
           WHERE user_id=? AND code IN (${placeholders})`,
          params
        );
      }

      await q(
        conn,
        `DELETE FROM user_history WHERE user_id=? AND htype=? ${whereSql}`,
        [req.user.id, type, ...whereParams]
      );

      // Preserve created_at/source so non-batch grouping keys remain stable.
      const vals = [];
      const params = [];
      for(const it of normalized){
        vals.push("(?,?,?,?,?,?,?,?,?,?,?)");
        params.push(req.user.id, it.code, type, it.qty, finalPattern, finalPatternUrl, finalPatternKey, finalPatternCategoryId, finalSource, batchId, createdAt);
      }
      await q(
        conn,
        `INSERT INTO user_history(user_id, code, htype, qty, pattern, pattern_url, pattern_key, pattern_category_id, source, batch_id, created_at)
         VALUES ${vals.join(",")}`,
        params
      );
    });

    sendJson(res, 200, { ok:true });
  }catch(e){
    sendJson(res, 500, { ok:false, message:e.message });
  }
}));

router.post("/api/recordGroupDelete", requireAuth, withHandler("recordGroupDelete", async (req, res) => {
  try{
    const gid = String(req.body?.gid || "");
    const type = String(req.body?.type || "").toLowerCase();
    if(!gid) return sendJson(res, 400, { ok:false, message:"missing gid" });
    if(!["consume","restock"].includes(type)) return sendJson(res, 400, { ok:false, message:"invalid type" });

    const applyDeltaAndDelete = async (conn, whereSql, whereParams) => {
      const [rows] = await q(
        conn,
        `SELECT code, SUM(qty) AS qty FROM user_history WHERE user_id=? AND htype=? ${whereSql} GROUP BY code`,
        [req.user.id, type, ...whereParams]
      );

      if(!rows || rows.length===0) return;

      // build delta per code
      const deltas = rows.map(r => ({
        code: String(r.code).toUpperCase(),
        delta: (type==="consume" ? 1 : -1) * (Number(r.qty)||0)
      })).filter(x => x.delta !== 0);

      if(deltas.length){
        const cases = deltas.map(()=> "WHEN ? THEN ?").join(" ");
        const placeholders = deltas.map(()=> "?").join(",");
        const params = [];
        for(const d of deltas){
          params.push(d.code, d.delta);
        }
        params.push(req.user.id, ...deltas.map(d=>d.code));

        await q(
          conn,
          `UPDATE user_inventory
           SET qty = qty + CASE code ${cases} ELSE 0 END
           WHERE user_id=? AND code IN (${placeholders})`,
          params
        );
      }

      await q(
        conn,
        `DELETE FROM user_history WHERE user_id=? AND htype=? ${whereSql}`,
        [req.user.id, type, ...whereParams]
      );
    };

    await withTransaction(async(conn)=>{
      if(gid.startsWith("b:")){
        const batchId = gid.slice(2);
        await applyDeltaAndDelete(conn, " AND batch_id=? ", [batchId]);
        return;
      }
      if(gid.startsWith("i:")){
        const anchorId = Number(gid.slice(2));
        const [[base]] = await q(
          conn,
          `SELECT created_at, IFNULL(pattern,'') AS patternKey, IFNULL(source,'') AS sourceKey, IFNULL(pattern_category_id,0) AS categoryKey
           FROM user_history
           WHERE user_id=? AND id=? AND htype=? LIMIT 1`,
          [req.user.id, anchorId, type]
        );
        if(!base) throw new Error("group not found");
        await applyDeltaAndDelete(
          conn,
          " AND batch_id IS NULL AND created_at=? AND IFNULL(pattern,'')=? AND IFNULL(source,'')=? AND IFNULL(pattern_category_id,0)=? ",
          [base.created_at, base.patternKey, base.sourceKey, Number(base.categoryKey) || 0]
        );
        return;
      }
      throw new Error("invalid gid");
    });

    sendJson(res, 200, { ok:true });
  }catch(e){
    sendJson(res, 500, { ok:false, message:e.message });
  }
}));

module.exports = router;
