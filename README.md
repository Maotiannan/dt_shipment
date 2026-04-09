# 发货管家 `dt_shipment`

面向多账号电商场景的发货与结算系统。当前版本基于 `React 19 + Vite + Express 5 + PostgreSQL 16`，按 Mac Docker + Cloudflare Tunnel + NAS 文件仓模型完成了本地生产化适配。

## 当前部署结论

- 当前版本: `1.5.0`
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

因此当前实现采用三层持久化:

- 热数据: Docker named volume `dt_shipment_postgres_data`
- 冷备份: NAS 目录 `/Volumes/团队文件-DAINTY_SHIPMENT/docker/dt_shipment/backups`
- 商品图片原图与缩略图: NAS 目录 `/Volumes/团队文件-DAINTY_SHIPMENT/docker/dt_shipment/assets/products`
- 运行配置: NAS 目录 `/Volumes/团队文件-DAINTY_SHIPMENT/docker/dt_shipment/env/dt_shipment.env`

这套方案的取舍是:

- 运行稳定，PostgreSQL 能正常工作
- NAS 里持续保留可恢复备份
- 商品图片和缩略图不占用 Docker 本地卷，统一落到 NAS
- 数据库活跃数据仍占用 Docker Desktop 本地磁盘，需要定期关注容量

## 商品图片存储

商品图片采用“NAS 私有文件仓 + PostgreSQL 元数据”模型:

- 原图目录: `/Volumes/团队文件-DAINTY_SHIPMENT/docker/dt_shipment/assets/products/original`
- 缩略图目录: `/Volumes/团队文件-DAINTY_SHIPMENT/docker/dt_shipment/assets/products/thumb`
- 回收站目录: `/Volumes/团队文件-DAINTY_SHIPMENT/docker/dt_shipment/assets/products/trash`
- 数据库只保存 `sku_id`、排序、主图标记、相对路径、尺寸、哈希和删除状态等元数据
- 原图入库前会做一次优化压缩，默认限制最大宽度并重新编码，缩略图单独生成
- 前端商品列表与 SKU 编辑页优先读取紧凑缩略图，点击后再弹层加载大图预览
- 所有图片读取都经由 `dt_shipment` 后端鉴权代理，不复用 Alist / PicList 的公开访问范围

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
| `PRODUCT_IMAGE_ROOT` | 容器内商品图片根目录，默认 `/data/assets/products` |
| `PRODUCT_IMAGE_TMP_DIR` | 容器内上传暂存目录，默认 `/data/assets/uploads/tmp` |
| `PRODUCT_IMAGE_MAX_FILES` | 单次最多上传图片数，默认 `12` |
| `PRODUCT_IMAGE_MAX_FILE_MB` | 单张图片大小限制，默认 `10` MB |
| `PRODUCT_IMAGE_ALLOWED_MIME` | 允许上传的图片 MIME 列表 |
| `PRODUCT_IMAGE_ORIGINAL_MAX_WIDTH` | 原图优化后的最大宽度，默认 `1800` |
| `PRODUCT_IMAGE_ORIGINAL_JPEG_QUALITY` | 原图 JPEG 压缩质量，默认 `82` |
| `PRODUCT_IMAGE_ORIGINAL_WEBP_QUALITY` | 原图 WebP 压缩质量，默认 `84` |
| `PRODUCT_IMAGE_THUMB_WIDTH` | 缩略图目标宽度，默认 `480` |
| `PRODUCT_IMAGE_TRASH_RETENTION_DAYS` | 图片回收站保留天数，默认 `30` |

## 本地生产部署

启动:

```bash
docker compose --env-file /Volumes/团队文件-DAINTY_SHIPMENT/docker/dt_shipment/env/dt_shipment.env up -d --build
```

启动前必须先确认 NAS 共享已经挂载到本机，并且 `DT_SHIPMENT_DATA_ROOT` 指向该挂载目录。否则 Docker 会在本机创建同名目录，导致商品图片误落本地磁盘，破坏“图片在 NAS、数据库热数据在本地卷”的持久化假设。

停止:

```bash
docker compose --env-file /Volumes/团队文件-DAINTY_SHIPMENT/docker/dt_shipment/env/dt_shipment.env down
```

已接入宿主机统一启动脚本:

`/Users/maotiannan/dev/docker/migration/start-all.sh`

## Cloudflare Tunnel 配置

当前 tunnel 目标服务配置如下:

- Tunnel 内部服务地址: `http://dt-shipment-frontend:80`
- `dt-shipment-frontend` 已加入 Docker 网络 `dainty_net`
- 公网域名为 `ship.dainty.vip`

如果后续重建 tunnel、迁移环境或更换域名，仍需要在 Cloudflare Zero Trust / Tunnel 网页面板里手工维护 hostname 路由，把目标指向 `http://dt-shipment-frontend:80`。

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

