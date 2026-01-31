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

router.post("/api/workPublish", requireAuth, withHandler("workPublish", async (req, res) => {
  try{
    const gid = String(req.body?.gid || "");
    const type = String(req.body?.type || "consume").toLowerCase();
    const imageUrl = String(req.body?.imageUrl || req.body?.image_url || "").trim();
    const imageKey = normText(req.body?.imageKey || req.body?.image_key || "", 512);
    const duration = normText(req.body?.duration, 32);
    const note = normText(req.body?.note, 256);
    const finishedAt = normFinishedAt(req.body?.finishedAt || req.body?.finished_at);

    if(!gid) return sendJson(res, 400, { ok:false, message:"missing gid" });
    if(type !== "consume") return sendJson(res, 400, { ok:false, message:"invalid type" });
    if(!imageUrl) return sendJson(res, 400, { ok:false, message:"missing image" });
    if(imageUrl.length > 512) return sendJson(res, 400, { ok:false, message:"image url too long" });

    const ok = await ensureGroupExists(req.user.id, gid, type);
    if(!ok) return sendJson(res, 404, { ok:false, message:"group not found" });

    await safeQuery(
      `INSERT INTO user_works(user_id, record_gid, record_type, image_url, image_key, duration, note, finished_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE image_url=VALUES(image_url), image_key=VALUES(image_key),
         duration=VALUES(duration), note=VALUES(note), finished_at=VALUES(finished_at)`,
      [req.user.id, gid, type, imageUrl, imageKey, duration, note, finishedAt]
    );

    sendJson(res, 200, { ok:true, buildTag: BUILD_TAG });
  }catch(e){
    sendJson(res, 500, { ok:false, message:e.message });
  }
}));

module.exports = router;
