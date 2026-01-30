"use strict";

const crypto = require("crypto");

function normUsername(v) {
  return String(v ?? "").trim();
}

function normPatternUrl(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return s.slice(0, 512);
}
function normPatternKey(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return s.slice(0, 512);
}

function categoryDisplayLength(v){
  let len = 0;
  const s = String(v ?? "");
  for(const ch of s){
    len += /[^\x00-\xff]/.test(ch) ? 2 : 1;
  }
  return len;
}

function normCategoryName(v){
  return String(v ?? "").trim();
}

function parseCategoryId(v){
  if(v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if(!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function normalizeTodoItems(rawItems){
  const list = Array.isArray(rawItems) ? rawItems : [];
  const map = new Map();
  for(const it of list){
    const code = String(it?.code || "").trim().toUpperCase();
    const qty = Number(it?.qty);
    if(!code) continue;
    if(!Number.isInteger(qty) || qty <= 0) continue;
    const curr = map.get(code);
    if(curr) curr.qty += qty;
    else map.set(code, {code, qty});
  }
  return Array.from(map.values());
}

function isValidUsername(username) {
  return /^[A-Za-z0-9_\-\u4e00-\u9fa5]{3,32}$/.test(String(username || ""));
}

function newSalt() {
  return crypto.randomBytes(16).toString("hex");
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(String(password), String(salt), 100000, 32, "sha256").toString("hex");
}

function newToken() {
  return crypto.randomBytes(24).toString("hex");
}

function newBatchId(){
  // 用于把一次“消耗/补充”的多条明细归为同一条记录
  return "bh_" + Date.now().toString(36) + "_" + crypto.randomBytes(6).toString("hex");
}

module.exports = {
  normUsername,
  normPatternUrl,
  normPatternKey,
  categoryDisplayLength,
  normCategoryName,
  parseCategoryId,
  normalizeTodoItems,
  isValidUsername,
  newSalt,
  hashPassword,
  newToken,
  newBatchId,
};
