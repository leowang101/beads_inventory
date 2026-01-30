"use strict";

const mysql = require("mysql2/promise");
const { trackDbTime } = require("../utils/observability");
const {
  DB_HOST,
  DB_USER,
  DB_PASS,
  DB_NAME,
  DB_PORT,
} = require("../utils/constants");

function dbEnabled() {
  return !!(DB_HOST && DB_USER && DB_NAME);
}

let _pool = null;
function _wrapQuery(target){
  if (!target || target.__obsWrapped) return target;
  const originalQuery = target.query.bind(target);
  target.query = async (...args) => {
    const start = process.hrtime.bigint();
    try{
      return await originalQuery(...args);
    }finally{
      const end = process.hrtime.bigint();
      const ms = Number(end - start) / 1e6;
      trackDbTime(ms);
    }
  };
  target.__obsWrapped = true;
  return target;
}
function getPool() {
  if (!dbEnabled()) throw new Error("DB未配置：请设置 DB_HOST/DB_USER/DB_PASS/DB_NAME");
  if (_pool) return _pool;
  _pool = mysql.createPool({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASS,
    database: DB_NAME,
    port: DB_PORT,
    connectionLimit: 10,
    charset: "utf8mb4",
  });
  _wrapQuery(_pool);
  const originalGetConnection = _pool.getConnection.bind(_pool);
  _pool.getConnection = async (...args) => {
    const conn = await originalGetConnection(...args);
    _wrapQuery(conn);
    return conn;
  };
  return _pool;
}

async function safeQuery(sql, params) {
  const pool = getPool();
  return pool.query(sql, params);
}

async function withTransaction(fn){
  const pool = getPool();
  const conn = await pool.getConnection();
  try{
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  }catch(e){
    try{ await conn.rollback(); }catch{}
    throw e;
  }finally{
    try{ conn.release(); }catch{}
  }
}
function q(conn, sql, params){
  return conn.query(sql, params);
}

module.exports = {
  dbEnabled,
  getPool,
  safeQuery,
  withTransaction,
  q,
};
