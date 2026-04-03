# Commerce Foundation Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成订单、结算、SKU、库存、商品图片的业务核心重构，使系统具备结构化商品模型、事务化库存、统一结算视图和更适合桌面端的录入体验。

**Architecture:** 后端先补数据库结构和事务边界，再把订单库存、SKU 候选项、结算查询、图片压缩这几条核心链路模块化，最后前端分别重做订单页、结算页和商品页交互。设置中心完整后台不在本阶段实现，但候选项与媒体配置边界要提前预留，以免后续返工。

**Tech Stack:** React 19, TypeScript, Express 5, PostgreSQL 16, Sharp, Node test runner, Docker Compose

---

## File Map

### Back-End

- Modify: `backend/db/init.sql`
- Modify: `backend/src/scripts/initDbRunner.ts`
- Modify: `backend/src/scripts/initDb.test.ts`
- Modify: `backend/src/scripts/initDb.integration.test.ts`
- Modify: `backend/src/createApp.ts`
- Modify: `backend/src/createApp.test.ts`
- Modify: `backend/src/ordersAccounts.routes.test.ts`
- Modify: `backend/src/productImages/config.ts`
- Modify: `backend/src/productImages/fileStore.ts`
- Modify: `backend/src/productImages/fileStore.test.ts`
- Modify: `backend/src/productImages/service.ts`
- Modify: `backend/src/productImages/routes.test.ts`
- Create: `backend/src/inventory/ledger.ts`
- Create: `backend/src/inventory/ledger.test.ts`
- Create: `backend/src/skuAttributes/suggestions.ts`
- Create: `backend/src/skuAttributes/suggestions.test.ts`

### Front-End

- Modify: `frontend/src/App.css`
- Modify: `frontend/src/components/ProductImageManager.tsx`
- Modify: `frontend/src/components/SkuPicker.tsx`
- Modify: `frontend/src/lib/orderForm.ts`
- Modify: `frontend/src/lib/orderForm.test.ts`
- Create: `frontend/src/lib/skuForm.ts`
- Create: `frontend/src/lib/skuForm.test.ts`
- Create: `frontend/src/lib/skuSuggestionsApi.ts`
- Modify: `frontend/src/lib/productImagesApi.ts`
- Modify: `frontend/src/pages/OrdersPage.tsx`
- Modify: `frontend/src/pages/SettlementsPage.tsx`
- Modify: `frontend/src/pages/ProductsPage.tsx`

### Docs / Verification

- Modify: `README.md`
- Modify: `scripts/smoke-test.mjs`
- Modify: `docker-compose.yml`（仅当需要新增图片压缩环境变量时）
- Modify: `.env.example`

---

### Task 1: Schema Migration And Init-DB Safety Net

**Files:**
- Modify: `backend/db/init.sql`
- Modify: `backend/src/scripts/initDbRunner.ts`
- Modify: `backend/src/scripts/initDb.test.ts`
- Modify: `backend/src/scripts/initDb.integration.test.ts`

- [ ] **Step 1: 写失败测试，锁定新字段和新表**

在 `backend/src/scripts/initDb.test.ts` 新增断言，要求初始化后至少存在以下结构：

```ts
assert(columns.has('category_name'))
assert(columns.has('color_name'))
assert(columns.has('variant_name'))
assert(columns.has('delivery_channel'))
assert(tables.has('inventory_movements'))
assert(tables.has('sku_attribute_suggestions'))
```

- [ ] **Step 2: 运行 init-db 测试确认当前失败**

Run:

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/backend
npm test -- src/scripts/initDb.test.ts src/scripts/initDb.integration.test.ts
```

Expected: FAIL，提示缺少新列或新表。

- [ ] **Step 3: 更新初始化 SQL 与兼容迁移逻辑**

在 `backend/db/init.sql` 与 `backend/src/scripts/initDbRunner.ts` 中增加：

```sql
alter table skus add column if not exists category_name text;
alter table skus add column if not exists color_name text;
alter table skus add column if not exists variant_name text;
alter table orders add column if not exists delivery_channel text;

