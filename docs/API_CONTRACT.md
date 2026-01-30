# API Contract

> 说明：本文档来自 `index.js` 现有实现，仅用于回归与重构前的行为冻结。

## 通用约定
- Base URL: `http://127.0.0.1:${PORT}`（由服务端 `PORT` 环境变量决定）
- 内容类型：除文件上传外，全部为 `application/json`
- 鉴权：登录后使用 `Authorization: Bearer <token>`
- 统一错误结构（大多数接口）：
  - `{"ok": false, "message": "..."}`
- 401 未登录/过期：`{"ok": false, "message": "请先登录"}` 或 `"登录已失效，请重新登录"`
- `buildTag` 字段仅在部分接口中出现

---

## 公共接口

### GET /api/health
- 鉴权：无
- 入参：无
- 返回示例（200）
```json
{
  "ok": true,
  "buildTag": "beads-multi-2025-12-15",
  "ts": "2025-12-15T12:34:56.789Z"
}
```
- 状态码：`200`

### GET /api/public/palette
- 鉴权：无
- 入参：无
- 返回示例（200）
```json
{
  "ok": true,
  "data": [
    { "code": "A1", "hex": "#FAF5CD", "series": "A系列", "isDefault": 1 }
  ],
  "buildTag": "beads-multi-2025-12-15",
  "fallback": false
}
```
- 说明：即使 DB 不可用，也会返回内置色号列表并带 `fallback: true`
- 状态码：`200`

---

## OSS/STS

### GET /api/oss/sts
- 鉴权：需要（Bearer Token）
- 入参：无
- 返回示例（200）
```json
{
  "ok": true,
  "data": {
    "region": "oss-cn-beijing",
    "bucket": "beads-patterns",
    "endpoint": "https://upload.leobeads.xyz",
    "cname": true,
    "secure": true,
    "accessKeyId": "STS.xxxxx",
    "accessKeySecret": "xxxx",
    "securityToken": "xxxx",
    "expiration": "2026-01-30T12:00:00Z",
    "uploadPrefix": "patterns/123/",
    "cdnBaseUrl": "https://img.leobeads.xyz"
  }
}
```
- 状态码：`200` / `401` / `502`

---

## 认证

### GET /api/me
- 鉴权：需要
- 入参：无
- 返回示例（200）
```json
{
  "ok": true,
  "username": "alice",
  "buildTag": "beads-multi-2025-12-15"
}
```
- 状态码：`200` / `401`

### POST /api/register
- 鉴权：无
- 入参（JSON）
  - `username`（必填，3~32 位：中英文/数字/下划线/短横线）
  - `password`（必填，>=6）
  - `confirmPassword`（必填；也接受 `password2`）
- 返回示例（200）
```json
{
  "ok": true,
  "token": "<token>",
  "username": "alice",
  "buildTag": "beads-multi-2025-12-15"
}
```
- 状态码：`200` / `400` / `500`
  - DB 未配置会返回 500

### POST /api/login
- 鉴权：无
- 入参（JSON）
  - `username`（必填）
  - `password`（必填）
- 返回示例（200）
```json
{
  "ok": true,
  "token": "<token>",
  "username": "alice",
  "buildTag": "beads-multi-2025-12-15"
}
```
- 状态码：`200` / `400` / `500`

### POST /api/logout
- 鉴权：需要
- 入参：无
- 返回示例（200）
```json
{ "ok": true }
```
- 状态码：`200` / `401` / `500`

---

## 库存 & 设置

### GET /api/all
- 鉴权：需要
- 入参：无
- 返回示例（200）
```json
{
  "ok": true,
  "data": [
    { "code": "A1", "hex": "#FAF5CD", "qty": 0, "series": "A系列", "isDefault": 1 }
  ],
  "buildTag": "beads-multi-2025-12-15"
}
```
- 状态码：`200` / `401` / `500`

### GET /api/settings
- 鉴权：需要
- 入参：无
- 返回示例（200）
```json
{
  "ok": true,
  "criticalThreshold": 300,
  "buildTag": "beads-multi-2025-12-15"
}
```
- 状态码：`200` / `401` / `500`

### POST /api/settings
- 鉴权：需要
- 入参（JSON）
  - `criticalThreshold`（必填，正整数）
- 返回示例（200）
```json
{ "ok": true, "criticalThreshold": 300 }
```
- 状态码：`200` / `400` / `401` / `500`

---

## 图纸分类

### GET /api/patternCategories
- 鉴权：需要
- 入参：无
- 返回示例（200）
```json
{
  "ok": true,
  "data": [
    { "id": 1, "name": "可爱", "createdAt": "2026-01-01T00:00:00.000Z" }
  ]
}
```
- 状态码：`200` / `401` / `500`

### POST /api/patternCategories
- 鉴权：需要
- 入参（JSON）
  - `name`（必填；最多 6 个中文或 12 个英文）
- 返回示例（200）
```json
{ "ok": true, "id": 1, "name": "可爱" }
```
- 状态码：`200` / `400` / `401` / `500`