图片删除回收站不会进入数据库备份，而是保存在 NAS 文件仓内，由清理任务按保留期清除。

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
- `POST /api/accounts`
- `DELETE /api/accounts/:id`（含订单引用冲突校验）
- `POST /api/orders`
- `GET /api/orders/:id`
- `PUT /api/orders/:id`
- `DELETE /api/orders/:id`
- `POST /api/skus`
- `GET /api/sku-attribute-suggestions`
- `GET /api/settings/sku-attribute-suggestions`
- `POST /api/settings/sku-attribute-suggestions`
- `PUT /api/settings/sku-attribute-suggestions/:id`
- `GET /api/settings/commerce`
- `PUT /api/settings/commerce`
- `POST /api/skus/:id/images`
- `PATCH /api/skus/:id/images/reorder`
- `PATCH /api/skus/:id/images/:imageId/primary`
- `DELETE /api/skus/:id/images/:imageId`
- `DELETE /api/skus/:id`
- `POST /api/internal/jobs/cleanup-product-images`

当前脚本会在结束前自动删除自己创建的 smoke SKU 和残留图片文件，不再把测试数据留在生产库里。

如果要直接验证公网入口，可额外执行:

```bash
curl -I https://ship.dainty.vip
```

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
| `DELETE /api/accounts/:id` | 删除账号；若已被订单引用则返回冲突 |
| `GET /api/skus` | 商品列表 |
| `GET /api/skus/:id` | 商品详情与图片列表 |
| `POST /api/skus/import/preview` | SKU 批量导入预检 |
| `POST /api/skus/import/commit` | SKU 批量导入确认落库 |
| `GET /api/sku-attribute-suggestions` | SKU 类目/颜色/规格候选项 |
| `GET /api/settings/sku-attribute-suggestions` | 设置中心读取 SKU 候选项治理列表 |
| `POST /api/settings/sku-attribute-suggestions` | 设置中心新增候选项 |
| `PUT /api/settings/sku-attribute-suggestions/:id` | 设置中心编辑或启停候选项 |
| `GET /api/settings/commerce` | 读取商品/库存主数据来源配置 |
| `PUT /api/settings/commerce` | 保存未来 OpenERP / Odoo 接入配置 |
| `DELETE /api/skus/:id` | 删除 SKU，并清理关联图片文件 |
| `POST /api/skus/:id/images` | 上传商品图片 |
| `GET /api/product-images/:imageId/thumb` | 鉴权读取缩略图 |
| `GET /api/product-images/:imageId/original` | 鉴权读取原图 |
| `PATCH /api/skus/:id/images/reorder` | 调整商品图片顺序 |
| `PATCH /api/skus/:id/images/:imageId/primary` | 设置商品主图 |
| `DELETE /api/skus/:id/images/:imageId` | 删除商品图片到回收站 |
| `POST /api/internal/jobs/cleanup-product-images` | 清理过期图片回收站文件 |
| `GET /api/orders` | 订单列表 |
| `GET /api/orders/:id` | 订单详情 |
| `POST /api/orders` | 新建订单 |
| `PUT /api/orders/:id` | 完整更新订单基础信息/商品明细/发货信息 |
| `DELETE /api/orders/:id` | 删除订单 |
| `POST /api/orders/import/preview` | 订单批量导入预检 |
| `POST /api/orders/import/commit` | 订单批量导入确认落库 |
| `POST /api/orders/bulkUpsert` | 订单批量导入/更新 |

## 当前页面 CRUD 结论

- 账号管理：支持新增、列表查询、编辑、停用、删除；若账号已被订单引用会阻止删除
- 产品库：支持新增、列表查询、编辑、停用、删除；SKU 结构化为类目/颜色/规格，支持库存维护、候选项沉淀和同流程上传商品图片
- 产品库：支持新增、列表查询、编辑、停用、删除；支持 `CSV / XLSX / XLS` 批量导入 SKU，并在产品页直接下载导入模板
- 订单管理：支持 `CSV / XLSX / XLS` 导入预检、覆盖导入与 Excel 导出，并在订单页直接下载导入模板
- 订单管理：支持新增、列表查询、按订单号读取详情、完整编辑、删除、`CSV / XLSX / XLS` 导入预检、覆盖导入与 Excel 导出
- 结算管理：展示所有仍有应收金额的订单，不再只限批发订单
- 结算管理：定位为订单结算子视图，负责批发订单收款更新与欠款汇总，不单独承担订单新增/删除
- 设置中心：第一版已上线，当前用于治理 SKU 类目/颜色/规格候选项，并持久化商品/库存主数据来源，预留未来 OpenERP / Odoo 接入配置

## 批量导入模板

- SKU 导入模板和订单导入模板目前都是中文列头
- 产品页可直接下载 `发货管家_SKU导入模板.csv`
- 订单页可直接下载 `发货管家_订单导入模板.csv`
- 当前模板仍面向本地 SKU 与订单模型；后续若切换 OpenERP / Odoo 为商品主数据源，会在保持模板可用的前提下补充字段映射策略

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
- 新增商品图片 NAS 私有文件仓、缩略图和回收站清理链路
- 新增 API 冒烟脚本
- 新增设置中心第一版与 SKU 候选项治理接口
- 新增商品/库存主数据来源配置，为未来 OpenERP / Odoo 接入预留设置与持久化边界
- 宿主机统一启动脚本已接入本项目
