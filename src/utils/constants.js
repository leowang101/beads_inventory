"use strict";

const BUILD_TAG = "beads-multi-2025-12-15";
const MAX_PATTERN_CATEGORIES = 10;

const PORT = Number(process.env.PORT || 3000);
const SERVE_FRONTEND = String(process.env.SERVE_FRONTEND || "true").toLowerCase() !== "false";

const DB_HOST = process.env.DB_HOST;
const DB_USER = process.env.DB_USER;
const DB_PASS = process.env.DB_PASS;
const DB_NAME = process.env.DB_NAME;
const DB_PORT = Number(process.env.DB_PORT || 3306);

const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || "";
const DASHSCOPE_BASE_URL = process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/api/v1";
const QWEN_VL_MODEL = process.env.QWEN_VL_MODEL || "qwen-vl-plus";

// ====== OSS (STS via ECS RAM Role) ======
const OSS_REGION = process.env.OSS_REGION || "oss-cn-beijing";
const OSS_BUCKET = process.env.OSS_BUCKET || "beads-patterns";
const OSS_UPLOAD_ENDPOINT = process.env.OSS_UPLOAD_ENDPOINT || process.env.OSS_UPLOAD_DOMAIN || "https://upload.leobeads.xyz";
const OSS_UPLOAD_CNAME = String(process.env.OSS_UPLOAD_CNAME || "true").toLowerCase() !== "false";
const OSS_CDN_BASE_URL = process.env.OSS_CDN_BASE_URL || process.env.OSS_CDN_DOMAIN || "https://img.leobeads.xyz";
const ECS_RAM_ROLE_NAME = process.env.ECS_RAM_ROLE_NAME || process.env.OSS_ROLE_NAME || "EcsOssRole";
const ECS_METADATA_BASE_URL = process.env.ECS_METADATA_BASE_URL || "http://100.100.100.200/latest/meta-data/ram/security-credentials";
const OSS_UPLOAD_PREFIX = process.env.OSS_UPLOAD_PREFIX || "patterns";

module.exports = {
  BUILD_TAG,
  MAX_PATTERN_CATEGORIES,
  PORT,
  SERVE_FRONTEND,
  DB_HOST,
  DB_USER,
  DB_PASS,
  DB_NAME,
  DB_PORT,
  DASHSCOPE_API_KEY,
  DASHSCOPE_BASE_URL,
  QWEN_VL_MODEL,
  OSS_REGION,
  OSS_BUCKET,
  OSS_UPLOAD_ENDPOINT,
  OSS_UPLOAD_CNAME,
  OSS_CDN_BASE_URL,
  ECS_RAM_ROLE_NAME,
  ECS_METADATA_BASE_URL,
  OSS_UPLOAD_PREFIX,
};
