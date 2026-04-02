# DT Shipment Product Images Design

## Goal

为 `dt_shipment` 增加面向商品的图片管理能力，并保持现有部署边界清晰：

- 商品支持多张图片，并可设置一张主图
- 第一张上传图片默认成为主图
- 原图、缩略图、回收站文件全部落到 NAS 共享 `/Volumes/团队文件-DAINTY_SHIPMENT`
- 数据库只保存文本与图片元数据，不保存图片二进制
- 图片只在 `dt_shipment` 登录态下可访问，不复用现有 `Alist / PicList` 的公开可见范围
- 删除图片时先移动到回收区，延迟清理
- 以 API 自动化测试为主完成验证，不依赖人工手测

## Constraints

- 当前商品能力以 `skus` 表和 `/api/skus` 为基线，见 `backend/db/init.sql` 与 `backend/src/server.ts`
- 当前前端商品页是文本型 SKU CRUD，见 `frontend/src/pages/ProductsPage.tsx`
- 现有 Mac Docker 项目并未把数据库热数据直接写入 SMB 共享；图片文件上 NAS、数据库元数据留本地 PostgreSQL 是更稳妥的模式
- 用户明确要求不影响现有 `Alist / PicList` 的目录结构、公开链接和可见范围
- 用户当前仅要求“商品图片”，不要求订单图片，也不要求重做完整 SPU/SKU 领域模型

## Current State

### Data Model

- `skus` 仅包含商品文本字段：`sku_code`、`name`、`spec`、`unit_price`、`category`、`status` 等
- 没有图片表，也没有图片排序、主图、文件生命周期等概念

### Backend

- 现有后端已具备：
  - JWT 登录鉴权
  - `requireAuth` 中间件
  - 基础商品列表、新增、编辑接口
- 现有后端缺少：
  - 上传图片接口
  - 私有图片读取接口
  - 缩略图生成与文件存储抽象
  - 回收区清理任务

### Frontend

- 商品页当前只有列表、搜索、状态过滤、弹窗编辑
- 没有图片上传、预览、排序、主图切换能力

## Recommended Approach

采用“私有图片仓 + 后端鉴权代理”的结构：

- `skus` 继续作为当前商品主表
- 新增 `product_images` 表管理图片元数据
- 后端负责：
  - 图片鉴权
  - 文件校验
  - 写入 NAS 私有目录
  - 生成缩略图
  - 提供受保护的图片访问接口
- 前端只调用 `dt_shipment` 自己的 API，不直接访问 NAS 路径

不采用以下方案：

- 不复用 `PicList` 的公开图片目录
  - 会打穿系统边界，增加未来误删、误公开、权限混乱风险
- 不采用“本地先存、后台异步同步 NAS”的双阶段写入
  - 当前需求不值得引入额外补偿与一致性复杂度

## Target Architecture

### Storage Layout

建议在现有 NAS 根目录下新增商品图片私有目录：

- `/Volumes/团队文件-DAINTY_SHIPMENT/docker/dt_shipment/assets/products/original/{skuId}/{imageId}.{ext}`
- `/Volumes/团队文件-DAINTY_SHIPMENT/docker/dt_shipment/assets/products/thumb/{skuId}/{imageId}.jpg`
- `/Volumes/团队文件-DAINTY_SHIPMENT/docker/dt_shipment/assets/products/trash/{yyyy}/{mm}/{imageId}.{ext}`
- `/Volumes/团队文件-DAINTY_SHIPMENT/docker/dt_shipment/assets/uploads/tmp/`

说明：

- `original/` 保存原图
- `thumb/` 保存预生成缩略图，供列表与轻量预览使用
- `trash/` 保存已删除但仍在保留期内的图片
- `tmp/` 仅用于上传流程中的中间文件

### Service Boundaries

