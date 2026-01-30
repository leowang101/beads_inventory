/**
 * 拼豆库存管理系统 - 多用户后端（Express + MySQL，可无DB降级为“仅访客本地模式”）
 */

"use strict";

try {
  require("dotenv").config({ path: require("path").join(__dirname, ".env") });
} catch (e) {
  // dotenv is optional; if not installed, ensure your process manager injects env vars.
}

const { startServer } = require("./src/server");

startServer();