create table if not exists inventory_movements (...);
create table if not exists sku_attribute_suggestions (...);
```

并补历史数据回填：

```sql
update skus
set category_name = coalesce(category_name, category),
    variant_name = coalesce(variant_name, spec)
where category_name is null or variant_name is null;
```

- [ ] **Step 4: 运行 init-db 测试确认通过**

Run:

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/backend
npm test -- src/scripts/initDb.test.ts src/scripts/initDb.integration.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git -C /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment add backend/db/init.sql backend/src/scripts/initDbRunner.ts backend/src/scripts/initDb.test.ts backend/src/scripts/initDb.integration.test.ts
git -C /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment commit -m "Add commerce foundation schema"
```

### Task 2: Inventory Ledger Module

**Files:**
- Create: `backend/src/inventory/ledger.ts`
- Create: `backend/src/inventory/ledger.test.ts`
- Modify: `backend/src/createApp.ts`

- [ ] **Step 1: 为库存扣减、回滚、库存不足写失败测试**

在 `backend/src/inventory/ledger.test.ts` 写纯逻辑测试，覆盖：

```ts
assert.deepEqual(computeInventoryDelta(beforeItems, afterItems), [
  { skuId: 'sku-a', delta: -2 },
  { skuId: 'sku-b', delta: 1 },
])
assert.throws(() => ensureInventoryAvailable([{ skuId: 'sku-a', nextQuantity: -1 }]))
```

- [ ] **Step 2: 运行目标测试确认失败**

Run:

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/backend
npm test -- src/inventory/ledger.test.ts
```

Expected: FAIL，提示模块不存在。

- [ ] **Step 3: 实现库存流水模块**

在 `backend/src/inventory/ledger.ts` 中实现：

```ts
export function normalizeInventoryItems(items: unknown): InventoryLine[]
export function computeInventoryDelta(before: InventoryLine[], after: InventoryLine[]): InventoryDelta[]
export async function applyInventoryMovementTx(...)
```

模块职责：
- 归一化订单商品项
- 计算 SKU 维度的数量增减
- 在事务内校验库存、写 `inventory_movements`、更新 `skus.inventory_quantity`

- [ ] **Step 4: 接入订单事务**

修改 `backend/src/createApp.ts`：
- `POST /api/orders` 创建即扣库存
- `PUT /api/orders/:id` 先回滚旧库存再应用新库存
- `DELETE /api/orders/:id` 回滚库存

- [ ] **Step 5: 运行相关测试**

Run:

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/backend
npm test -- src/inventory/ledger.test.ts src/ordersAccounts.routes.test.ts
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git -C /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment add backend/src/inventory/ledger.ts backend/src/inventory/ledger.test.ts backend/src/createApp.ts backend/src/ordersAccounts.routes.test.ts
git -C /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment commit -m "Implement transactional inventory ledger"
```

### Task 3: Order Model And Settlement Query Refactor

**Files:**
- Modify: `backend/src/createApp.ts`
- Modify: `backend/src/ordersAccounts.routes.test.ts`
- Modify: `frontend/src/lib/orderForm.ts`
- Modify: `frontend/src/lib/orderForm.test.ts`
- Modify: `frontend/src/pages/SettlementsPage.tsx`

- [ ] **Step 1: 为发货模型收敛和结算查询范围写失败测试**

在 `backend/src/ordersAccounts.routes.test.ts` 增加断言：

```ts
assert.equal(created.ship_status, 'shipped')
assert.equal(created.delivery_channel, 'platform_upload')
assert.equal(settlementRows.some((row) => row.order_id === retailOrderId), true)
```

- [ ] **Step 2: 运行目标测试确认失败**

