"use strict";

const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { sendJson } = require("../utils/respond");
const { safeQuery } = require("../db/pool");
const { withHandler } = require("../utils/observability");
const { BUILD_TAG } = require("../utils/constants");

const router = express.Router();

function normText(val, maxLen){
  if(val === null || val === undefined) return null;
  const s = String(val).trim();
  if(!s) return null;
  return s.slice(0, maxLen);
}

function normDurationMinutes(val){
  if(val === null || val === undefined) return null;
  const n = Number(val);
  if(!Number.isFinite(n)) return null;
  const v = Math.floor(n);
  if(v < 1 || v > 240 * 60) return null;
  return v;
}

function normFinishedAt(val){
  if(val === null || val === undefined) return null;
  const s = String(val).trim();
  if(!s) return null;
  if(s.length > 32) return null;
  let normalized = s.replace("T", " ");
  if(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(normalized)){
    normalized = `${normalized}:00`;
  }
  if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(normalized)){
    return null;
  }
  return normalized;
}

function parseCursor(cursor){
  if(!cursor) return null;
  const raw = String(cursor).trim();
  if(!raw) return null;
  const [tsRaw, idRaw] = raw.split(":");
  const ts = Number(tsRaw);
  const id = Number(idRaw);
  if(!Number.isFinite(ts) || !Number.isFinite(id)) return null;
  return { ts, id };
}

function parsePositiveInt(val){
  const n = Number(val);
  if(!Number.isFinite(n)) return null;
  const v = Math.floor(n);
  if(v <= 0) return null;
  return v;
}

async function ensureGroupExists(userId, gid, type){
  if(gid.startsWith("b:")){
    const batchId = gid.slice(2);
    if(!batchId) return false;
    const [[row]] = await safeQuery(
      "SELECT id FROM user_history WHERE user_id=? AND htype=? AND batch_id=? LIMIT 1",
      [userId, type, batchId]
    );
    return !!row;
  }
  if(gid.startsWith("i:")){
    const anchorId = Number(gid.slice(2));
    if(!Number.isFinite(anchorId) || anchorId <= 0) return false;
    const [[row]] = await safeQuery(
      "SELECT id FROM user_history WHERE user_id=? AND htype=? AND id=? LIMIT 1",
      [userId, type, anchorId]
    );
    return !!row;
  }
  return false;
}

function buildGroupJoinSql(){
  return `
    (
      SELECT
        CONCAT('b:', batch_id) AS gid,
        MIN(created_at) AS group_time,
        MAX(pattern) AS pattern,
        MAX(pattern_url) AS patternUrl,
        MAX(pattern_category_id) AS patternCategoryId,
        SUM(qty) AS total
      FROM user_history
      WHERE user_id=? AND htype='consume' AND batch_id IS NOT NULL
      GROUP BY batch_id

      UNION ALL

      SELECT
        CONCAT('i:', MIN(id)) AS gid,
        MIN(created_at) AS group_time,
        MAX(pattern) AS pattern,
        MAX(pattern_url) AS patternUrl,
        MAX(pattern_category_id) AS patternCategoryId,
        SUM(qty) AS total
      FROM user_history
      WHERE user_id=? AND htype='consume' AND batch_id IS NULL
      GROUP BY created_at, IFNULL(pattern,''), IFNULL(source,''), IFNULL(pattern_category_id,0)
    ) g
  `;
}