### POST /api/patternCategoryDelete
- 鉴权：需要
- 入参（JSON）
  - `id`（必填，正整数）
- 返回示例（200）
```json
{ "ok": true }
```
- 状态码：`200` / `400` / `401` / `404` / `500`

### POST /api/patternCategoryUpdate
- 鉴权：需要
- 入参（JSON）
  - `id`（必填，正整数）
  - `name`（必填；最多 6 个中文或 12 个英文）
- 返回示例（200）
```json
{ "ok": true }
```
- 状态码：`200` / `400` / `401` / `404` / `500`

---

## 待拼图纸（Todo Patterns）

### POST /api/todoPatternAdd
- 鉴权：需要
- 入参（JSON）
  - `pattern`（可选，<=64 字符）
  - `patternUrl`（必填，<=512）
  - `patternKey`（可选，<=512）
  - `patternCategoryId`（可选，正整数；需存在）
  - `items`（必填，数组，1~500）
    - `code`（必填，色号）
    - `qty`（必填，正整数）
- 返回示例（200）
```json
{ "ok": true, "id": 123 }
```
- 状态码：`200` / `400` / `401` / `500`

### GET /api/todoPatterns
- 鉴权：需要
- 入参（Query）
  - `patternCategoryId`（可选，正整数）
- 返回示例（200）
```json
{
  "ok": true,
  "data": [
    {
      "id": 123,
      "ts": 1735689600000,
      "pattern": "小猫",
      "patternUrl": "https://example.com/p.png",
      "patternKey": "oss/key.png",
      "patternCategoryId": 1,
      "total": 256
    }
  ]
}
```
- 状态码：`200` / `400` / `401` / `500`

### GET /api/todoPatternDetail
- 鉴权：需要
- 入参（Query）
  - `id`（必填，正整数）
- 返回示例（200）
```json
{
  "ok": true,
  "data": [
    { "code": "A1", "qty": 12 }
  ]
}
```
- 状态码：`200` / `400` / `401` / `404` / `500`

### POST /api/todoPatternUpdate
- 鉴权：需要
- 入参（JSON）
  - `id`（必填，正整数）
  - `pattern`（可选，<=64）
  - `patternUrl`（可选；若不传则沿用旧值）
  - `patternKey`（可选；若不传则沿用旧值）
  - `patternCategoryId`（可选，正整数；需存在）
  - `items`（必填，数组，1~500）
- 返回示例（200）
```json
{ "ok": true }
```
- 状态码：`200` / `400` / `401` / `404` / `500`

### POST /api/todoPatternDelete
- 鉴权：需要
- 入参（JSON）
  - `id`（必填，正整数）
- 返回示例（200）
```json
{ "ok": true }
```
- 状态码：`200` / `400` / `401` / `500`

### POST /api/todoPatternComplete
- 鉴权：需要
- 入参（JSON）
  - `id`（必填，正整数）
- 返回示例（200）
```json
{ "ok": true }
```
- 状态码：`200` / `400` / `401` / `404` / `500`

---

## 库存调整

### POST /api/adjust
- 鉴权：需要
- 入参（JSON）
  - `code`（必填，色号）
  - `type`（必填：`consume` | `restock`）
  - `qty`（必填，>0 数值）
  - `pattern`（可选，<=64，仅在 `consume` 时入库）
  - `patternUrl`（可选，<=512，仅在 `consume` 时入库）
  - `patternKey`（可选，<=512，仅在 `consume` 时入库）
  - `patternCategoryId`（可选，正整数，仅 `consume` 生效）
  - `source`（可选，<=32）
- 返回示例（200）
```json
{ "ok": true }
```
- 状态码：`200` / `400` / `401` / `500`

### POST /api/resetAll
- 鉴权：需要
- 入参：无
- 返回示例（200）
```json
{ "ok": true }
```
- 状态码：`200` / `401` / `500`

### POST /api/adjustBatch
- 鉴权：需要
- 额外头：`x-idempotency-key`（可选，<=128；2 分钟内重复返回相同结果）
- 入参（JSON）
  - `type`（可选，作为 items 默认值）
  - `pattern`（可选，<=64，默认值）
  - `patternUrl`（可选，<=512，默认值）
  - `patternKey`（可选，<=512，默认值）
  - `patternCategoryId`（可选，正整数，默认值）
  - `source`（可选，<=32，默认值）
  - `items`（必填，数组，1~500）
    - `code`（必填）
    - `qty`（必填，>0）
    - `type`（可选，覆盖默认值）
    - `pattern` / `patternUrl` / `patternKey` / `patternCategoryId` / `source`（可选，覆盖默认值）
- 返回示例（200）
```json
{ "ok": true }
```
- 状态码：`200` / `400` / `401` / `500`

---

## 历史记录与统计

### GET /api/history
- 鉴权：需要
- 入参（Query）
  - `code`（必填，色号）
  - `limit`（可选，1~200，默认 100）
