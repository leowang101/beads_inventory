# Beads Inventory · 拼豆库存管理平台（开源版）

一个面向拼豆（MARD 色号）的库存管理 Web 应用：支持库存管理、记录消耗/补充、批量导入、历史统计、分组记录编辑、导出备份，以及（登录后）云端同步与 AI 图纸识别。

---

## 功能亮点

- 访客本地模式：无需登录，库存与记录保存在浏览器 localStorage
- 云端多用户：登录后库存/历史/设置存储于 MySQL，多设备同步
- 记录能力：单条/批量补充或消耗、CSV 导入、记录分组查看与编辑
- 统计能力：色号消耗统计、库存告急阈值提醒
- 色号管理：按系列添加/移除色号，单个色号添加/删除
- AI 图纸识别（登录后）：上传图纸图片自动识别色号与数量

---

## 运行模式对比

| 能力 | 访客本地模式（未登录） | 云端模式（登录后） |
|---|---|---|
| 库存/历史存储 | 浏览器 localStorage | MySQL（多设备同步） |
| 注册/登录 | 不支持 | 支持 |
| 批量记录/幂等 | 前端本地实现 | 后端幂等（`x-idempotency-key`） |
| 删除色号/系列管理 | 支持 | 支持 |
| AI 图纸识别 | 不支持 | 支持（需 DashScope Key） |

---

## 技术栈

- 前端：`public/index.html`（单页，原生 HTML/CSS/JS）
- 后端：`index.js`（Node.js + Express + MySQL）

---

## 目录结构

```text
beads_inventory/
  index.js
  public/
    index.html
  README.md
  package.json
```

---

## 快速开始

### 1）安装依赖

```bash
npm install
```

### 2）创建并配置 `.env`（可选）

本项目未内置 `.env.example`，请按需手动创建：

```ini
# Server
PORT=3000
# 是否由后端托管前端（true/false）
SERVE_FRONTEND=true

# MySQL（不配置也能启动：仅访客模式 + public 接口可用）
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=your_user_here
DB_PASS=your_password_here
DB_NAME=your_db_name

# DashScope（AI 图纸识别）
DASHSCOPE_API_KEY=your_dashscope_api_key_here
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/api/v1
# 默认模型名
QWEN_VL_MODEL=qwen-vl-plus
```

### 3）启动服务

```bash
npm run dev
# 或
npm start
```

默认地址：`http://127.0.0.1:3000`

> 若 `SERVE_FRONTEND=false`，请自行使用静态服务器托管 `public/`，否则直接访问 `file://` 会因为 `origin` 为 `null` 导致 API 请求异常。

---

## 数据库初始化（云端模式）

服务启动后会自动创建/确保表结构并初始化调色板（palette）。建议先手动创建数据库：

```sql
CREATE DATABASE beads_inventory DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

表结构（自动创建）：
- `users`
- `sessions`
- `palette`
- `user_inventory`
- `user_settings`
- `user_removed_codes`
- `user_history`

> 若 MySQL 未配置完整，注册/登录接口会返回“服务端数据库未配置”。

---

## 认证方式

- 登录成功后返回 `token`
- 访问需要登录的接口时，使用 Header：`Authorization: Bearer <token>`

---

## API 速览

公共接口：
- `GET /api/health`：健康检查
- `GET /api/public/palette`：获取调色板（无 DB 时自动回退）

用户相关：
- `POST /api/register`
- `POST /api/login`
- `POST /api/logout`
- `GET /api/me`

库存与设置：
- `GET /api/all`：获取库存全量
- `GET /api/settings` / `POST /api/settings`：阈值设置
- `POST /api/adjust`：单条补充/消耗
- `POST /api/adjustBatch`：批量补充/消耗（最大 500 条，支持 `x-idempotency-key`）
- `POST /api/resetAll`：重置库存（清空历史 + 移除非默认色号）

记录与统计：
- `GET /api/history?code=F11&limit=100`
- `GET /api/consumeStats`：按色号汇总消耗
- `GET /api/recordGroups?type=consume&onlyWithPattern=1`
- `GET /api/recordGroupDetail?gid=...&type=consume`
- `POST /api/recordGroupUpdate`
- `POST /api/recordGroupDelete`

色号与系列：
- `POST /api/addSeries` / `POST /api/removeSeries`
- `POST /api/addColor` / `POST /api/removeColor`

AI 图纸识别：
- `POST /api/recognize-pattern`：`multipart/form-data`，字段 `image`（必填）和 `pattern`（可选）

---

## CSV 导入/导出（前端）

- 消耗/补充页支持 CSV 文件导入
- CSV 基本格式：第一列色号、第二列数量（其余列会被忽略）
- 可在设置页导出库存 CSV 以备份

---

## 常见问题

- **无法注册/登录**：请检查 `.env` 中 MySQL 配置是否完整。
- **AI 识别不可用**：需要登录 + 配置 `DASHSCOPE_API_KEY`。
- **访客模式数据丢失**：本地模式依赖浏览器存储，清理缓存会丢失数据，请定期导出备份。

---

## 贡献方式

欢迎提 Issue / PR：
- UI/交互优化（尤其移动端）
- 导入/导出和统计增强
- AI 识别稳定性与提示词改进
- 部署与文档完善
