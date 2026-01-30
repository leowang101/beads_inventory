"use strict";

const { AsyncLocalStorage } = require("async_hooks");

const requestStore = new AsyncLocalStorage();
const DEFAULT_SLOW_MS = 500;
const STACK_LINES = 10;

function _nowNs(){
  return process.hrtime.bigint();
}

function generateRequestId(){
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function getSlowThreshold(){
  const v = Number(process.env.SLOW_MS || DEFAULT_SLOW_MS);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_SLOW_MS;
}

function trackDbTime(ms){
  const store = requestStore.getStore();
  if(!store) return;
  store.dbMs += ms;
  store.dbCount += 1;
}

function withHandler(name, handler){
  return function handlerWrapper(req, res, next){
    req.handlerName = name;
    const store = requestStore.getStore();
    if(store) store.handlerName = name;
    return handler(req, res, next);
  };
}

function requestContext(req, res, next){
  const requestId = generateRequestId();
  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);

  const store = {
    requestId,
    startAt: _nowNs(),
    dbMs: 0,
    dbCount: 0,
    handlerName: "-",
    method: req.method,
    path: String(req.originalUrl || req.url || "").split("?")[0]
  };

  requestStore.run(store, () => {
    res.on("finish", () => {
      try{
        const endAt = _nowNs();
        const totalMs = Number(endAt - store.startAt) / 1e6;
        const totalMsRounded = Math.round(totalMs);
        const dbMsRounded = Math.round(store.dbMs || 0);
        const dbCount = store.dbCount || 0;
        const handlerName = store.handlerName || req.handlerName || "-";
        const userId = (req.user && (req.user.id || req.user.userId)) ? String(req.user.id || req.user.userId) : "-";
        const status = res.statusCode || 0;

        const slowMs = getSlowThreshold();
        if(totalMsRounded >= slowMs){
          console.log(
            `[SLOW] rid=${requestId} method=${store.method} path=${store.path} status=${status} total_ms=${totalMsRounded} db_ms=${dbMsRounded} db_count=${dbCount} handler=${handlerName} userId=${userId}`
          );
        }

        if(status >= 500){
          const messageRaw = (res.locals && res.locals._errorMessage) ? String(res.locals._errorMessage) : "internal_error";
          const message = messageRaw.replace(/[\r\n]+/g, " ").slice(0, 200);
          const stackRaw = (res.locals && res.locals._errorStack) ? String(res.locals._errorStack) : (new Error(messageRaw).stack || "");
          const stackTop = stackRaw.split("\n").slice(0, STACK_LINES).map(s=>s.trim()).join(" | ");
          console.error(`[ERROR] rid=${requestId} ${store.method} ${store.path} status=${status} message=${message} stackTop${STACK_LINES}=${stackTop}`);
        }
      }catch(e){
        // ignore logging errors
      }
    });
    next();
  });
}

module.exports = {
  requestContext,
  withHandler,
  trackDbTime,
};
