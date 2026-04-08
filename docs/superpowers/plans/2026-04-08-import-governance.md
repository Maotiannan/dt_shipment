# Import Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为发货管家补齐 SKU 与订单的批量导入治理能力，支持 `CSV / XLSX / XLS`、导入预检总览、重复项覆盖与库存事务。

**Architecture:** 后端新增独立导入模块，分别处理文件解析、预检、确认导入；前端新增通用导入预览组件，并把订单、SKU 的导入统一为“选择文件 -> 预检总览 -> 修正/删除 -> 确认导入”的流程。订单确认导入继续复用现有库存账本事务，SKU 导入通过库存账本写入 `manual_adjustment`。

**Tech Stack:** React 19, TypeScript, Express 5, PostgreSQL 16, XLSX, 现有 inventory ledger / apiRequest / smoke 脚本

---

### Task 1: 后端导入模型与解析入口

**Files:**
- Create: `backend/src/imports/types.ts`
- Create: `backend/src/imports/parsers.ts`
- Test: `backend/src/imports/parsers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('parseSpreadsheetRows accepts csv, xlsx, and xls buffers', async () => {
  const csv = Buffer.from('sku_code,name\nSKU-1,Alpha\n', 'utf8')
  const rows = await parseSpreadsheetRows({
    filename: 'skus.csv',
    contentType: 'text/csv',
    buffer: csv,
  })

  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.sku_code, 'SKU-1')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/backend && npm test -- src/imports/parsers.test.ts`  
Expected: FAIL with missing module or missing export

- [ ] **Step 3: Write minimal implementation**

```ts
export async function parseSpreadsheetRows(input: SpreadsheetInput) {
  const workbook = XLSX.read(input.buffer, { type: 'buffer' })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0] ?? '']
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, {
    defval: '',
    raw: false,
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/backend && npm test -- src/imports/parsers.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment
git add backend/src/imports/types.ts backend/src/imports/parsers.ts backend/src/imports/parsers.test.ts
git commit -m "Add spreadsheet parser for import flows"
```

### Task 2: SKU 导入预检与确认导入

**Files:**
- Create: `backend/src/imports/skuImport.ts`
- Modify: `backend/src/createApp.ts`
- Test: `backend/src/imports/skuImport.test.ts`
- Test: `backend/src/ordersAccounts.routes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('previewSkuImport flags duplicate sku codes and builds default overwrite actions', async () => {
  const preview = await previewSkuImport(pool, [
    { sku_code: 'SKU-1', name: 'Alpha', inventory_quantity: '5' },
    { sku_code: 'SKU-1', name: 'Alpha-dup', inventory_quantity: '8' },
  ])

  assert.equal(preview.rows.length, 2)
  assert.match(preview.rows[1]?.errors[0] ?? '', /重复/i)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/backend && npm test -- src/imports/skuImport.test.ts`  
Expected: FAIL with missing module or missing function

- [ ] **Step 3: Write minimal implementation**

```ts
export async function previewSkuImport(pool: Pool, rows: Record<string, unknown>[]) {
  const duplicates = new Set<string>()
  const seen = new Set<string>()
  for (const row of rows) {
    const skuCode = String(row.sku_code ?? '').trim()
    if (seen.has(skuCode)) duplicates.add(skuCode)
    seen.add(skuCode)
  }

  return {
    rows: rows.map((row, index) => ({
      row_index: index + 1,
      key: String(row.sku_code ?? '').trim(),
      action: 'create',
      errors: duplicates.has(String(row.sku_code ?? '').trim()) ? ['同批次 SKU 编码重复'] : [],
    })),
  }
}
```

- [ ] **Step 4: Extend route coverage before implementation**

Add route tests for:
- `POST /api/skus/import/preview`
- `POST /api/skus/import/commit`
- existing SKU overwritten through `sku_code`
- inventory written through `manual_adjustment`

Run: `cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/backend && npm test -- src/ordersAccounts.routes.test.ts src/imports/skuImport.test.ts`  
Expected: FAIL on new route assertions

- [ ] **Step 5: Implement minimal route integration**

```ts
app.post('/api/skus/import/preview', requireAuth, async (req, res) => {
  const preview = await previewSkuImport(pool, req.body.rows ?? [])
  res.json(preview)
})

app.post('/api/skus/import/commit', requireAuth, async (req, res) => {
  const result = await commitSkuImport(pool, req.body.rows ?? [])
  res.json(result)
})
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/backend && npm test -- src/ordersAccounts.routes.test.ts src/imports/skuImport.test.ts`  
Expected: PASS

