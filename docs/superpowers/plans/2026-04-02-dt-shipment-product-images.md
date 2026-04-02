# DT Shipment Product Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `dt_shipment` 增加商品多图、主图、缩略图、NAS 私有存储、回收区与 API 自动化验证，并且不影响现有 `Alist / PicList` 的可见范围。

**Architecture:** 后端继续以 `skus` 作为商品主表，新增 `product_images` 元数据表；图片原图、缩略图、回收区文件全部落到 `DAINTY_SHIPMENT` NAS 私有目录。浏览器只通过 `dt_shipment` 后端的受保护接口读写图片，前端商品页增加图片管理组件，但核心验收以 API 自动化测试和 smoke 脚本为主。

**Tech Stack:** PostgreSQL 16, Express 5, TypeScript, Node.js `tsx --test`, React 19, Vite, Docker Compose, SMB NAS, Cloudflare Tunnel

---

### Task 1: Extract Backend App Factory and Image Config

**Files:**
- Create: `backend/src/createApp.ts`
- Create: `backend/src/productImages/config.ts`
- Create: `backend/src/productImages/config.test.ts`
- Modify: `backend/src/server.ts`
- Modify: `backend/package.json`
- Modify: `backend/package-lock.json`
- Modify: `backend/.env.example`
- Modify: `.env.example`

- [ ] **Step 1: Write the failing config test**

```ts
// backend/src/productImages/config.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadProductImageConfig } from './config.js'

test('loads product image config from env-like input', () => {
  const config = loadProductImageConfig({
    PRODUCT_IMAGE_ROOT: '/data/assets/products',
    PRODUCT_IMAGE_TMP_DIR: '/data/assets/uploads/tmp',
    PRODUCT_IMAGE_MAX_FILES: '12',
    PRODUCT_IMAGE_MAX_FILE_MB: '10',
    PRODUCT_IMAGE_ALLOWED_MIME: 'image/jpeg,image/png,image/webp',
    PRODUCT_IMAGE_THUMB_WIDTH: '480',
    PRODUCT_IMAGE_TRASH_RETENTION_DAYS: '30',
  })

  assert.equal(config.rootDir, '/data/assets/products')
  assert.equal(config.tmpDir, '/data/assets/uploads/tmp')
  assert.equal(config.maxFiles, 12)
  assert.equal(config.maxFileBytes, 10 * 1024 * 1024)
  assert.deepEqual(config.allowedMimeTypes, ['image/jpeg', 'image/png', 'image/webp'])
  assert.equal(config.thumbWidth, 480)
  assert.equal(config.trashRetentionDays, 30)
})
```

- [ ] **Step 2: Run the backend test to confirm it fails**

Run:

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/backend
npx tsx --test src/productImages/config.test.ts
```

Expected: FAIL with `Cannot find module './config.js'` or missing export errors.

- [ ] **Step 3: Add backend image dependencies, env examples, config loader, and app factory**

```json
// backend/package.json
{
  "dependencies": {
    "multer": "^2.0.2",
    "sharp": "^0.34.4"
  },
  "devDependencies": {
    "@types/multer": "^2.0.0"
  }
}
```

```ts
// backend/src/productImages/config.ts
export type ProductImageConfig = {
  rootDir: string
  tmpDir: string
  maxFiles: number
  maxFileBytes: number
  allowedMimeTypes: string[]
  thumbWidth: number
  trashRetentionDays: number
}

export function loadProductImageConfig(
  env: NodeJS.ProcessEnv = process.env
): ProductImageConfig {
  const maxFileMb = Number(env.PRODUCT_IMAGE_MAX_FILE_MB ?? 10)

  return {
    rootDir: env.PRODUCT_IMAGE_ROOT ?? '/data/assets/products',
    tmpDir: env.PRODUCT_IMAGE_TMP_DIR ?? '/data/assets/uploads/tmp',
    maxFiles: Number(env.PRODUCT_IMAGE_MAX_FILES ?? 12),
    maxFileBytes: maxFileMb * 1024 * 1024,
    allowedMimeTypes: (env.PRODUCT_IMAGE_ALLOWED_MIME ?? 'image/jpeg,image/png,image/webp')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    thumbWidth: Number(env.PRODUCT_IMAGE_THUMB_WIDTH ?? 480),
    trashRetentionDays: Number(env.PRODUCT_IMAGE_TRASH_RETENTION_DAYS ?? 30),
  }
}
```

```ts
// backend/src/createApp.ts
import cors from 'cors'
import express from 'express'

