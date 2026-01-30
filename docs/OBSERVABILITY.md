# Observability

## 日志格式（示例）
- 慢请求（stdout）：
  ```
  [SLOW] rid=ln8ks3x3v6f8l2 method=POST path=/api/adjust status=200 total_ms=742 db_ms=120 db_count=4 handler=adjust userId=123
  ```
- 错误请求（stderr）：
  ```
  [ERROR] rid=ln8ks3x3v6f8l2 POST /api/adjust status=500 message=unknown code stackTop10=Error: unknown code | at ...
  ```

## 参数说明
- `rid`：requestId（每个请求唯一，响应头 `x-request-id` 同步返回）
- `total_ms`：请求总耗时
- `db_ms`：本次请求内 DB 查询累计耗时（不含 SQL 文本）
- `db_count`：本次请求内 DB 查询次数
- `handler`：路由处理器名称（用于定位慢点）
- `userId`：登录用户 ID；未登录为 `-`

## 调整慢请求阈值
- 环境变量 `SLOW_MS`，默认 `500` 毫秒。
- 示例：
  ```bash
  SLOW_MS=200 node index.js
  ```

## 查看 PM2 日志
- `pm2 logs beads --lines 200`
- 或直接查看文件：
  - `tail -f /root/.pm2/logs/beads-out.log`
  - `tail -f /root/.pm2/logs/beads-error.log`