router.post("/api/workPublish", requireAuth, withHandler("workPublish", async (req, res) => {
  try{
    const gid = String(req.body?.gid || "");
    const type = String(req.body?.type || "consume").toLowerCase();
    const imageUrl = String(req.body?.imageUrl || req.body?.image_url || "").trim();
    const imageKey = normText(req.body?.imageKey || req.body?.image_key || "", 512);
    const duration = normText(req.body?.duration, 32);
    const durationMinutes = normDurationMinutes(req.body?.durationMinutes || req.body?.duration_minutes);
    const note = normText(req.body?.note, 256);
    const finishedAt = normFinishedAt(req.body?.finishedAt || req.body?.finished_at);

    if(!gid) return sendJson(res, 400, { ok:false, message:"missing gid" });
    if(type !== "consume") return sendJson(res, 400, { ok:false, message:"invalid type" });
    if(!imageUrl) return sendJson(res, 400, { ok:false, message:"missing image" });
    if(imageUrl.length > 512) return sendJson(res, 400, { ok:false, message:"image url too long" });

    const ok = await ensureGroupExists(req.user.id, gid, type);
    if(!ok) return sendJson(res, 404, { ok:false, message:"group not found" });

    await safeQuery(
      `INSERT INTO user_works(user_id, record_gid, record_type, image_url, image_key, duration, duration_minutes, note, finished_at)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE image_url=VALUES(image_url), image_key=VALUES(image_key),
         duration=VALUES(duration), duration_minutes=VALUES(duration_minutes),
         note=VALUES(note), finished_at=VALUES(finished_at)`,
      [req.user.id, gid, type, imageUrl, imageKey, duration, durationMinutes, note, finishedAt]
    );

    sendJson(res, 200, { ok:true, buildTag: BUILD_TAG });
  }catch(e){
    sendJson(res, 500, { ok:false, message:e.message });
  }
}));

router.get("/api/works", requireAuth, withHandler("worksList", async (req, res) => {
  try{
    const limitRaw = parsePositiveInt(req.query?.limit);
    const limit = Math.min(Math.max(limitRaw || 30, 1), 100);
    const cursor = parseCursor(req.query?.cursor);
    const categoryId = parsePositiveInt(req.query?.patternCategoryId);

    const groupSql = buildGroupJoinSql();
    const params = [req.user.id, req.user.id, req.user.id];
    let sql = `
      SELECT
        w.id AS workId,
        w.record_gid AS gid,
        w.image_url AS imageUrl,
        w.image_key AS imageKey,
        w.duration,
        w.duration_minutes AS durationMinutes,
        w.note,
        w.finished_at AS finishedAt,
        w.created_at AS createdAt,
        g.pattern,
        g.patternUrl,
        g.patternCategoryId,
        g.total,
        UNIX_TIMESTAMP(COALESCE(w.finished_at, w.created_at))*1000 AS ts
      FROM user_works w
      JOIN ${groupSql} ON g.gid = w.record_gid
      WHERE w.user_id=? AND w.record_type='consume'
    `;
    if(categoryId){
      sql += " AND g.patternCategoryId=? ";
      params.push(categoryId);
    }
    if(cursor){
      sql += ` AND (
        COALESCE(w.finished_at, w.created_at) < FROM_UNIXTIME(?/1000)
        OR (COALESCE(w.finished_at, w.created_at) = FROM_UNIXTIME(?/1000) AND w.id < ?)
      ) `;
      params.push(cursor.ts, cursor.ts, cursor.id);
    }
    sql += " ORDER BY COALESCE(w.finished_at, w.created_at) DESC, w.id DESC ";
    sql += " LIMIT ? ";
    params.push(limit + 1);

    const [rows] = await safeQuery(sql, params);
    const list = Array.isArray(rows) ? rows : [];
    let hasMore = false;
    let trimmed = list;
    if(list.length > limit){
      hasMore = true;
      trimmed = list.slice(0, limit);
    }
    const nextCursor = (() => {
      if(trimmed.length === 0) return null;
      const last = trimmed[trimmed.length - 1];
      return `${last.ts}:${last.workId}`;
    })();
    sendJson(res, 200, { ok:true, data: trimmed, hasMore, nextCursor, buildTag: BUILD_TAG });
  }catch(e){
    sendJson(res, 500, { ok:false, message:e.message });
  }
}));