export function createApp() {
  const app = express()
  app.use(cors())
  app.use(express.json({ limit: '2mb' }))
  return app
}
```

```ts
// backend/src/server.ts
import dotenv from 'dotenv'
import { createApp } from './createApp.js'

dotenv.config()

const app = createApp()
const port = Number(process.env.PORT ?? 8787)

app.listen(port, () => {
  console.log(`API listening on :${port}`)
})
```

```env
# .env.example and backend/.env.example
PRODUCT_IMAGE_ROOT=/Volumes/团队文件-DAINTY_SHIPMENT/docker/dt_shipment/assets/products
PRODUCT_IMAGE_TMP_DIR=/Volumes/团队文件-DAINTY_SHIPMENT/docker/dt_shipment/assets/uploads/tmp
PRODUCT_IMAGE_MAX_FILES=12
PRODUCT_IMAGE_MAX_FILE_MB=10
PRODUCT_IMAGE_ALLOWED_MIME=image/jpeg,image/png,image/webp
PRODUCT_IMAGE_THUMB_WIDTH=480
PRODUCT_IMAGE_TRASH_RETENTION_DAYS=30
```

- [ ] **Step 4: Re-run backend tests**

Run:

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/backend
npm install
npm test
```

Expected: PASS for `appMeta` tests and the new `config.test.ts`.

- [ ] **Step 5: Commit the task**

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment
git add backend/package.json backend/package-lock.json backend/.env.example .env.example backend/src/createApp.ts backend/src/productImages/config.ts backend/src/productImages/config.test.ts backend/src/server.ts
git commit -m "feat: add product image config scaffolding"
```

### Task 2: Add Product Image Schema and Pure Ordering Rules

**Files:**
- Create: `backend/src/productImages/reorder.ts`
- Create: `backend/src/productImages/reorder.test.ts`
- Modify: `backend/db/init.sql`
- Modify: `backend/src/scripts/initDb.ts`

- [ ] **Step 1: Write the failing ordering test**

```ts
// backend/src/productImages/reorder.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  moveImageByDelta,
  nextPrimaryAfterDelete,
  resequenceSortOrder,
} from './reorder.js'

test('moveImageByDelta swaps sort positions safely', () => {
  const result = moveImageByDelta(
    [
      { image_id: 'a', sort_order: 1, is_primary: true },
      { image_id: 'b', sort_order: 2, is_primary: false },
      { image_id: 'c', sort_order: 3, is_primary: false },
    ],
    'b',
    -1
  )

  assert.deepEqual(
    result.map((item) => [item.image_id, item.sort_order]),
    [
      ['b', 1],
      ['a', 2],
      ['c', 3],
    ]
  )
})

test('nextPrimaryAfterDelete promotes the earliest surviving image', () => {
  const next = nextPrimaryAfterDelete([
    { image_id: 'b', sort_order: 2, is_primary: false },
    { image_id: 'c', sort_order: 3, is_primary: false },
  ])

  assert.equal(next?.image_id, 'b')
})
```

- [ ] **Step 2: Run the failing helper test**

Run:

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/backend
npx tsx --test src/productImages/reorder.test.ts
```

Expected: FAIL with missing module/export errors.

- [ ] **Step 3: Implement ordering helper and schema**

```ts
// backend/src/productImages/reorder.ts
type ImageOrder = { image_id: string; sort_order: number; is_primary: boolean }

export function resequenceSortOrder(items: ImageOrder[]) {
  return [...items]
    .sort((left, right) => left.sort_order - right.sort_order)
    .map((item, index) => ({ ...item, sort_order: index + 1 }))
}

export function moveImageByDelta(items: ImageOrder[], imageId: string, delta: -1 | 1) {
  const next = resequenceSortOrder(items)
  const index = next.findIndex((item) => item.image_id === imageId)
  const targetIndex = index + delta

  if (index < 0 || targetIndex < 0 || targetIndex >= next.length) {
    return next
  }

  ;[next[index], next[targetIndex]] = [next[targetIndex], next[index]]
  return resequenceSortOrder(next)
}

export function nextPrimaryAfterDelete(items: ImageOrder[]) {
  return resequenceSortOrder(items)[0] ?? null
}
```