- 浏览器不直接访问 NAS 文件路径
- 所有图片读取都经过 `dt_shipment` 后端，并要求登录态
- `Alist / PicList` 不参与商品图片读写链路
- Docker 只需要把商品图片私有目录挂进 `backend` 容器，不需要把整个 `PICLIST` 共享挂进来

## Data Model

### Existing Table

- 保留 `skus` 作为当前商品主表，不在本次需求中拆分为 `products + sku_variants`

### New Table: `product_images`

建议新增表：

- `image_id uuid primary key`
- `sku_id uuid not null references skus(sku_id) on delete cascade`
- `storage_key text not null unique`
- `original_relpath text not null`
- `thumb_relpath text not null`
- `mime_type text not null`
- `file_ext text not null`
- `file_size bigint not null`
- `width integer not null`
- `height integer not null`
- `sha256 text not null`
- `sort_order integer not null`
- `is_primary boolean not null default false`
- `status text not null default 'active'`
- `deleted_at timestamptz`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

建议索引：

- `product_images_sku_sort_idx` on `(sku_id, sort_order)`
- `product_images_primary_idx` on `(sku_id, is_primary)` where `status = 'active'`
- `product_images_status_idx` on `(status, deleted_at)`

### Semantics

- 一张图片对应 `product_images` 一行
- `sku_id` 表示“属于哪个商品”
- `sort_order` 表示“当前排序位置”
- `is_primary` 表示“当前主图”
- `status` 用于区分有效图片与已删除图片

## API Design

所有新增接口都要求 `requireAuth`。

### Product Queries

- `GET /api/skus`
  - 返回商品基础信息
  - 附带主图缩略图摘要，避免商品列表首屏为每个商品追加一次图片查询
- `GET /api/skus/:id`
  - 返回商品详情与全部图片元数据
  - 图片按 `sort_order asc` 返回

### Image Mutations

- `POST /api/skus/:id/images`
  - `multipart/form-data`
  - 支持一次上传多张图
  - 首次上传时，第一张图默认 `is_primary = true`
- `PATCH /api/skus/:id/images/reorder`
  - 批量更新图片顺序
  - 当前版本采用明确的“上移 / 下移”交互，后端仍提供通用重排接口
- `PATCH /api/skus/:id/images/:imageId/primary`
  - 将指定图片设置为主图
- `DELETE /api/skus/:id/images/:imageId`
  - 将图片逻辑删除，并移动到回收区

### Image Reads

- `GET /api/product-images/:imageId/thumb`
  - 返回缩略图
- `GET /api/product-images/:imageId/original`
  - 返回原图

### Job Endpoint

为满足“优先 API 自动化测试”的要求，增加一个内部清理入口：

- `POST /api/internal/jobs/cleanup-product-images`
  - 执行回收区过期文件清理
  - 当前版本直接复用 `requireAuth`，便于 API 自动化测试
  - 用于测试保留期与清理逻辑

## Upload Flow

### Validation

后端在接收文件时需要做以下校验：

- 文件数量不超过配置上限
- 单文件大小不超过配置上限
- MIME 类型必须在允许范围内，例如 `image/jpeg`、`image/png`、`image/webp`
- 商品必须存在且可编辑

### Write Path

建议流程：

1. 文件写入 `tmp/`
2. 读取尺寸、扩展名、哈希、MIME
3. 生成原图目标路径和缩略图目标路径
4. 写入 NAS 私有目录
5. 在数据库事务中插入 `product_images`
6. 成功后删除临时文件

### Primary Image Rules

- 如果商品当前没有任何有效图片：
  - 第一张成功上传的图片自动设为主图
- 如果商品已有主图：
  - 新图默认不是主图
- 手动设置主图时：
  - 在同一事务中清除该商品其他有效图片的 `is_primary`

## Reorder and Positioning Logic

排序逻辑以数据库中的 `sort_order` 为准，而不是文件名、创建时间或前端临时顺序。

