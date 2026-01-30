# Beads Inventory · 拼豆库存管理平台（开源版）

面向拼豆（MARD 色号）的库存管理 Web 应用：支持库存管理、消耗/补充记录、批量导入、历史统计、分组记录编辑、导出备份，以及（登录后）云端同步与 AI 图纸识别。

---

## 项目结构概览

- **前端**：`public/`（`index.html` + `app.js` + `styles.css`，原生 HTML/CSS/JS）
- **后端**：`index.js` 作为启动入口，应用代码拆分在 `src/` 内

关键目录：

```
beads_inventory/
  index.js                # 启动入口
  src/                    # 后端逻辑
    server.js
    routes/
    db/
    middleware/
    services/
    utils/
  public/                 # 前端静态资源
    index.html
    app.js
    styles.css
  scripts/
    smoke.sh              # 冒烟脚本
  docs/                   # 项目文档
```

---

## 本地运行

### 1）安装依赖

```bash
npm install
```

### 2）配置环境变量

复制 `.env.example` 并按需填写：

```bash
cp .env.example .env
```

> 注意：`.env` 包含敏感信息，不应提交到仓库。

### 3）启动服务

```bash
# 开发模式（自动重载）
npm run dev

# 或生产模式
npm start
```

默认地址：`http://127.0.0.1:3000`

`SERVE_FRONTEND=true` 时后端会托管前端静态文件；否则请自行托管 `public/`。

---

## 环境变量说明

详见 `.env.example`。常用变量：

- **Server**
  - `PORT`：服务端口
  - `SERVE_FRONTEND`：是否托管前端
- **MySQL**
  - `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASS` / `DB_NAME`
- **DashScope/Qwen**
  - `DASHSCOPE_API_KEY` / `DASHSCOPE_BASE_URL` / `QWEN_VL_MODEL`
- **OSS（STS via ECS RAM Role）**
  - `OSS_REGION` / `OSS_BUCKET`
  - `OSS_UPLOAD_ENDPOINT` / `OSS_UPLOAD_CNAME`
  - `OSS_CDN_BASE_URL`
  - `ECS_RAM_ROLE_NAME` / `ECS_METADATA_BASE_URL`
  - `OSS_UPLOAD_PREFIX`

---

## 生产部署

当前部署命令（示例）：

```bash
cd /var/www/beads-app

git pull
npm install --omit=dev
pm2 restart beads
```

日志位置：
- `/root/.pm2/logs/beads-out.log`
- `/root/.pm2/logs/beads-error.log`

---



## 常见问题排查

- **无法注册/登录**：检查 `.env` 中 MySQL 配置是否完整
- **AI 识别不可用**：需要登录 + 配置 `DASHSCOPE_API_KEY`
- **访客模式数据丢失**：依赖浏览器 localStorage，清理缓存会丢失数据
- **查看线上日志**：`pm2 logs beads --lines 200`

---

## 文档索引

- `docs/API_CONTRACT.md`：接口契约
- `docs/OBSERVABILITY.md`：慢请求与错误日志格式
- `docs/REFactor_PLAN.md`：重构策略
- `docs/REPO_AUDIT.md`：仓库结构快照
- `docs/CLEANUP_REPORT.md`：清理报告

---

## 功能概览

- 访客本地模式：无需登录，库存与记录保存在浏览器 localStorage
- 云端多用户：登录后库存/历史/设置存储于 MySQL，多设备同步
- 记录能力：单条/批量补充或消耗、CSV 导入、记录分组查看与编辑
- 统计能力：色号消耗统计、库存告急阈值提醒
- 色号管理：按系列添加/移除色号，单个色号添加/删除
- AI 图纸识别（登录后）：上传图纸图片自动识别色号与数量