```sql
-- backend/db/init.sql
create table if not exists product_images (
  image_id uuid primary key default gen_random_uuid(),
  sku_id uuid not null references skus(sku_id) on delete cascade,
  storage_key text not null unique,
  original_relpath text not null,
  thumb_relpath text not null,
  mime_type text not null,
  file_ext text not null,
  file_size bigint not null,
  width integer not null,
  height integer not null,
  sha256 text not null,
  sort_order integer not null,
  is_primary boolean not null default false,
  status text not null default 'active',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists product_images_sku_sort_idx
  on product_images(sku_id, sort_order);

create index if not exists product_images_primary_idx
  on product_images(sku_id, is_primary)
  where status = 'active';

create index if not exists product_images_status_idx
  on product_images(status, deleted_at);
```

```ts
// backend/src/scripts/initDb.ts
await pool.query('create extension if not exists pgcrypto;')
await pool.query(sql)
```

- [ ] **Step 4: Re-run helper tests and database init**

Run:

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/backend
npx tsx --test src/productImages/reorder.test.ts
npm run db:init
```

Expected:
- `reorder.test.ts`: PASS
- `npm run db:init`: prints `DB initialized.`

- [ ] **Step 5: Commit the task**

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment
git add backend/src/productImages/reorder.ts backend/src/productImages/reorder.test.ts backend/db/init.sql backend/src/scripts/initDb.ts
git commit -m "feat: add product image schema and ordering helpers"
```

### Task 3: Add Protected Image Upload and Read Endpoints

**Files:**
- Create: `backend/src/productImages/repository.ts`
- Create: `backend/src/productImages/fileStore.ts`
- Create: `backend/src/productImages/service.ts`
- Create: `backend/src/productImages/routes.ts`
- Create: `backend/src/productImages/routes.test.ts`
- Modify: `backend/src/createApp.ts`

- [ ] **Step 1: Write the failing API test for upload and read**

```ts
// backend/src/productImages/routes.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createApp } from '../createApp.js'

const tinyJpeg = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBUQEBAVFRUVFRUVFRUVFRUVFRUXFhUXFhUVFRUYHSggGBolHRUVITEhJSkrLi4uFx8zODMsNygtLisBCgoKDg0OFQ8PFSsdFR0rKy0rKysrKystKy0rLS0rLS0tLS0rKysrLS0rKysrKysrKysrKysrKysrK//AABEIAAEAAgMBIgACEQEDEQH/xAAXAAADAQAAAAAAAAAAAAAAAAAAAQID/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEAMQAAAB4A//xAAZEAEAAgMAAAAAAAAAAAAAAAABABEhMUH/2gAIAQEAAT8AqkN2r//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8Af//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8Af//Z',
  'base64'
)

test('upload returns first image as primary and serves thumb/original', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'dt-shipment-images-'))
  const app = createApp()
  const server = createServer(app)
  server.listen(0)
  await once(server, 'listening')

  t.after(async () => {
    server.close()
    await rm(tempRoot, { recursive: true, force: true })
  })

  const { port } = server.address() as { port: number }
  const loginRes = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: '123456' }),
  })

  const login = await loginRes.json()
  const skuRes = await fetch(`http://127.0.0.1:${port}/api/skus`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${login.token}`,
    },
    body: JSON.stringify({
      sku_code: `TEST-${Date.now()}`,
      name: 'Route test product',
      spec: '2张测试图',
      unit_price: 1,
      category: 'test',
      status: 'active',
    }),
  })
  const sku = await skuRes.json()

  const form = new FormData()
  form.append('files', new Blob([tinyJpeg], { type: 'image/jpeg' }), 'cover.jpg')
  form.append('files', new Blob([tinyJpeg], { type: 'image/jpeg' }), 'detail.jpg')

  const uploadRes = await fetch(`http://127.0.0.1:${port}/api/skus/${sku.sku_id}/images`, {
    method: 'POST',
    headers: { authorization: `Bearer ${login.token}` },
    body: form,
  })

  assert.equal(uploadRes.status, 201)
  const payload = await uploadRes.json()
  assert.equal(payload.images[0].is_primary, true)
  assert.equal(payload.images.length, 2)
})
```

- [ ] **Step 2: Run the API test to confirm it fails**

Run:

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/backend
npx tsx --test src/productImages/routes.test.ts
```

