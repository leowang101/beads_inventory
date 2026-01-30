"use strict";

const {
  OSS_REGION,
  OSS_BUCKET,
  OSS_UPLOAD_ENDPOINT,
  OSS_UPLOAD_CNAME,
  OSS_CDN_BASE_URL,
  ECS_RAM_ROLE_NAME,
  ECS_METADATA_BASE_URL,
  OSS_UPLOAD_PREFIX,
} = require("../utils/constants");

// ---- OSS STS (via ECS RAM Role) ----
let _ossStsCache = null; // {data:{...}, expireAt:number}

async function fetchEcsSts() {
  const base = String(ECS_METADATA_BASE_URL || "").replace(/\/+$/, "");
  const role = String(ECS_RAM_ROLE_NAME || "").trim();
  if (!base || !role) throw new Error("OSS STS 配置缺失");
  const url = `${base}/${encodeURIComponent(role)}`;
  const resp = await fetch(url, { method: "GET" });
  const raw = await resp.text();
  if (!resp.ok) {
    throw new Error(`ECS 元数据请求失败（${resp.status}）`);
  }
  let data = null;
  try { data = JSON.parse(raw); } catch {}
  if (!data || (data.Code && data.Code !== "Success")) {
    throw new Error("ECS 元数据返回异常");
  }
  const accessKeyId = data.AccessKeyId;
  const accessKeySecret = data.AccessKeySecret;
  const securityToken = data.SecurityToken;
  const expiration = data.Expiration;
  if (!accessKeyId || !accessKeySecret || !securityToken || !expiration) {
    throw new Error("ECS 元数据缺少凭证字段");
  }
  return { accessKeyId, accessKeySecret, securityToken, expiration };
}

async function getOssSts() {
  const now = Date.now();
  if (_ossStsCache && _ossStsCache.expireAt && _ossStsCache.expireAt - now > 60 * 1000) {
    return _ossStsCache.data;
  }
  const data = await fetchEcsSts();
  const expireAt = Date.parse(data.expiration) || 0;
  _ossStsCache = { data, expireAt };
  return data;
}

function buildUploadPrefix(userId) {
  const base = String(OSS_UPLOAD_PREFIX || "patterns").replace(/^\/+|\/+$/g, "");
  const uid = String(userId || "").trim();
  return uid ? `${base}/${uid}/` : `${base}/`;
}

module.exports = {
  OSS_REGION,
  OSS_BUCKET,
  OSS_UPLOAD_ENDPOINT,
  OSS_UPLOAD_CNAME,
  OSS_CDN_BASE_URL,
  getOssSts,
  buildUploadPrefix,
};