Run:

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/backend
npm test -- src/ordersAccounts.routes.test.ts
```

Expected: FAIL，提示缺少 `delivery_channel` 或结算范围不符。

- [ ] **Step 3: 更新后端订单模型**

修改 `backend/src/createApp.ts`：
- 新订单和编辑订单改为使用 `delivery_channel`
- `ship_status` 只保留 `pending/shipped`
- 增加结算查询接口或复用订单查询，统一按 `greatest(total_amount - paid_amount, 0) > 0` 过滤

示例：

```ts
const settlementWhere = `where greatest(total_amount - paid_amount, 0) > 0`
```

- [ ] **Step 4: 更新前端订单表单类型**

修改 `frontend/src/lib/orderForm.ts`：

```ts
export type ShipStatus = 'pending' | 'shipped'
export type DeliveryChannel = 'private_chat' | 'platform_upload'
```

删除旧的重复发货方式映射逻辑，并同步更新测试。

- [ ] **Step 5: 更新结算页数据源**

修改 `frontend/src/pages/SettlementsPage.tsx`，不再请求 `order_type=wholesale`，而是请求新的结算数据源或使用通用订单接口筛出所有应收订单。

- [ ] **Step 6: 运行后端和前端相关测试**

Run:

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/backend
npm test -- src/ordersAccounts.routes.test.ts

cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/frontend
npm test -- src/lib/orderForm.test.ts
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git -C /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment add backend/src/createApp.ts backend/src/ordersAccounts.routes.test.ts frontend/src/lib/orderForm.ts frontend/src/lib/orderForm.test.ts frontend/src/pages/SettlementsPage.tsx
git -C /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment commit -m "Refine order delivery and settlement rules"
```

### Task 4: SKU Structured Fields And Suggestions

**Files:**
- Create: `backend/src/skuAttributes/suggestions.ts`
- Create: `backend/src/skuAttributes/suggestions.test.ts`
- Modify: `backend/src/createApp.ts`
- Create: `frontend/src/lib/skuForm.ts`
- Create: `frontend/src/lib/skuForm.test.ts`
- Create: `frontend/src/lib/skuSuggestionsApi.ts`
- Modify: `frontend/src/components/SkuPicker.tsx`
- Modify: `frontend/src/pages/ProductsPage.tsx`

- [ ] **Step 1: 为结构化 SKU 和候选沉淀写失败测试**

后端测试至少覆盖：

```ts
assert.equal(saved.category_name, '连衣裙')
assert.equal(saved.color_name, '白色')
assert.equal(saved.variant_name, 'S')
assert.equal(categorySuggestions[0].value, '连衣裙')
```

前端纯函数测试覆盖：

```ts
assert.equal(buildSkuPayload(form).category_name, '连衣裙')
assert.equal(buildSkuPayload(form).color_name, '白色')
```

- [ ] **Step 2: 运行目标测试确认失败**

Run:

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/backend
npm test -- src/skuAttributes/suggestions.test.ts src/ordersAccounts.routes.test.ts

cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/frontend
npm test -- src/lib/skuForm.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 实现后端候选项模块与接口**

在 `backend/src/skuAttributes/suggestions.ts` 实现：

```ts
export async function recordSkuAttributeSuggestions(...)
export async function listSkuAttributeSuggestions(...)
```

并在 `backend/src/createApp.ts`：
- SKU 创建/更新后写入候选项
- 暴露建议查询接口

- [ ] **Step 4: 更新商品表单模型**

在 `frontend/src/lib/skuForm.ts` 实现：

```ts
export type SkuFormState = {
  categoryName: string
  colorName: string
  variantName: string
  inventoryQuantity: string
}
```

在 `frontend/src/pages/ProductsPage.tsx`：
- 移除单一 `spec/category`
- 改成 `类目 / 颜色 / 规格 / 库存数量`
- 输入框支持建议

- [ ] **Step 5: 运行相关测试**

Run:

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/backend
npm test -- src/skuAttributes/suggestions.test.ts src/ordersAccounts.routes.test.ts

cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/frontend
npm test -- src/lib/skuForm.test.ts
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git -C /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment add backend/src/skuAttributes/suggestions.ts backend/src/skuAttributes/suggestions.test.ts backend/src/createApp.ts frontend/src/lib/skuForm.ts frontend/src/lib/skuForm.test.ts frontend/src/lib/skuSuggestionsApi.ts frontend/src/pages/ProductsPage.tsx frontend/src/components/SkuPicker.tsx
git -C /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment commit -m "Structure sku attributes and suggestions"
```

### Task 5: Product Image Compression And Create-Time Upload Flow

**Files:**
- Modify: `backend/src/productImages/config.ts`
- Modify: `backend/src/productImages/fileStore.ts`
- Modify: `backend/src/productImages/fileStore.test.ts`
- Modify: `backend/src/productImages/service.ts`
- Modify: `backend/src/productImages/routes.test.ts`
- Modify: `frontend/src/lib/productImagesApi.ts`
- Modify: `frontend/src/components/ProductImageManager.tsx`
- Modify: `frontend/src/pages/ProductsPage.tsx`
- Modify: `.env.example`
- Modify: `docker-compose.yml`（若环境变量需映射）

- [ ] **Step 1: 为原图优化保存与新建 SKU 内连续上传写失败测试**

后端测试覆盖：

```ts
assert.ok(optimized.fileSize <= originalBytes)
assert.equal(payload.images.length, 1)
```

前端行为断言：
- 新建 SKU 首次保存后不关闭弹窗
- 返回 `sku_id` 后立即显示图片管理区

- [ ] **Step 2: 运行目标测试确认失败**

Run:

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/backend
npm test -- src/productImages/fileStore.test.ts src/productImages/routes.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 实现图片优化保存**

在 `backend/src/productImages/fileStore.ts` 中把原图写入改为“优化后的原图”，例如：

```ts
const optimizedOriginal = await sharp(fileBuffer)
  .rotate()
  .resize({ width: 2200, withoutEnlargement: true })
  .jpeg({ quality: 84, mozjpeg: true })
  .toBuffer()
```

并允许通过配置控制最大边和质量。

- [ ] **Step 4: 更新前端创建流程**

在 `frontend/src/pages/ProductsPage.tsx` 中实现：
- 新建保存成功后把 `mode` 切为已创建态
- 保持弹窗打开
- 渲染 `ProductImageManager`
- 保存按钮文案切为“继续完善/保存变更”

- [ ] **Step 5: 更新环境变量说明**

在 `.env.example` 与必要的 `docker-compose.yml` 中补：

```env
PRODUCT_IMAGE_ORIGINAL_MAX_DIMENSION=2200
PRODUCT_IMAGE_ORIGINAL_QUALITY=84
```

- [ ] **Step 6: 运行相关测试**

Run:

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/backend
npm test -- src/productImages/fileStore.test.ts src/productImages/routes.test.ts
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git -C /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment add backend/src/productImages/config.ts backend/src/productImages/fileStore.ts backend/src/productImages/fileStore.test.ts backend/src/productImages/service.ts backend/src/productImages/routes.test.ts frontend/src/lib/productImagesApi.ts frontend/src/components/ProductImageManager.tsx frontend/src/pages/ProductsPage.tsx .env.example docker-compose.yml
git -C /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment commit -m "Improve product image upload flow"
```

### Task 6: Desktop-First Orders And Settlements UI

**Files:**
- Modify: `frontend/src/App.css`
- Modify: `frontend/src/pages/OrdersPage.tsx`
- Modify: `frontend/src/pages/SettlementsPage.tsx`

- [ ] **Step 1: 为订单桌面布局和按钮尺寸回归写前端状态测试**

至少补表单状态与视图区切换测试，不依赖像素级快照：

```ts
assert.equal(getVisibleShippingFields(form).includes('deliveryChannel'), form.shipStatus === 'shipped')
```

- [ ] **Step 2: 运行现有前端测试确认当前逻辑不足**

Run:

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/frontend
npm test
```

Expected: 现有测试通过，但没有覆盖新布局逻辑；新增测试先失败。

- [ ] **Step 3: 重做桌面端订单编辑布局**

修改 `frontend/src/App.css` 与 `frontend/src/pages/OrdersPage.tsx`：
- 桌面端使用多区块布局
- 底部按钮改为非全宽桌面按钮
- 发货区只在已发货时展示发货渠道与单号输入

- [ ] **Step 4: 调整结算页桌面/手机双布局**

桌面：
- 汇总卡片 + 表格

手机：
- 汇总卡片 + 卡片列表

- [ ] **Step 5: 运行前端测试和构建**

Run:

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/frontend
npm test
npm run build
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git -C /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment add frontend/src/App.css frontend/src/pages/OrdersPage.tsx frontend/src/pages/SettlementsPage.tsx frontend/src/lib/orderForm.ts frontend/src/lib/orderForm.test.ts
git -C /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment commit -m "Improve desktop order and settlement UX"
```