Expected: FAIL because `/api/skus/:id/images` and image read routes do not exist.

- [ ] **Step 3: Implement repository, file store, service, and routes**

```ts
// backend/src/productImages/repository.ts
import { pool } from '../db.js'

export async function listActiveProductImages(skuId: string) {
  const { rows } = await pool.query(
    `select * from product_images
     where sku_id = $1 and status = 'active'
     order by sort_order asc, created_at asc`,
    [skuId]
  )
  return rows
}

export async function insertProductImage(input: {
  skuId: string
  storageKey: string
  originalRelpath: string
  thumbRelpath: string
  mimeType: string
  fileExt: string
  fileSize: number
  width: number
  height: number
  sha256: string
  sortOrder: number
  isPrimary: boolean
}) {
  const { rows } = await pool.query(
    `insert into product_images(
      sku_id, storage_key, original_relpath, thumb_relpath,
      mime_type, file_ext, file_size, width, height, sha256,
      sort_order, is_primary
    ) values (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
    ) returning *`,
    [
      input.skuId,
      input.storageKey,
      input.originalRelpath,
      input.thumbRelpath,
      input.mimeType,
      input.fileExt,
      input.fileSize,
      input.width,
      input.height,
      input.sha256,
      input.sortOrder,
      input.isPrimary,
    ]
  )
  return rows[0]
}
```

```ts
// backend/src/productImages/fileStore.ts
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import sharp from 'sharp'
import { loadProductImageConfig } from './config.js'

export async function persistProductImage(params: {
  skuId: string
  imageId: string
  sourcePath: string
  originalFilename: string
}) {
  const config = loadProductImageConfig()
  const ext = path.extname(params.originalFilename).toLowerCase() || '.jpg'
  const originalRelpath = path.join('original', params.skuId, `${params.imageId}${ext}`)
  const thumbRelpath = path.join('thumb', params.skuId, `${params.imageId}.jpg`)
  const originalAbs = path.join(config.rootDir, originalRelpath)
  const thumbAbs = path.join(config.rootDir, thumbRelpath)

  await fs.mkdir(path.dirname(originalAbs), { recursive: true })
  await fs.mkdir(path.dirname(thumbAbs), { recursive: true })
  await fs.copyFile(params.sourcePath, originalAbs)

  const original = sharp(params.sourcePath)
  const meta = await original.metadata()
  await original
    .resize({ width: config.thumbWidth, withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toFile(thumbAbs)

  const fileBuffer = await fs.readFile(params.sourcePath)
  return {
    originalRelpath,
    thumbRelpath,
    fileExt: ext,
    fileSize: fileBuffer.byteLength,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    sha256: crypto.createHash('sha256').update(fileBuffer).digest('hex'),
  }
}
```

```ts
// backend/src/productImages/routes.ts
import multer from 'multer'
import { Router } from 'express'
import { requireAuth } from '../auth.js'
import { uploadProductImages, readProductImageBinary } from './service.js'

const upload = multer({ dest: loadProductImageConfig().tmpDir })
export const productImageRouter = Router()

productImageRouter.post(
  '/api/skus/:id/images',
  requireAuth,
  upload.array('files', loadProductImageConfig().maxFiles),
  async (req, res) => {
    const images = await uploadProductImages({
      skuId: req.params.id,
      files: (req.files ?? []) as Express.Multer.File[],
    })

    res.status(201).json({ images })
  }
)

productImageRouter.get('/api/product-images/:imageId/thumb', requireAuth, async (req, res) => {
  const file = await readProductImageBinary(req.params.imageId, 'thumb')
  res.type(file.contentType).send(file.buffer)
})

productImageRouter.get('/api/product-images/:imageId/original', requireAuth, async (req, res) => {
  const file = await readProductImageBinary(req.params.imageId, 'original')
  res.type(file.contentType).send(file.buffer)
})
```

```ts
// backend/src/createApp.ts
import { productImageRouter } from './productImages/routes.js'

export function createApp() {
  const app = express()
  app.use(cors())
  app.use(express.json({ limit: '2mb' }))
  app.use(productImageRouter)
  return app
}
```

- [ ] **Step 4: Re-run backend route tests**

