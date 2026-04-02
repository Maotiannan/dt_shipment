# 发货管家 `dt_shipment`

面向多账号电商场景的发货与结算系统。当前版本基于 `React 19 + Vite + Express 5 + PostgreSQL 16`，按 Mac Docker + Cloudflare Tunnel + NAS 备份模型完成了本地生产化适配。

## 当前部署结论

- 前端容器: `dt-shipment-frontend`
- 后端容器: `dt-shipment-backend`
- 数据库容器: `dt-shipment-db`
- 备份容器: `dt-shipment-db-backup`
- 本地访问: `http://127.0.0.1:18187`
- 目标公网域名: `ship.dainty.vip`
- 版本单一来源: 根目录 [package.json](./package.json)

## 架构说明

- `frontend/`: React 19 前端，生产环境由 Nginx 托管静态资源，并反向代理 `/api`
- `backend/`: Express 5 API，启动时自动初始化数据库
- `db`: PostgreSQL 16
- `db_backup`: 定时把数据库备份写到 NAS

实际运行链路:

1. 浏览器访问 `ship.dainty.vip`
2. Cloudflare Tunnel 把流量转到 `http://dt-shipment-frontend:80`
3. Nginx 托管前端，并把 `/api/*` 转发到 `dt-shipment-backend:8787`
4. 后端连接 `dt-shipment-db:5432`

## 持久化策略

PostgreSQL 的热数据目录不能直接放在 SMB 共享上。原因是 PostgreSQL 初始化时必须对 `PGDATA` 做 `chown/chmod`，而 macOS 挂载的 `smbfs` 会返回 `Operation not permitted`，数据库无法启动。

因此当前实现采用两层持久化:

- 热数据: Docker named volume `dt_shipment_postgres_data`
- 冷备份: NAS 目录 `/Volumes/团队文件-DAINTY_SHIPMENT/docker/dt_shipment/backups`
- 运行配置: NAS 目录 `/Volumes/团队文件-DAINTY_SHIPMENT/docker/dt_shipment/env/dt_shipment.env`

这套方案的取舍是:

- 运行稳定，PostgreSQL 能正常工作
- NAS 里持续保留可恢复备份
- 数据库活跃数据仍占用 Docker Desktop 本地磁盘，需要定期关注容量

## 目录结构

```text
dt_shipment/
├── package.json
├── docker-compose.yml
├── .env.example
├── backend/
├── frontend/
├── docs/
├── ops/
│   ├── backup-postgres-once.sh
│   └── pg-backup-loop.sh
└── scripts/
    └── smoke-test.mjs
```

## 环境变量

建议以 NAS 上的实际环境文件为准:

`/Volumes/团队文件-DAINTY_SHIPMENT/docker/dt_shipment/env/dt_shipment.env`

核心变量如下:

| 变量 | 说明 |
| --- | --- |
| `DT_SHIPMENT_DB_PASSWORD` | PostgreSQL 密码 |
| `DT_SHIPMENT_ADMIN_USERNAME` | 管理员账号 |
| `DT_SHIPMENT_ADMIN_PASSWORD` | 管理员密码 |
| `DT_SHIPMENT_JWT_SECRET` | JWT 密钥 |
| `DT_SHIPMENT_FRONTEND_PORT` | 本机前端端口，当前为 `18187` |
| `DT_SHIPMENT_BACKEND_PORT` | 本机后端端口，当前为 `18787` |
| `DT_SHIPMENT_DB_VOLUME_NAME` | PostgreSQL 命名卷名 |
| `DT_SHIPMENT_BACKUP_DIR` | NAS 备份目录 |
| `DT_SHIPMENT_BACKUP_INTERVAL_SECONDS` | 自动备份间隔，默认 `21600` 秒 |
| `DT_SHIPMENT_BACKUP_KEEP_DAYS` | 备份保留天数，默认 `14` 天 |
| `DT_SHIPMENT_PUBLIC_HOST` | 期望绑定域名，当前为 `ship.dainty.vip` |
| `DT_SHIPMENT_SMOKE_BASE_URL` | API 冒烟测试入口地址 |