- 商品详情接口按 `sort_order asc` 返回图片
- 前端显示顺序与数据库顺序保持一致
- 本次前端交互先采用“上移 / 下移”
  - 比拖拽更稳，复杂度更低
- 后端仍保留批量重排接口，便于未来升级拖拽排序

## Delete and Recycle Strategy

用户要求删除时先进回收区，因此删除流程定义为：

1. 将数据库状态更新为 `deleted`
2. 记录 `deleted_at`
3. 将原图与缩略图移动到 `trash/`
4. 如果删除的是当前主图：
  - 自动把该商品最前的一张有效图片设为新主图
  - 如果不存在有效图片，则该商品主图为空

回收区清理任务：

- 基于 `deleted_at + retentionDays`
- 删除超期文件
- 物理文件删除后，数据库删除记录继续保留，作为审计与问题排查依据

## Frontend Design

### Product List

在商品列表中增加：

- 主图缩略图列
- 无图时的占位样式

### Product Editor

在新增 / 编辑商品弹窗中增加图片管理区域：

- 多图上传
- 当前图片列表
- 主图标识
- “设为主图”按钮
- “上移 / 下移”按钮
- 删除按钮

### Preview Behavior

- 商品列表与编辑区优先加载缩略图
- 用户点击图片时，再请求原图并展示大图预览
- 这样可以在保留原图的同时，降低首页和列表渲染负担

## Configuration

建议把以下能力做成显式配置项：

- `PRODUCT_IMAGE_ROOT`
- `PRODUCT_IMAGE_TMP_DIR`
- `PRODUCT_IMAGE_MAX_FILES`
- `PRODUCT_IMAGE_MAX_FILE_MB`
- `PRODUCT_IMAGE_ALLOWED_MIME`
- `PRODUCT_IMAGE_THUMB_WIDTH`
- `PRODUCT_IMAGE_TRASH_RETENTION_DAYS`

原因：

- 用户明确要求“要考虑未来可配置”
- 图片大小、保留期、缩略图尺寸都可能随着业务变化调整

## Error Handling

需要显式覆盖以下失败场景：

- NAS 目录未挂载
  - 上传接口直接失败
  - 返回明确错误，而不是回退到本地磁盘写入
- 缩略图生成失败
  - 整个上传失败并回滚数据库写入
- 数据库事务失败
  - 已写入的目标文件立即删除，不引入额外异步补偿队列
- 图片读取时文件丢失
  - 返回 `404`
  - 记录错误日志，便于后续修复

## Testing Strategy

以 API 自动化测试为主，覆盖以下核心路径：

- 登录获取 token
- 创建商品
- 上传单张图片
- 上传多张图片
- 校验首张主图规则
- 校验缩略图接口与原图接口
- 设置主图
- 调整顺序
- 删除图片并验证回收区路径
- 执行 cleanup API 并验证超期文件清理

前端测试只覆盖必要逻辑：

- 商品页图片元数据渲染
- 主图切换与排序按钮行为
- 上传区基础交互

## Out of Scope

本次不做：

- 订单图片
- 公网图片直链
- 接入 `img.dainty.vip`
- 重构完整商品领域模型
- 复杂拖拽排序
- 复用 `PicList` 的公开目录或权限模型

## Implementation Order

建议实施顺序：

1. 数据库迁移与图片文件服务抽象
2. 上传、读图、设主图、重排、删除 API
3. 商品页图片管理 UI
4. 回收区清理任务与自动化测试
5. README、部署文档、环境变量说明同步更新

## Success Criteria

完成后，应满足以下结果：

- 商品可上传多张图片
- 商品可设置主图，且默认首图为主图
- 商品列表先显示缩略图，点击后再加载原图
- 图片文件全部落到 `DAINTY_SHIPMENT` NAS 私有目录
- 数据库只保留图片元数据
- 不影响现有 `Alist / PicList`
- 所有核心链路可通过 API 自动化测试验证