Run:

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/backend
npx tsx --test src/productImages/routes.test.ts
npm test
```

Expected:
- `routes.test.ts`: PASS
- `npm test`: all backend tests PASS

- [ ] **Step 5: Commit the task**

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment
git add backend/src/createApp.ts backend/src/productImages/repository.ts backend/src/productImages/fileStore.ts backend/src/productImages/service.ts backend/src/productImages/routes.ts backend/src/productImages/routes.test.ts
git commit -m "feat: add protected product image upload and read routes"
```

### Task 4: Add Primary/Order/Delete/Cleanup Behavior and Smoke Coverage

**Files:**
- Create: `backend/src/productImages/service.test.ts`
- Modify: `backend/src/productImages/service.ts`
- Modify: `backend/src/createApp.ts`
- Modify: `backend/src/server.ts`
- Modify: `scripts/smoke-test.mjs`

- [ ] **Step 1: Write the failing service test for primary promotion, reorder, and cleanup**

```ts
// backend/src/productImages/service.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  nextPrimaryAfterDelete,
  moveImageByDelta,
} from './reorder.js'

test('deleting the current primary promotes the first surviving image', () => {
  const next = nextPrimaryAfterDelete([
    { image_id: 'second', sort_order: 1, is_primary: false },
    { image_id: 'third', sort_order: 2, is_primary: false },
  ])

  assert.equal(next?.image_id, 'second')
})

test('moving the first image upward is a no-op', () => {
  const result = moveImageByDelta(
    [{ image_id: 'first', sort_order: 1, is_primary: true }],
    'first',
    -1
  )

  assert.equal(result[0]?.sort_order, 1)
})
```

- [ ] **Step 2: Run the failing service test**

Run:

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/backend
npx tsx --test src/productImages/service.test.ts
```

Expected: FAIL until the product image service exposes primary/reorder/delete orchestration.

- [ ] **Step 3: Implement mutate endpoints, SKU image summaries, cleanup route, and smoke script**

```ts
// backend/src/productImages/service.ts
export async function markProductImagePrimary(skuId: string, imageId: string) {
  await pool.query('begin')
  try {
    await pool.query(
      `update product_images
       set is_primary = false, updated_at = now()
       where sku_id = $1 and status = 'active'`,
      [skuId]
    )
    await pool.query(
      `update product_images
       set is_primary = true, updated_at = now()
       where sku_id = $1 and image_id = $2 and status = 'active'`,
      [skuId, imageId]
    )
    await pool.query('commit')
  } catch (error) {
    await pool.query('rollback')
    throw error
  }
}

export async function softDeleteProductImage(skuId: string, imageId: string) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const current = await getProductImageForUpdate(client, skuId, imageId)
    await moveImagePairToTrash(current)

    await client.query(
      `update product_images
       set status = 'deleted', deleted_at = now(), is_primary = false, updated_at = now()
       where sku_id = $1 and image_id = $2`,
      [skuId, imageId]
    )

    const remaining = await listActiveProductImagesTx(client, skuId)
    const nextPrimary = nextPrimaryAfterDelete(remaining)

    if (nextPrimary) {
      await client.query(
        `update product_images
         set is_primary = true, updated_at = now()
         where image_id = $1`,
        [nextPrimary.image_id]
      )
    }

    await client.query('commit')
    return { ok: true, nextPrimaryImageId: nextPrimary?.image_id ?? null }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export async function cleanupDeletedProductImages() {
  const expiredRows = await listExpiredDeletedImages()

  for (const row of expiredRows) {
    await removeTrashFilePair(row)
  }

  return {
    deletedFileCount: expiredRows.length * 2,
    imageCount: expiredRows.length,
  }
}
```

```ts
// backend/src/createApp.ts
app.patch('/api/skus/:id/images/:imageId/primary', requireAuth, async (req, res) => {
  await markProductImagePrimary(req.params.id, req.params.imageId)
  res.json({ ok: true })
})

app.patch('/api/skus/:id/images/reorder', requireAuth, async (req, res) => {
  const images = await reorderProductImages(req.params.id, req.body.imageIds)
  res.json({ images })
})

app.delete('/api/skus/:id/images/:imageId', requireAuth, async (req, res) => {
  const result = await softDeleteProductImage(req.params.id, req.params.imageId)
  res.json(result)
})

app.post('/api/internal/jobs/cleanup-product-images', requireAuth, async (_req, res) => {
  const result = await cleanupDeletedProductImages()
  res.json({ ok: true, ...result })
})

