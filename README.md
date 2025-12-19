# Beads Inventory · 拼豆库存管理平台（开源版）

一个轻量但功能完整的 **拼豆（MARD 色号）库存管理 Web 应用**：按色系管理库存、快速记录补充/消耗、批量录入、阈值提醒、删除色号、重置库存，以及（登录后）支持 **MySQL 云端多用户** 与 **AI 图纸识别导入**。

- 前端：`index.html`
- 后端：`index.js`（Node.js + Express + MySQL）
- 运行模式：
  - **访客本地模式（未登录）**：库存/历史保存在浏览器 localStorage
  - **云端多用户模式（登录后）**：库存/历史保存在 MySQL，支持多设备同步

---

## 本地模式 vs 云端模式

| 能力 | 访客本地模式（未登录） | 云端模式（登录后） |
|---|---|---|
| 库存/历史存储 | 浏览器 localStorage | MySQL（多设备同步） |
| 注册/登录 | 不支持 | 支持 |
| 批量记录/防重复提交 | 支持（前端本地实现） | 支持（后端幂等） |
| 删除色号/系列管理 | 支持 | 支持（带删除记录表） |
| 重置库存 | 支持 | 支持（清空历史、移除非默认色号等） |
| AI 图纸识别导入 | 不支持 | ✅ 支持（需 DashScope Key） |

---

## 目录结构（示例）

```text
beads_inventory/
  index.html          # 前端单页
  index.js            # 后端服务（API + 可选托管前端）
  README.md
  .gitignore
  .env.example
```

---

## 快速开始

### 0）准备环境
- Node.js 建议 18+
- MySQL 8+

### 1）安装依赖
在项目根目录（与 `index.js` 同级）：

```bash
npm install
```

> 依赖以你的 `package.json` 为准。若你是手动安装，通常需要：`express`、`multer`、`mysql2`、`dotenv` 等。

### 2）创建 `.env`
从模板复制一份：

```bash
cp .env.example .env
```

然后按需填写（见下方《环境变量说明》）。

### 3）启动服务
```bash
node index.js
```

默认端口：`3000`  
健康检查：`http://127.0.0.1:3000/api/health`

> 如果你开启了静态托管（`SERVE_FRONTEND=true`），也可以直接通过服务端访问页面。

---

## 环境变量说明（.env）

建议的 `.env.example`（按你的后端 `index.js` 实际读取的变量名整理）：

```ini
# Server
PORT=3000
# 是否由后端托管前端 index.html（true/false）
SERVE_FRONTEND=true

# MySQL（不配置也能启动：但注册/登录会被拒绝，应用将以“访客本地模式”为主）
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=your_user_here
DB_PASS=your_password_here
DB_NAME=your_name_here

# DashScope（用于 AI 图纸识别；不配置则 AI 功能不可用）
DASHSCOPE_API_KEY=your_dashscope_api_key_here
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/api/v1
# 视觉模型名（默认 qwen-vl-flash）
QWEN_VL_MODEL=qwen-vl-flash
```

---

## 数据库初始化（云端模式）

当你配置好 MySQL 并启动 `index.js` 后，服务端会自动创建/确保表结构并初始化调色板（palette）。数据库表（按当前实现）包括：

- `users`：用户表
- `sessions`：登录会话
- `palette`：全局色号调色板（code/hex/series/is_default）
- `user_inventory`：用户库存（user_id + code + qty + hex）
- `user_settings`：用户设置（阈值等）
- `user_removed_codes`：用户删除过的色号（用于防止被自动补齐）
- `user_history`：补充/消耗历史记录（可带 pattern/source）

### MySQL 创建数据库（示例）
```sql
CREATE DATABASE beads_inventory DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

然后在 `.env` 里填好 `DB_HOST/DB_USER/DB_PASS/DB_NAME/DB_PORT`，重启后端即可。

---

## API 说明（后端）

所有 API 返回通常包含：
- `ok: true/false`
- `message`（失败原因）
- `data`（成功数据）

> 需要登录的接口，会校验会话（cookie 或 token，按你的实现为准）。

### 基础
- `GET /api/health`：健康检查
- `GET /api/public/palette`：获取调色板（无 DB 时会回退内置 palette）

### 用户
- `POST /api/register`：注册（**DB 未配置时会返回“服务端数据库未配置，无法注册账号”**）
- `POST /api/login`：登录（**DB 未配置时会返回“服务端数据库未配置，无法登录”**）
- `POST /api/logout`：退出登录
- `GET /api/me`：获取当前用户信息（用于前端展示用户名）

### 库存/设置/历史（登录后）
- `GET /api/all`：拉取库存全量
- `GET /api/settings` / `POST /api/settings`：获取/更新设置（如阈值）
- `POST /api/adjust`：单条补充/消耗  
  Body 示例：
  ```json
  { "code": "A1", "type": "restock", "qty": 100, "pattern": "xxx", "source": "manual" }
  ```
- `POST /api/adjustBatch`：批量补充/消耗（最大 500 条）  
  Body 示例：
  ```json
  {
    "items": [
      { "code": "A1", "type": "restock", "qty": 100 },
      { "code": "A2", "type": "consume", "qty": 20 }
    ]
  }
  ```
  幂等建议：请求头带 `x-idempotency-key`，避免重复提交。
- `GET /api/history`：拉取历史记录
- `POST /api/resetAll`：重置库存（清空历史 + 移除非默认色号等）
- `POST /api/addSeries` / `POST /api/removeSeries`：按系列添加/移除色号
- `POST /api/addColor` / `POST /api/removeColor`：单个色号添加/删除

### AI 图纸识别（登录后）
- `POST /api/recognize-pattern`：上传图纸图片，服务端调用 DashScope 视觉模型，返回结构化 JSON（用于前端导入）

---

## 生产部署建议（ECS / Linux）

### 1）用 PM2 常驻运行（推荐）
```bash
npm i -g pm2
pm2 start index.js --name beads-inventory
pm2 save
pm2 startup
```

### 2）Nginx 反代（可选）
把 `http://127.0.0.1:3000` 反代到公网域名/HTTPS。

---

## 贡献方式
欢迎提 Issue / PR：
- UI/交互优化（尤其移动端）
- 数据导入导出、统计增强
- AI 识别稳定性与提示词改进
- 部署与文档完善