## 本地生产部署

启动:

```bash
docker compose --env-file /Volumes/团队文件-DAINTY_SHIPMENT/docker/dt_shipment/env/dt_shipment.env up -d --build
```

停止:

```bash
docker compose --env-file /Volumes/团队文件-DAINTY_SHIPMENT/docker/dt_shipment/env/dt_shipment.env down
```

已接入宿主机统一启动脚本:

`/Users/maotiannan/dev/docker/migration/start-all.sh`

## Cloudflare Tunnel 配置

当前 tunnel 目标服务已经具备接入条件:

- Tunnel 内部服务地址: `http://dt-shipment-frontend:80`
- `dt-shipment-frontend` 已加入 Docker 网络 `dainty_net`

你需要在 Cloudflare Zero Trust / Tunnel 的网页面板里做两件事:

1. 新增 hostname: `ship.dainty.vip` -> `http://dt-shipment-frontend:80`
2. 删除旧 hostname: `xianyu.dainty.vip`

当前已确认:

- `ship.dainty.vip` 还未解析
- `xianyu.dainty.vip` 仍指向已经停运的旧服务，公网返回 `502`

## 自动备份

备份容器会在启动后立即执行一次备份，然后按间隔继续备份。

默认输出目录:

`/Volumes/团队文件-DAINTY_SHIPMENT/docker/dt_shipment/backups`

手工触发一次备份:

```bash
npm run backup:db
```

备份文件格式:

- `dt_shipment_YYYYMMDDTHHMMSS.dump`
- `dt_shipment_globals_YYYYMMDDTHHMMSS.sql`

## API 冒烟测试

当前项目优先采用 API 自动验证，不依赖人工点页面。

执行方式:

```bash
set -a
source /Volumes/团队文件-DAINTY_SHIPMENT/docker/dt_shipment/env/dt_shipment.env
set +a
npm run test:smoke
```

当前冒烟覆盖:

- `/api/health`
- `/api/meta`
- `/api/auth/login`
- `/api/auth/me`
- `/api/accounts`

## 版本管理

版本号以根目录 [package.json](./package.json) 为唯一来源。

联动点:

- 后端 `/api/meta`
- 后端 `/api/health`
- 前端顶部版本显示
- PWA manifest
- API 冒烟输出

## 本地开发

后端:

```bash
cd backend
npm install
npm run dev
```

前端:

```bash
cd frontend
npm install
npm run dev
```

开发环境下前端通过 Vite 代理把 `/api` 转发到 `http://localhost:8787`，默认不需要额外配置 `VITE_API_BASE`。

## 关键接口

| 接口 | 说明 |
| --- | --- |
| `GET /api/meta` | 应用元信息与版本 |
| `GET /api/health` | 服务与数据库健康状态 |
| `POST /api/auth/login` | 登录 |
| `GET /api/accounts` | 账号列表 |
| `GET /api/skus` | 商品列表 |
| `GET /api/orders` | 订单列表 |
| `POST /api/orders/bulkUpsert` | 订单批量导入/更新 |

## 相关运维文件

- [docker-compose.yml](./docker-compose.yml)
- [ops/pg-backup-loop.sh](./ops/pg-backup-loop.sh)
- [ops/backup-postgres-once.sh](./ops/backup-postgres-once.sh)
- [scripts/smoke-test.mjs](./scripts/smoke-test.mjs)
- [backend/src/appMeta.ts](./backend/src/appMeta.ts)
- [frontend/src/lib/runtimeConfig.ts](./frontend/src/lib/runtimeConfig.ts)

## 已完成的本地适配

- 清理了旧仓库中误提交的 `node_modules`、`dist`、`dev-dist`
- 新增根级 `.gitignore` 与 `.dockerignore`
- 前后端改成同源部署模型
- 新增版本单一来源并展示到前端
- 新增 API 元信息接口
- 新增 Docker 化前后端
- 新增 NAS 自动备份链路
- 新增 API 冒烟脚本
- 宿主机统一启动脚本已接入本项目