app.get('/api/skus/:id', requireAuth, async (req, res) => {
  const sku = await getSkuById(req.params.id)
  const images = await listActiveProductImages(req.params.id)
  res.json({
    ...sku,
    images: images.map(toProductImageDto),
  })
})

app.get('/api/skus', requireAuth, async (_req, res) => {
  const rows = await listSkusWithPrimaryImageSummary()
  res.json(rows)
})
```

```js
// scripts/smoke-test.mjs
const skuName = `Smoke SKU ${Date.now()}`

const createdSku = await expectJson('/api/skus', {
  method: 'POST',
  headers: {
    ...jsonHeaders,
    authorization: `Bearer ${login.token}`,
  },
  body: JSON.stringify({
    sku_code: `SMOKE-${Date.now()}`,
    name: skuName,
    spec: 'smoke image product',
    unit_price: 1,
    category: 'smoke',
    status: 'active',
  }),
})

const form = new FormData()
form.append('files', new Blob([tinyJpeg], { type: 'image/jpeg' }), 'cover.jpg')
form.append('files', new Blob([tinyJpeg], { type: 'image/jpeg' }), 'detail.jpg')

const uploadResponse = await fetch(`${baseUrl}/api/skus/${createdSku.sku_id}/images`, {
  method: 'POST',
  headers: { authorization: `Bearer ${login.token}` },
  body: form,
})

if (!uploadResponse.ok) {
  throw new Error(`image upload failed: ${uploadResponse.status}`)
}
```

- [ ] **Step 4: Run full backend verification and smoke test**

Run:

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/backend
npm test

cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment
set -a
source .env
set +a
node scripts/smoke-test.mjs
```

Expected:
- backend tests PASS
- smoke output includes created SKU, uploaded image count, and `ok: true`

- [ ] **Step 5: Commit the task**

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment
git add backend/src/productImages/service.ts backend/src/productImages/service.test.ts backend/src/createApp.ts backend/src/server.ts scripts/smoke-test.mjs
git commit -m "feat: add product image lifecycle endpoints"
```

### Task 5: Add Frontend Product Image State and UI

**Files:**
- Create: `frontend/src/lib/productImageState.ts`
- Create: `frontend/src/lib/productImageState.test.ts`
- Create: `frontend/src/lib/productImagesApi.ts`
- Create: `frontend/src/components/ProductImageManager.tsx`
- Modify: `frontend/src/pages/ProductsPage.tsx`
- Modify: `frontend/src/App.css`

- [ ] **Step 1: Write the failing frontend helper test**

```ts
// frontend/src/lib/productImageState.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyPrimaryImage,
  moveImage,
  normalizeUploadedImages,
} from './productImageState'

test('normalizeUploadedImages keeps the first uploaded image as primary', () => {
  const images = normalizeUploadedImages([
    { image_id: 'a', sort_order: 1, is_primary: true },
    { image_id: 'b', sort_order: 2, is_primary: false },
  ])

  assert.equal(images[0]?.is_primary, true)
})

test('moveImage swaps adjacent items and resequences sort_order', () => {
  const images = moveImage(
    [
      { image_id: 'a', sort_order: 1, is_primary: true },
      { image_id: 'b', sort_order: 2, is_primary: false },
    ],
    'b',
    -1
  )

  assert.deepEqual(
    images.map((item) => [item.image_id, item.sort_order]),
    [
      ['b', 1],
      ['a', 2],
    ]
  )
})
```

- [ ] **Step 2: Run the frontend helper test to confirm it fails**

Run:

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/frontend
npx tsx --test src/lib/productImageState.test.ts
```

Expected: FAIL because `productImageState.ts` does not exist yet.

- [ ] **Step 3: Implement the helper, API wrapper, image manager component, and page integration**

```ts
// frontend/src/lib/productImageState.ts
export type ProductImage = {
  image_id: string
  sort_order: number
  is_primary: boolean
  thumb_url: string
  original_url: string
}

export function normalizeUploadedImages(images: ProductImage[]) {
  return [...images].sort((left, right) => left.sort_order - right.sort_order)
}

export function applyPrimaryImage(images: ProductImage[], imageId: string) {
  return images.map((image) => ({
    ...image,
    is_primary: image.image_id === imageId,
  }))
}

export function moveImage(images: ProductImage[], imageId: string, delta: -1 | 1) {
  const next = [...images].sort((left, right) => left.sort_order - right.sort_order)
  const index = next.findIndex((item) => item.image_id === imageId)
  const target = index + delta
  if (index < 0 || target < 0 || target >= next.length) return next
  ;[next[index], next[target]] = [next[target], next[index]]
  return next.map((item, idx) => ({ ...item, sort_order: idx + 1 }))
}
```