router.get("/api/worksSummary", requireAuth, withHandler("worksSummary", async (req, res) => {
  try{
    const categoryId = parsePositiveInt(req.query?.patternCategoryId);
    const groupSql = buildGroupJoinSql();
    const params = [req.user.id, req.user.id, req.user.id];
    let sql = `
      SELECT
        COUNT(*) AS totalCount,
        COALESCE(SUM(g.total), 0) AS totalConsume,
        COALESCE(SUM(w.duration_minutes), 0) AS totalDurationMinutes
      FROM user_works w
      JOIN ${groupSql} ON g.gid = w.record_gid
      WHERE w.user_id=? AND w.record_type='consume'
    `;
    if(categoryId){
      sql += " AND g.patternCategoryId=? ";
      params.push(categoryId);
    }
    const [[row]] = await safeQuery(sql, params);
    sendJson(res, 200, { ok:true, data: row || { totalCount: 0, totalConsume: 0, totalDurationMinutes: 0 }, buildTag: BUILD_TAG });
  }catch(e){
    sendJson(res, 500, { ok:false, message:e.message });
  }
}));

router.post("/api/workUpdate", requireAuth, withHandler("workUpdate", async (req, res) => {
  try{
    const workId = parsePositiveInt(req.body?.workId || req.body?.id);
    if(!workId) return sendJson(res, 400, { ok:false, message:"missing workId" });

    const updates = [];
    const params = [];

    const hasImage = Object.prototype.hasOwnProperty.call(req.body || {}, "imageUrl")
      || Object.prototype.hasOwnProperty.call(req.body || {}, "image_url");
    if(hasImage){
      const imageUrl = String(req.body?.imageUrl || req.body?.image_url || "").trim();
      if(!imageUrl) return sendJson(res, 400, { ok:false, message:"missing image" });
      if(imageUrl.length > 512) return sendJson(res, 400, { ok:false, message:"image url too long" });
      const imageKey = normText(req.body?.imageKey || req.body?.image_key || "", 512);
      updates.push("image_url=?", "image_key=?");
      params.push(imageUrl, imageKey);
    }

    const hasDuration = Object.prototype.hasOwnProperty.call(req.body || {}, "durationMinutes")
      || Object.prototype.hasOwnProperty.call(req.body || {}, "duration_minutes")
      || Object.prototype.hasOwnProperty.call(req.body || {}, "duration");
    if(hasDuration){
      const durationMinutes = normDurationMinutes(req.body?.durationMinutes || req.body?.duration_minutes);
      if(!durationMinutes) return sendJson(res, 400, { ok:false, message:"invalid duration" });
      const duration = normText(req.body?.duration, 32);
      updates.push("duration=?", "duration_minutes=?");
      params.push(duration, durationMinutes);
    }

    if(Object.prototype.hasOwnProperty.call(req.body || {}, "note")){
      const note = normText(req.body?.note, 256);
      updates.push("note=?");
      params.push(note);
    }

    if(Object.prototype.hasOwnProperty.call(req.body || {}, "finishedAt")
      || Object.prototype.hasOwnProperty.call(req.body || {}, "finished_at")){
      const finishedAt = normFinishedAt(req.body?.finishedAt || req.body?.finished_at);
      updates.push("finished_at=?");
      params.push(finishedAt);
    }

    if(updates.length === 0){
      return sendJson(res, 200, { ok:true, buildTag: BUILD_TAG });
    }

    params.push(workId, req.user.id);
    const [result] = await safeQuery(
      `UPDATE user_works SET ${updates.join(", ")} WHERE id=? AND user_id=?`,
      params
    );
    if(!result || result.affectedRows === 0){
      return sendJson(res, 404, { ok:false, message:"work not found" });
    }
    sendJson(res, 200, { ok:true, buildTag: BUILD_TAG });
  }catch(e){
    sendJson(res, 500, { ok:false, message:e.message });
  }
}));

router.post("/api/workDelete", requireAuth, withHandler("workDelete", async (req, res) => {
  try{
    const workId = parsePositiveInt(req.body?.workId || req.body?.id);
    if(!workId) return sendJson(res, 400, { ok:false, message:"missing workId" });
    const [result] = await safeQuery(
      "DELETE FROM user_works WHERE id=? AND user_id=? LIMIT 1",
      [workId, req.user.id]
    );
    if(!result || result.affectedRows === 0){
      return sendJson(res, 404, { ok:false, message:"work not found" });
    }
    sendJson(res, 200, { ok:true, buildTag: BUILD_TAG });
  }catch(e){
    sendJson(res, 500, { ok:false, message:e.message });
  }
}));

module.exports = router;
