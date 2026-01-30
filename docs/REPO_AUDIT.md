# Repo Audit（只读快照）

> 生成时间：2026-01-30

## 简化目录结构

```text
beads_inventory/
  index.js
  src/
    server.js
    db/            # 连接池与表结构
    middleware/    # 鉴权、请求上下文
    routes/        # 按领域拆分的 API
    services/      # 业务服务（含 OSS STS）
    utils/         # 公共工具与响应封装
  public/
    index.html
    app.js
    styles.css
  scripts/
    smoke.sh
  migrations/
    README.md
  docs/
    API_CONTRACT.md
    OBSERVABILITY.md
    REFactor_PLAN.md
    REPO_AUDIT.md
    CLEANUP_REPORT.md
  package.json
  package-lock.json
  README.md
```

## 运行方式（dev/prod）

- 开发模式：`npm run dev`（`node --watch index.js`）
- 生产模式：`npm start` 或 `pm2 restart beads`
- 是否托管前端由 `SERVE_FRONTEND` 控制（true/false）

## 关键文件说明

- `index.js`：启动入口（加载 env -> 启动 server）
- `src/server.js`：构建 Express app、注册中间件与路由
- `src/routes/*`：后端 API 路由（auth/inventory/history/patterns/oss 等）
- `src/db/*`：数据库连接池与 schema 初始化
- `public/index.html`：前端入口
- `public/app.js`：前端业务脚本
- `public/styles.css`：前端样式
- `scripts/smoke.sh`：最小链路冒烟测试
- `docs/API_CONTRACT.md`：接口契约说明
- `docs/OBSERVABILITY.md`：日志与慢请求说明

## 初步清单（仅建议，未执行）

- 建议删除：暂无明确可安全删除项
- 建议合并：暂无（当前文档职责清晰）
- 建议保留：`docs/*`、`scripts/smoke.sh`、`src/*`、`public/*`