- 返回示例（200）
```json
{
  "ok": true,
  "remain": 12,
  "totalConsume": 8,
  "totalRestock": 20,
  "data": [
    {
      "ts": 1735689600000,
      "type": "restock",
      "qty": 5,
      "pattern": null,
      "patternUrl": null,
      "patternKey": null,
      "source": "manual"
    }
  ],
  "buildTag": "beads-multi-2025-12-15"
}
```
- 状态码：`200` / `400` / `401` / `500`

### GET /api/consumeStats
- 鉴权：需要
- 入参：无
- 返回示例（200）
```json
{
  "ok": true,
  "data": [
    { "code": "A1", "qty": 128, "hex": "#FAF5CD" }
  ],
  "buildTag": "beads-multi-2025-12-15"
}
```
- 状态码：`200` / `401` / `500`

---

## 记录分组（批次视图）

### GET /api/recordGroups
- 鉴权：需要
- 入参（Query）
  - `type`（必填：`consume` | `restock`）
  - `onlyWithPattern`（可选，`1` 表示只返回有 pattern 的记录；仅 `consume`）
  - `patternCategoryId`（可选，正整数；仅 `consume`）
  - `limit`（可选，启用分页时 1~200；默认 30）
  - `cursor`（可选，格式 `ts:maxId`，用于游标分页）
- 返回示例（200）
```json
{
  "ok": true,
  "data": [
    {
      "gid": "b:20260101_abcdef",
      "ts": 1735689600000,
      "pattern": "小猫",
      "patternUrl": "https://example.com/p.png",
      "patternKey": "oss/key.png",
      "patternCategoryId": 1,
      "total": 256
    }
  ],
  "buildTag": "beads-multi-2025-12-15",
  "hasMore": true,
  "nextCursor": "1735689600000:12345"
}
```
- 说明：
  - 仅当传入 `limit` 或 `cursor` 时启用分页，并返回 `hasMore` / `nextCursor`
  - 未传分页参数时保持旧行为：返回全量 `data`，不包含 `hasMore` / `nextCursor`
- 状态码：`200` / `400` / `401` / `500`

### GET /api/recordGroupDetail
- 鉴权：需要
- 入参（Query）
  - `gid`（必填：`b:<batchId>` 或 `i:<id>`）
  - `type`（必填：`consume` | `restock`）
- 返回示例（200）
```json
{
  "ok": true,
  "data": [
    { "code": "A1", "qty": 12, "hex": "#FAF5CD" }
  ],
  "buildTag": "beads-multi-2025-12-15"
}
```
- 状态码：`200` / `400` / `401` / `404` / `500`

### POST /api/recordGroupUpdate
- 鉴权：需要
- 入参（JSON）
  - `gid`（必填：`b:<batchId>` 或 `i:<id>`）
  - `type`（必填：`consume` | `restock`）
  - `items`（必填，数组，1~500）
    - `code`（必填）
    - `qty`（必填，>0）
  - `pattern` / `patternUrl` / `patternKey` / `patternCategoryId`（可选，仅 `consume`）
- 返回示例（200）
```json
{ "ok": true }
```
- 状态码：`200` / `400` / `401` / `404` / `500`

### POST /api/recordGroupDelete
- 鉴权：需要
- 入参（JSON）
  - `gid`（必填：`b:<batchId>` 或 `i:<id>`）
  - `type`（必填：`consume` | `restock`）
- 返回示例（200）
```json
{ "ok": true }
```
- 状态码：`200` / `400` / `401` / `500`

---

## 非默认系列/色号管理

### POST /api/addSeries
- 鉴权：需要
- 入参（JSON）
  - `series`（必填；必须是非默认系列。可通过 `/api/public/palette` 中 `isDefault=0` 取到）
- 返回示例（200）
```json
{ "ok": true }
```
- 状态码：`200` / `400` / `401` / `500`

### POST /api/removeSeries
- 鉴权：需要
- 入参（JSON）
  - `series`（必填；必须是非默认系列）
- 返回示例（200）
```json
{ "ok": true }
```
- 状态码：`200` / `400` / `401` / `500`

### POST /api/addColor
- 鉴权：需要
- 入参（JSON）
  - `code`（必填；必须是 palette 中存在的色号）
- 返回示例（200）
```json
{ "ok": true }
```
- 状态码：`200` / `400` / `401` / `500`

### POST /api/removeColor
- 鉴权：需要
- 入参（JSON）
  - `code`（必填；必须是 palette 中存在的色号）
- 返回示例（200）
```json
{ "ok": true }
```
- 状态码：`200` / `400` / `401` / `500`

---

## AI 识别

### POST /api/recognize-pattern
- 鉴权：需要
- 入参（multipart/form-data）
  - `image`（必填，文件字段名固定为 `image`）
  - `pattern`（可选，<=64）
- 返回示例（200）
```json
{
  "ok": true,
  "items": [
    { "code": "A1", "qty": 120, "confidence": 0.95 }
  ],
  "buildTag": "beads-multi-2025-12-15"
}
```
- 状态码：`200` / `400` / `401` / `500` / `502`
  - `500`：`DASHSCOPE_API_KEY` 未配置
  - `502`：模型调用失败
