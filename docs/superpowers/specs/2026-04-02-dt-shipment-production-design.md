# DT Shipment Production Rollout Design

## Goal

将 `dt_shipment` 从“本地开发 + 单独数据库容器”升级为适合 Docker Mac 长期运行的生产化部署：

- 服务运行在 Docker 中，和现有基础设施隔离
- 所有持久化数据落到 NAS 共享 `/Volumes/团队文件-DAINTY_SHIPMENT/docker/dt_shipment`
- 通过现有 Cloudflare Tunnel 对外暴露为 `ship.dainty.vip`
- 删除本机已停运的旧 `xianyu` 项目代码与本地巡检引用，但不影响其他项目稳定性
- 仓库补齐文档、版本单一来源、部署配置与自动化 API 验证

## Constraints

- 当前 `cloudflared` 容器已在 `/Users/maotiannan/dev/docker` 的基础设施中运行，并加入外部网络 `dainty_net`
- `cloudflared` 的 ingress 来源于 Cloudflare 后台远端配置，不是本机 `config.yml`
- `xianyu.dainty.vip` 当前仍指向已不存在的 `xianyu-auto-reply-fixed` 容器，导致持续报错
- 现有其他项目正在运行，不能因本项目调整而中断
- 用户要求优先 API 验证，不依赖人工点页面
- 需要把版本号做成单一来源，并在前端显示

## Current State

### Application

- 仓库只有 PostgreSQL 的 `docker-compose.yml`
- 后端为 `Express 5 + TypeScript + pg`
- 前端为 `React 19 + Vite + antd-mobile + PWA`
- 前端默认请求 `http://localhost:8787`
- 仓库错误提交了 `backend/node_modules`、`backend/dist`、`frontend/dev-dist` 等不应纳入版本控制的产物
- 没有生产 Dockerfile、没有生产 Compose、没有自动化测试入口、没有统一版本元数据

### Infrastructure

- 本机已有 Docker 网络 `dainty_net`
- `cloudflared` 远端 ingress 当前包括：
  - `img.dainty.vip -> Alist`
  - `shop.dainty.vip -> WordPress`
  - `stock.dainty.vip -> znas-frontend`
  - `xianyu.dainty.vip -> xianyu-auto-reply-fixed`（失效）
  - `muledger.dainty.vip -> trading-ledger-caddy`
- 巡检脚本 `migration/cloudflared-guard.sh` 也仍在探测 `xianyu.dainty.vip`

## Target Architecture

### Runtime Topology

- `dt-shipment-db`
  - PostgreSQL 16
  - 数据目录挂载到 NAS
- `dt-shipment-backend`
  - Node.js 生产镜像
  - 仅暴露容器内端口到项目内部网络
  - 提供 `/api/*`、`/api/health`、`/api/meta`
- `dt-shipment-frontend`
  - Vite 构建后由轻量 Web 服务器提供静态资源
  - 同容器内反向代理 `/api` 到 `dt-shipment-backend`
  - 加入 `dainty_net`，供 `cloudflared` 访问
- `cloudflared`
  - 继续复用现有基础设施容器
  - Cloudflare 后台将 `ship.dainty.vip` 指向 `http://dt-shipment-frontend:80`

### Networks

- 项目内部网络：`dt_shipment_internal`
  - 仅数据库、后端、前端使用
- 外部共享网络：`dainty_net`
  - 仅前端服务加入，供 `cloudflared` 访问

### Persistence Layout

- 根目录：`/Volumes/团队文件-DAINTY_SHIPMENT/docker/dt_shipment`
- 子目录：
  - `postgres/`
  - `env/`
  - `backups/`
  - `logs/`（如需要）

## Repository Changes

### Productionization

- 新增后端生产 Dockerfile
- 新增前端生产 Dockerfile 与 Web 服务器配置
- 新增面向 Docker Mac + NAS 的 Compose 文件
- 将数据库初始化纳入容器启动流程或显式 init 命令

### App Configuration

- 新增单一来源版本元数据文件，供前后端共享
- 后端新增元信息接口，返回版本、环境、时间等轻量状态
- 前端在顶栏合适区域显示版本号
- 前端生产环境改用同源 `/api`，避免跨域与硬编码主机

### Repository Hygiene

- 删除误提交的构建与依赖产物
- 新增 `.gitignore`、`.dockerignore`
- 保留锁文件，但不保留 `node_modules` / `dist` / `dev-dist`

### Documentation

- README 改为以当前正式部署方式为准
- 明确 NAS 目录、Docker 启动、Cloudflare 绑定、验证命令、升级方式

## Legacy Xianyu Cleanup Scope

允许删除：

- `/Users/maotiannan/dev/docker/compose/xianyu.yml`
- `/Users/maotiannan/dev/docker/compose/scripts/update-xianyu.sh`
- 本地巡检脚本中对 `xianyu.dainty.vip` 的探测配置

默认不删除：

- 未运行的历史数据目录
- 其他项目共享脚本中与当前任务无关的逻辑
- 任何在运行中的容器或其他域名 ingress

## Testing Strategy

### Test-first App Changes

- 后端新增元数据/配置行为先补测试，再改实现
- 对生产相关的最小代码变更建立自动化测试入口

### API-first Runtime Verification

- 本地容器健康检查
- 登录接口
- 身份接口
- 账号/商品/订单核心接口烟测
- `/api/meta` 与 `/api/health`
- 本地 `curl` 验证 `ship.dainty.vip`

### Deployment Verification

- `docker compose config`
- 镜像构建
- 容器状态
- 数据目录实际落在 NAS
- `cloudflared` 访问新服务不再报 `xianyu` 解析错误

## Risks and Mitigations

- Cloudflare 后台修改需要网页操作
  - 使用浏览器自动化完成并立刻验证
- SMB 共享对数据库 I/O 稳定性弱于本地盘
  - 使用明确单目录持久化并保留备份目录
- 删除旧 `xianyu` 引用时误伤其他项目
  - 仅删除与 `xianyu` 直接绑定的 compose、脚本和探测项，不改其他站点 ingress
- 仓库当前携带大量冗余产物
  - 在本次提交中一起清理，避免后续镜像和 Git 继续膨胀