- [ ] **Step 7: Commit**

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment
git add backend/src/imports/skuImport.ts backend/src/createApp.ts backend/src/imports/skuImport.test.ts backend/src/ordersAccounts.routes.test.ts
git commit -m "Add sku import preview and commit routes"
```

### Task 3: 订单导入预检与确认导入

**Files:**
- Create: `backend/src/imports/orderImport.ts`
- Modify: `backend/src/createApp.ts`
- Modify: `backend/src/ordersAccounts.routes.test.ts`
- Test: `backend/src/imports/orderImport.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('previewOrderImport marks duplicate order ids and missing sku references as errors', async () => {
  const preview = await previewOrderImport(pool, [
    { order_id: 'ORDER-1', buyer_name: 'A', sku_code: 'MISSING', qty: '2', unit_price: '8' },
    { order_id: 'ORDER-1', buyer_name: 'B', sku_code: 'MISSING', qty: '1', unit_price: '8' },
  ])

  assert.match(preview.rows[0]?.errors.join(',') ?? '', /SKU/i)
  assert.match(preview.rows[1]?.errors.join(',') ?? '', /重复/i)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/backend && npm test -- src/imports/orderImport.test.ts`  
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```ts
export async function previewOrderImport(pool: Pool, rows: Record<string, unknown>[]) {
  // normalize -> resolve existing orders -> resolve sku codes -> compute errors
}
```

Required behavior:
- duplicate `order_id` in same file => error
- missing SKU => error
- existing `order_id` => action defaults to `overwrite`
- preview response includes `can_commit`

- [ ] **Step 4: Extend route tests before implementation**

Add route tests for:
- `POST /api/orders/import/preview`
- `POST /api/orders/import/commit`
- overwrite existing order with inventory rollback and re-apply

Run: `cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/backend && npm test -- src/ordersAccounts.routes.test.ts src/imports/orderImport.test.ts`  
Expected: FAIL on new route assertions

- [ ] **Step 5: Implement minimal route integration**

```ts
app.post('/api/orders/import/preview', requireAuth, async (req, res) => {
  res.json(await previewOrderImport(pool, req.body.rows ?? []))
})

app.post('/api/orders/import/commit', requireAuth, async (req, res) => {
  res.json(await commitOrderImport(pool, req.body.rows ?? []))
})
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/backend && npm test -- src/ordersAccounts.routes.test.ts src/imports/orderImport.test.ts`  
Expected: PASS

- [ ] **Step 7: Commit**

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment
git add backend/src/imports/orderImport.ts backend/src/createApp.ts backend/src/imports/orderImport.test.ts backend/src/ordersAccounts.routes.test.ts
git commit -m "Add governed order import preview and commit routes"
```

### Task 4: 前端导入总览与 SKU 导入入口

**Files:**
- Create: `frontend/src/lib/importPreview.ts`
- Create: `frontend/src/lib/importPreview.test.ts`
- Create: `frontend/src/components/ImportPreviewTable.tsx`
- Create: `frontend/src/components/SkusImportDialog.tsx`
- Modify: `frontend/src/pages/ProductsPage.tsx`

- [ ] **Step 1: Write the failing test**

```ts
test('summarizeImportPreview counts errors, warnings, and overwrite rows', () => {
  const summary = summarizeImportPreview([
    { status: 'error', action: 'overwrite' },
    { status: 'warning', action: 'create' },
  ])

  assert.equal(summary.errorCount, 1)
  assert.equal(summary.overwriteCount, 1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/frontend && npm test -- src/lib/importPreview.test.ts`  
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```ts
export function summarizeImportPreview(rows: ImportPreviewRow[]) {
  return {
    errorCount: rows.filter((row) => row.status === 'error').length,
    warningCount: rows.filter((row) => row.status === 'warning').length,
    overwriteCount: rows.filter((row) => row.action === 'overwrite').length,
  }
}
```

- [ ] **Step 4: Implement SKU import dialog**

Required behavior:
- accept `.csv,.xlsx,.xls`
- upload parsed rows to `/api/skus/import/preview`
- render preview table
- allow editing/removing preview rows locally
- disable confirm while errors remain

- [ ] **Step 5: Run frontend tests**

Run: `cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/frontend && npm test -- src/lib/importPreview.test.ts src/lib/skuForm.test.ts`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment
git add frontend/src/lib/importPreview.ts frontend/src/lib/importPreview.test.ts frontend/src/components/ImportPreviewTable.tsx frontend/src/components/SkusImportDialog.tsx frontend/src/pages/ProductsPage.tsx
git commit -m "Add sku import preview flow"
```

### Task 5: 前端订单导入治理改造

**Files:**
- Modify: `frontend/src/components/OrdersCsvImport.tsx`
- Create: `frontend/src/components/OrdersImportDialog.tsx`
- Modify: `frontend/src/pages/OrdersPage.tsx`
- Test: `frontend/src/lib/importPreview.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('canCommitImportPreview returns false when any row has error', () => {
  assert.equal(
    canCommitImportPreview([{ status: 'error' }, { status: 'success' }]),
    false
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/frontend && npm test -- src/lib/importPreview.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement minimal shared preview gating**

```ts
export function canCommitImportPreview(rows: ImportPreviewRow[]) {
  return rows.every((row) => row.status !== 'error')
}
```

- [ ] **Step 4: Replace direct order import with preview flow**

Required behavior:
- file selection accepts `.csv,.xlsx,.xls`
- preview via `/api/orders/import/preview`
- support local row edit/delete
- commit via `/api/orders/import/commit`
- preserve old template compatibility

- [ ] **Step 5: Run frontend tests**

Run: `cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/frontend && npm test -- src/lib/importPreview.test.ts src/lib/orderForm.test.ts`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment
git add frontend/src/components/OrdersCsvImport.tsx frontend/src/components/OrdersImportDialog.tsx frontend/src/pages/OrdersPage.tsx frontend/src/lib/importPreview.ts frontend/src/lib/importPreview.test.ts
git commit -m "Govern order import with preview and overwrite workflow"
```

### Task 6: 文档、回归与发布

**Files:**
- Modify: `scripts/smoke-test.mjs`
- Modify: `README.md`
- Modify: `package.json`

- [ ] **Step 1: Write failing smoke assertions**

Extend smoke to call:
- `POST /api/skus/import/preview`
- `POST /api/orders/import/preview`

Expected first run: FAIL because endpoints or payloads are missing

- [ ] **Step 2: Update docs and version**

Required updates:
- version bump
- README import section
- supported file types
- preview/commit flow

- [ ] **Step 3: Run full verification**

Run:

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/backend && npm test && npm run build
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/frontend && npm test && npm run build
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment && npm run test:smoke
```

Expected: all pass

- [ ] **Step 4: Sync local runtime and push**

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment
docker compose up -d --build backend frontend
git add README.md package.json scripts/smoke-test.mjs
git commit -m "Release governed sku and order import flow"
git push origin main
```
