# 发货管家批量导入治理设计

**日期：** 2026-04-08  
**范围：** SKU 批量导入、订单批量导入预检/总览、导入治理规则  
**状态：** 已确认，可进入实现

## 目标

在不回退现有订单事务、库存账本、商品图片私有仓能力的前提下，补齐以下能力：

- SKU 支持 `CSV / XLSX / XLS` 批量导入
- 订单导入从“直接落库”升级为“预检总览 -> 修正/删除/覆盖 -> 确认导入”
- 订单新模板支持 `sku_code + qty + unit_price`，并继续兼容旧模板
- 重复项、错误项、库存不足、缺失 SKU 必须在导入前暴露出来，未修复时不允许确认导入

## 非目标

- 本轮不做商品图片随表格导入
- 本轮不做桌面端单独布局优化
- 本轮不引入复杂的长期任务队列；导入仍以同步 API + 前端总览为主

## 业务规则

### 1. SKU 导入

SKU 导入模板字段固定为：

- `sku_code`
- `name`
- `category_name`
- `color_name`
- `variant_name`
- `unit_price`
- `inventory_quantity`
- `status`

字段语义：

- `sku_code`：SKU 唯一匹配键，用于判断新增或更新
- `inventory_quantity`：导入后的目标库存绝对值，不是增量
- `status`：`active` / `inactive`

导入规则：

- `sku_code` 为空时判为错误
- 同一批文件内重复 `sku_code` 判为冲突项，需要用户删除多余行或手动改编码
- 目标库已存在同 `sku_code` 时，默认动作是 `覆盖`
- 覆盖 SKU 时按结构化字段更新，并通过库存账本写入 `manual_adjustment`
- SKU 导入不处理图片列；商品图片仍通过现有上传链路维护

### 2. 订单导入

订单导入支持：

- `CSV`
- `XLSX`
- `XLS`

模板兼容策略：

- 继续兼容旧模板中的纯文本商品明细
- 新模板支持按 `sku_code + qty + unit_price` 表达商品行

导入规则：

- 所有订单先进入预检，不直接落库
- 若 `order_id` 已存在，默认动作是 `覆盖`
- 覆盖既有订单时：
  - 先锁定并回滚该订单旧库存影响
  - 再应用导入后的新商品明细
  - 重算 `total_amount / paid_amount / settlement_status / 应收金额`
- 若导入行存在以下问题，必须先修复，否则不能确认导入：
  - 必填字段缺失
  - 文件内重复订单号
  - 缺失关联 SKU
  - SKU 库存不足
  - 非法数量/金额

### 3. 导入总览表

订单和 SKU 都走“导入总览表”模型。

总览表必须显示：

- 原始行号
- 目标实体主键（`order_id` / `sku_code`）
- 解析后的关键字段
- 动作：`新增 / 覆盖 / 跳过`
- 状态：`通过 / 警告 / 错误`
- 错误与警告明细

总览操作：

- 编辑导入行
- 删除导入行（从本次批次移除）
- 保持默认覆盖

准入规则：

- 只要总览中仍有未修复错误，`确认导入` 按钮禁用
- 警告允许继续；错误不允许继续

## 架构设计

### 后端

新增独立导入模块，而不是把所有导入逻辑继续堆在 `createApp.ts`：

- `backend/src/imports/parsers.ts`
  - 统一解析 CSV / XLSX / XLS
- `backend/src/imports/skuImport.ts`
  - SKU 预检、标准化、批次确认导入
- `backend/src/imports/orderImport.ts`
  - 订单预检、重复项识别、库存可用性检查、批次确认导入
- `backend/src/imports/types.ts`
  - 批次、预检结果、总览行模型

批次状态先不持久化到数据库，使用“前端提交解析结果 -> 后端再次标准化校验 -> 直接确认导入”的同步模型。这样能尽快恢复能力，避免本轮再引入 `import_jobs` 表。

新增接口：

- `POST /api/skus/import/preview`
- `POST /api/skus/import/commit`
- `POST /api/orders/import/preview`
- `POST /api/orders/import/commit`

兼容保留：

- `POST /api/orders/bulkUpsert` 暂时保留，但前端不再使用

### 前端

新增通用导入预览组件，并在订单页、产品页分别接入：

- `frontend/src/components/ImportFilePicker.tsx`
  - 负责选择文件、解析为前端上传载荷
- `frontend/src/components/ImportPreviewTable.tsx`
  - 通用总览表
- `frontend/src/components/OrdersImportDialog.tsx`
  - 订单导入流程
- `frontend/src/components/SkusImportDialog.tsx`
  - SKU 导入流程

页面入口：

- 订单页保留“导入”按钮，但改为打开新总览流程
- 产品页新增“批量导入 SKU”按钮

## 测试策略

后端：

- 订单导入预检与确认导入的路由测试
- SKU 导入预检与确认导入的路由测试
- 重复项、缺失项、库存不足、覆盖更新、库存回滚测试

前端：

- 导入预览状态归一化测试
- SKU/订单导入表单解析测试
- 关键组件交互测试以纯函数为主，不依赖人工点测

回归：

- 继续保留现有 smoke
- 为导入新增 API 级 smoke，至少覆盖：
  - SKU 文件导入一条新增 + 一条覆盖
  - 订单文件导入一条新增 + 一条覆盖

## 发布与运维

- 版本提升到下一个小版本
- README 更新批量导入说明、模板字段、支持文件类型、预检规则
- 本地运行中的 Docker 服务同步更新
- 推送 GitHub `main`