### Task 7: Product Page UX And Inventory Controls

**Files:**
- Modify: `frontend/src/pages/ProductsPage.tsx`
- Modify: `frontend/src/components/ProductImageManager.tsx`
- Modify: `frontend/src/App.css`

- [ ] **Step 1: 为商品页库存和建议联动写失败测试**

前端纯函数或组件测试至少覆盖：

```ts
assert.equal(isInventoryEditable('active'), true)
assert.equal(showSuggestionPanel('连衣裙', 'color'), true)
```

- [ ] **Step 2: 运行目标测试确认失败**

Run:

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/frontend
npm test -- src/lib/skuForm.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 优化商品管理桌面布局**

修改 `frontend/src/pages/ProductsPage.tsx`：
- 基础字段与图片区分区
- 图片区保持紧凑缩略图
- 桌面端并排布局，手机端纵向布局
- 库存数量作为显式字段可维护

- [ ] **Step 4: 接入建议面板**

类目输入时请求全局建议；颜色/规格输入时基于当前类目请求建议。建议失败不阻塞输入。

- [ ] **Step 5: 运行前端测试和构建**

Run:

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/frontend
npm test
npm run build
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git -C /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment add frontend/src/pages/ProductsPage.tsx frontend/src/components/ProductImageManager.tsx frontend/src/App.css frontend/src/lib/skuForm.ts frontend/src/lib/skuForm.test.ts frontend/src/lib/skuSuggestionsApi.ts
git -C /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment commit -m "Refine product management UX"
```

### Task 8: Smoke, Docs, Deploy, And Readme Sync

**Files:**
- Modify: `scripts/smoke-test.mjs`
- Modify: `README.md`
- Modify: `package.json`（仅当 smoke 命令说明需更新）

- [ ] **Step 1: 扩展 smoke 覆盖关键业务链路**

新增 smoke 断言：

```js
// 创建 SKU -> 上传图 -> 创建订单 -> 校验库存减少 -> 查结算 -> 删除订单 -> 校验库存恢复
```

- [ ] **Step 2: 更新 README**

README 至少新增：
- 新 SKU 字段说明
- 结算规则变更
- 库存事务规则
- 图片压缩与缩略图规则
- 新增环境变量说明

- [ ] **Step 3: 跑全量验证**

Run:

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/backend && npm test && npm run build
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/frontend && npm test && npm run build
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment && npm run test:smoke
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment && npm run docker:up
```

Expected:
- backend tests PASS
- frontend tests PASS
- builds PASS
- smoke PASS
- containers healthy

- [ ] **Step 4: 提交并推送**

```bash
git -C /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment add scripts/smoke-test.mjs README.md package.json
git -C /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment commit -m "Document commerce foundation phase 1"
git -C /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment push origin main
```

---

## Self-Review Checklist

- Spec coverage:
  - 订单发货模型收敛：Task 3
  - 结算页改为所有应收订单：Task 3 / Task 6
  - SKU 三字段结构化：Task 4
  - 候选项自动沉淀：Task 4
  - 创建订单即扣库存：Task 2
  - 删单/改单库存回滚：Task 2
  - 新建 SKU 同流程上传图片：Task 5
  - 图片压缩和缩略图：Task 5
  - 桌面端和手机端分别优化：Task 6 / Task 7
  - 文档、测试、Docker、Git 同步：Task 8
- Placeholder scan: 已检查，计划正文无占位描述。
- Type consistency:
  - 订单发货字段统一为 `ship_status + delivery_channel`
  - SKU 结构化字段统一为 `category_name + color_name + variant_name`
  - 库存事务统一围绕 `inventory_movements + skus.inventory_quantity`