```ts
// frontend/src/lib/productImagesApi.ts
import { apiRequest, getToken } from './apiClient'
import { resolveApiBase } from './runtimeConfig'

const API_BASE = resolveApiBase(import.meta.env.VITE_API_BASE as string | undefined)

export async function uploadProductImages(skuId: string, files: File[]) {
  const form = new FormData()
  for (const file of files) form.append('files', file)
  const response = await fetch(`${API_BASE}/api/skus/${skuId}/images`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${getToken() ?? ''}`,
    },
    body: form,
  })
  if (!response.ok) throw new Error('图片上传失败')
  return response.json()
}

export function setPrimaryProductImage(skuId: string, imageId: string) {
  return apiRequest(`/api/skus/${skuId}/images/${imageId}/primary`, { method: 'PATCH' })
}

export function reorderProductImages(skuId: string, imageIds: string[]) {
  return apiRequest(`/api/skus/${skuId}/images/reorder`, {
    method: 'PATCH',
    body: JSON.stringify({ imageIds }),
  })
}

export function deleteProductImage(skuId: string, imageId: string) {
  return apiRequest(`/api/skus/${skuId}/images/${imageId}`, { method: 'DELETE' })
}

export function buildProtectedImageUrl(imageId: string, kind: 'thumb' | 'original') {
  return `${API_BASE}/api/product-images/${imageId}/${kind}`
}
```

```tsx
// frontend/src/components/ProductImageManager.tsx
export function ProductImageManager(props: {
  skuId: string | null
  images: ProductImage[]
  onUploaded: () => Promise<void>
  onSetPrimary: (imageId: string) => Promise<void>
  onMove: (imageId: string, delta: -1 | 1) => Promise<void>
  onDelete: (imageId: string) => Promise<void>
}) {
  return (
    <section className="productImagePanel">
      <h3>商品图片</h3>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        onChange={async (event) => {
          if (!props.skuId || !event.target.files?.length) return
          await uploadProductImages(props.skuId, Array.from(event.target.files))
          await props.onUploaded()
          event.currentTarget.value = ''
        }}
      />
      <div className="productImageGrid">
        {props.images.map((image) => (
          <article key={image.image_id} className="productImageCard">
            <img src={image.thumb_url} alt="" />
            <div className="productImageActions">
              <button onClick={() => props.onSetPrimary(image.image_id)}>
                {image.is_primary ? '主图' : '设为主图'}
              </button>
              <button onClick={() => props.onMove(image.image_id, -1)}>上移</button>
              <button onClick={() => props.onMove(image.image_id, 1)}>下移</button>
              <button onClick={() => props.onDelete(image.image_id)}>删除</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
```

```tsx
// frontend/src/pages/ProductsPage.tsx
type ProductImage = {
  image_id: string
  sort_order: number
  is_primary: boolean
  thumb_url: string
  original_url: string
}

type FishSku = {
  sku_id: string
  sku_code: string | null
  name: string
  spec: string | null
  unit_price: number
  category: string | null
  status: SkuStatus
  created_at: string
  primary_image_thumb_url?: string | null
  images?: ProductImage[]
}

async function loadSkuDetail(id: string) {
  return apiRequest<FishSku>(`/api/skus/${id}`)
}

async function openEdit(s: FishSku) {
  setMode('edit')
  setEditingId(s.sku_id)
  const detail = await loadSkuDetail(s.sku_id)
  setEditingImages(normalizeUploadedImages(detail.images ?? []))
  setPreviewImageUrl(null)
  setModalOpen(true)
}

<ProductImageManager
  skuId={editingId}
  images={editingImages}
  onUploaded={async () => {
    if (!editingId) return
    const detail = await loadSkuDetail(editingId)
    setEditingImages(normalizeUploadedImages(detail.images ?? []))
  }}
  onSetPrimary={async (imageId) => {
    if (!editingId) return
    await setPrimaryProductImage(editingId, imageId)
    setEditingImages((current) => applyPrimaryImage(current, imageId))
  }}
  onMove={async (imageId, delta) => {
    if (!editingId) return
    const next = moveImage(editingImages, imageId, delta)
    await reorderProductImages(editingId, next.map((item) => item.image_id))
    setEditingImages(next)
  }}
  onDelete={async (imageId) => {
    if (!editingId) return
    await deleteProductImage(editingId, imageId)
    const detail = await loadSkuDetail(editingId)
    setEditingImages(normalizeUploadedImages(detail.images ?? []))
  }}
/>
```

- [ ] **Step 4: Run frontend tests and build**

Run:

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/frontend
npm test
npm run build
```

Expected:
- `productImageState.test.ts` PASS
- frontend build PASS

- [ ] **Step 5: Commit the task**

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment
git add frontend/src/lib/productImageState.ts frontend/src/lib/productImageState.test.ts frontend/src/lib/productImagesApi.ts frontend/src/components/ProductImageManager.tsx frontend/src/pages/ProductsPage.tsx frontend/src/App.css
git commit -m "feat: add product image management ui"
```

### Task 6: Wire Docker/NAS Mounts, Docs, and Final Verification

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Update Docker and env configuration for image storage**

```yaml
# docker-compose.yml
services:
  backend:
    environment:
      PRODUCT_IMAGE_ROOT: ${PRODUCT_IMAGE_ROOT:-/data/assets/products}
      PRODUCT_IMAGE_TMP_DIR: ${PRODUCT_IMAGE_TMP_DIR:-/data/assets/uploads/tmp}
      PRODUCT_IMAGE_MAX_FILES: ${PRODUCT_IMAGE_MAX_FILES:-12}
      PRODUCT_IMAGE_MAX_FILE_MB: ${PRODUCT_IMAGE_MAX_FILE_MB:-10}
      PRODUCT_IMAGE_ALLOWED_MIME: ${PRODUCT_IMAGE_ALLOWED_MIME:-image/jpeg,image/png,image/webp}
      PRODUCT_IMAGE_THUMB_WIDTH: ${PRODUCT_IMAGE_THUMB_WIDTH:-480}
      PRODUCT_IMAGE_TRASH_RETENTION_DAYS: ${PRODUCT_IMAGE_TRASH_RETENTION_DAYS:-30}
    volumes:
      - ${DT_SHIPMENT_DATA_ROOT:-/Volumes/团队文件-DAINTY_SHIPMENT/docker/dt_shipment}/assets:/data/assets
```

```env
# .env.example
PRODUCT_IMAGE_ROOT=/data/assets/products
PRODUCT_IMAGE_TMP_DIR=/data/assets/uploads/tmp
PRODUCT_IMAGE_MAX_FILES=12
PRODUCT_IMAGE_MAX_FILE_MB=10
PRODUCT_IMAGE_ALLOWED_MIME=image/jpeg,image/png,image/webp
PRODUCT_IMAGE_THUMB_WIDTH=480
PRODUCT_IMAGE_TRASH_RETENTION_DAYS=30
```

- [ ] **Step 2: Update README for the new image workflow**

```md
## 商品图片

- 商品图片文件存储在 `${DT_SHIPMENT_DATA_ROOT}/assets/products`
- 数据库仅保存图片元数据，不保存图片二进制
- 列表页优先读取缩略图，点击后再加载原图
- 删除图片时文件先移动到 `assets/products/trash`
- 可通过 `POST /api/internal/jobs/cleanup-product-images` 执行回收区清理
```

- [ ] **Step 3: Validate Docker config and restart the stack**

Run:

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment
docker compose config
docker compose up -d --build backend frontend
```

Expected:
- `docker compose config`: exits `0`
- `docker compose up`: backend/frontend recreate successfully

- [ ] **Step 4: Run final automated verification**

Run:

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/backend
npm test

cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment/frontend
npm test
npm run build

cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment
set -a
source .env
set +a
node scripts/smoke-test.mjs
curl -I https://ship.dainty.vip
```

Expected:
- backend tests PASS
- frontend tests PASS
- frontend build PASS
- smoke script returns JSON with `ok: true`
- `curl -I https://ship.dainty.vip` returns `HTTP/2 200`

- [ ] **Step 5: Commit and push the completed feature**

```bash
cd /Users/maotiannan/dev/docker/DT_SHIPMENT/dt_shipment
git add docker-compose.yml .env.example README.md
git commit -m "docs: wire product image storage and verification"
git push origin main
```
