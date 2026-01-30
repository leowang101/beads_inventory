"use strict";

function sendJson(res, status, obj) {
  if (status >= 500) {
    try {
      res.locals = res.locals || {};
      if (obj && typeof obj.message !== "undefined") {
        res.locals._errorMessage = String(obj.message);
      }
      if (obj && typeof obj.stack !== "undefined") {
        res.locals._errorStack = String(obj.stack);
      }
    } catch {}
  }
  res.status(status).json(obj);
}

function withCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type,authorization");
}

module.exports = {
  sendJson,
  withCors,
};
