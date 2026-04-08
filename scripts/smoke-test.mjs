import { constants as fsConstants } from 'node:fs'
import { access } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const baseUrl = (process.env.DT_SHIPMENT_SMOKE_BASE_URL ?? 'http://127.0.0.1:18187').replace(/\/$/, '')
const username = process.env.DT_SHIPMENT_ADMIN_USERNAME ?? 'admin'
const password = process.env.DT_SHIPMENT_ADMIN_PASSWORD
const productImageRoot = process.env.PRODUCT_IMAGE_ROOT ?? '/data/assets/products'
const backendContainerName = process.env.DT_SHIPMENT_BACKEND_CONTAINER_NAME ?? 'dt-shipment-backend'
const dbContainerName = process.env.DT_SHIPMENT_DB_CONTAINER_NAME ?? 'dt-shipment-db'
const dbName = process.env.DT_SHIPMENT_DB_NAME ?? 'dt_ship_manager'
const dbUser = process.env.DT_SHIPMENT_DB_USER ?? 'postgres'
const dbPassword = process.env.DT_SHIPMENT_DB_PASSWORD

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0xQAAAAASUVORK5CYII=',
  'base64'
)

async function expectJson(pathname, init) {
  const response = await fetch(`${baseUrl}${pathname}`, init)
  const contentType = response.headers.get('content-type') ?? ''
  const payload = contentType.includes('application/json') ? await response.json() : await response.text()

  if (!response.ok) {
    throw new Error(`${pathname} failed with ${response.status}: ${JSON.stringify(payload)}`)
  }

  return payload
}

async function expectFileMissing(absolutePath) {
  if (isContainerRunning(backendContainerName)) {
    const result = spawnSync(
      'docker',
      [
        'exec',
        '-e',
        `CODEX_EXPECT_MISSING_PATH=${absolutePath}`,
        backendContainerName,
        'sh',
        '-lc',
        'test ! -e "$CODEX_EXPECT_MISSING_PATH"',
      ],
      { encoding: 'utf8' }
    )

    if (result.status !== 0) {
      throw new Error(`expected missing file inside backend container, but found: ${absolutePath}`)
    }

    return
  }

  try {
    await access(absolutePath, fsConstants.F_OK)
    throw new Error(`expected missing file, but found: ${absolutePath}`)
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }
  }
}

function isContainerRunning(containerName) {
  const result = spawnSync(
    'docker',
    ['inspect', '--format', '{{.State.Running}}', containerName],
    { encoding: 'utf8' }
  )
  return result.status === 0 && result.stdout.trim() === 'true'
}

function runSql(query) {
  if (!dbPassword) {
    throw new Error('DT_SHIPMENT_DB_PASSWORD is required for smoke SQL helpers')
  }

  const result = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      '-e',
      `PGPASSWORD=${dbPassword}`,
      dbContainerName,
      'psql',
      '-h',
      '127.0.0.1',
      '-U',
      dbUser,
      '-d',
      dbName,
      '-v',
      'ON_ERROR_STOP=1',
      '-Atq',
    ],
    {
      encoding: 'utf8',
      input: query,
    }
  )

  if (result.status !== 0) {
    throw new Error(
      `sql helper failed: ${result.stderr || result.stdout || `exit ${result.status}`}`
    )
  }

  const text = result.stdout.trim()
  return text ? JSON.parse(text) : []
}

async function main() {
  if (!password) {
    throw new Error('DT_SHIPMENT_ADMIN_PASSWORD is required for smoke tests')
  }

  const health = await expectJson('/api/health')
  if (!health?.ok || health?.db !== 'ok') {
    throw new Error(`/api/health returned unexpected payload: ${JSON.stringify(health)}`)
  }

  const meta = await expectJson('/api/meta')
  if (!meta?.app?.version) {
    throw new Error(`/api/meta did not return app version: ${JSON.stringify(meta)}`)
  }

  const login = await expectJson('/api/auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ username, password }),
  })

  if (!login?.token) {
    throw new Error(`/api/auth/login did not return token: ${JSON.stringify(login)}`)
  }
  if (!login?.user?.userId || !login?.user?.username) {
    throw new Error(`/api/auth/login did not return user: ${JSON.stringify(login)}`)
  }

  const authHeaders = {
    authorization: `Bearer ${login.token}`,
  }

  const me = await expectJson('/api/auth/me', {
    headers: authHeaders,
  })
  if (me?.user?.username !== login.user.username) {
    throw new Error(`/api/auth/me returned unexpected user: ${JSON.stringify(me)}`)
  }

  const accountA = await expectJson('/api/accounts', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify({
      account_name: `Smoke Account A ${Date.now()}`,
      remark: 'smoke-account-a',
      biz_type: 'mixed',
      status: 'active',
    }),
  })

  const accountB = await expectJson('/api/accounts', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify({
      account_name: `Smoke Account B ${Date.now()}`,
      remark: 'smoke-account-b',
      biz_type: 'mixed',
      status: 'active',
    }),
  })

  const orderId = `SMOKE-ORDER-${Date.now()}`
  const createdOrder = await expectJson('/api/orders', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify({
      order_id: orderId,
      account_id: accountA.account_id,
      order_type: 'wholesale',
      buyer_name: 'Smoke Buyer',
      shipping_address: 'Smoke Address',
      items: [{ sku_id: null, inventory_id: null, name: 'Smoke Item', qty: 1, unit_price: 8 }],
      total_amount: 8,
      ship_status: 'pending',
      tracking_number: null,
      tracking_method: null,
      is_abnormal: false,
      abnormal_type: null,
      remark: null,
      settlement_status: 'unpaid',
      paid_amount: 0,
    }),
  })
  if (createdOrder?.order_id !== orderId) {
    throw new Error(`order create returned unexpected payload: ${JSON.stringify(createdOrder)}`)
  }

  const fetchedOrder = await expectJson(`/api/orders/${orderId}`, {
    headers: authHeaders,
  })
  if (fetchedOrder?.account_id !== accountA.account_id) {
    throw new Error(`order detail returned unexpected payload: ${JSON.stringify(fetchedOrder)}`)
  }

  const blockedAccountDeleteRes = await fetch(`${baseUrl}/api/accounts/${accountA.account_id}`, {
    method: 'DELETE',
    headers: authHeaders,
  })
  const blockedAccountDeletePayload = await blockedAccountDeleteRes.json()
  if (blockedAccountDeleteRes.status !== 409) {
    throw new Error(
      `expected account delete conflict, got ${blockedAccountDeleteRes.status}: ${JSON.stringify(blockedAccountDeletePayload)}`
    )
  }

  const shippedAt = new Date('2026-04-03T02:00:00.000Z').toISOString()
  const updatedOrder = await expectJson(`/api/orders/${orderId}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify({
      account_id: accountB.account_id,
      order_type: 'retail',
      buyer_name: 'Smoke Buyer Updated',
      shipping_address: 'Smoke Address Updated',
      items: [{ sku_id: null, inventory_id: null, name: 'Smoke Item Updated', qty: 2, unit_price: 6 }],
      total_amount: 12,
      ship_status: 'shipped_uploaded',
      tracking_number: 'SMOKE-YT-001',
      tracking_method: 'platform_upload',
      is_abnormal: true,
      abnormal_type: 'other',
      remark: 'smoke-order-updated',
      settlement_status: null,
      paid_amount: 0,
      paid_at: null,
      paid_remark: null,
      shipped_at: shippedAt,
    }),
  })
  if (
    updatedOrder?.account_id !== accountB.account_id ||
    updatedOrder?.buyer_name !== 'Smoke Buyer Updated' ||
    updatedOrder?.tracking_number !== 'SMOKE-YT-001'
  ) {
    throw new Error(`order update returned unexpected payload: ${JSON.stringify(updatedOrder)}`)
  }

  const deletedOrder = await expectJson(`/api/orders/${orderId}`, {
    method: 'DELETE',
    headers: authHeaders,
  })
  if (!deletedOrder?.ok || deletedOrder.deletedOrderId !== orderId) {
    throw new Error(`order delete returned unexpected payload: ${JSON.stringify(deletedOrder)}`)
  }

  const deletedOrderFetch = await fetch(`${baseUrl}/api/orders/${orderId}`, {
    headers: authHeaders,
  })
  const deletedOrderFetchPayload = await deletedOrderFetch.json()
  if (deletedOrderFetch.status !== 404) {
    throw new Error(
      `expected deleted order 404, got ${deletedOrderFetch.status}: ${JSON.stringify(deletedOrderFetchPayload)}`
    )
  }

  const deletedAccountA = await expectJson(`/api/accounts/${accountA.account_id}`, {
    method: 'DELETE',
    headers: authHeaders,
  })
  if (!deletedAccountA?.ok || deletedAccountA.deletedAccountId !== accountA.account_id) {
    throw new Error(`account A delete returned unexpected payload: ${JSON.stringify(deletedAccountA)}`)
  }

  const deletedAccountB = await expectJson(`/api/accounts/${accountB.account_id}`, {
    method: 'DELETE',
    headers: authHeaders,
  })
  if (!deletedAccountB?.ok || deletedAccountB.deletedAccountId !== accountB.account_id) {
    throw new Error(`account B delete returned unexpected payload: ${JSON.stringify(deletedAccountB)}`)
  }

  const sku = await expectJson('/api/skus', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify({
      sku_code: `SMOKE-${Date.now()}`,
      name: 'Smoke image product',
      category_name: 'Smoke Category',
      color_name: 'Smoke White',
      variant_name: 'Smoke XL',
      unit_price: 1,
      inventory_quantity: 9,
      status: 'active',
    }),
  })

  if (
    !sku?.sku_id ||
    sku.category_name !== 'Smoke Category' ||
    sku.color_name !== 'Smoke White' ||
    sku.variant_name !== 'Smoke XL' ||
    Number(sku.inventory_quantity) !== 9
  ) {
    throw new Error(`/api/skus did not return sku_id: ${JSON.stringify(sku)}`)
  }

  const categorySuggestions = await expectJson('/api/sku-attribute-suggestions?attribute=category', {
    headers: authHeaders,
  })
  if (!Array.isArray(categorySuggestions?.suggestions) || !categorySuggestions.suggestions.some((item) => item.value === 'Smoke Category')) {
    throw new Error(`category suggestion missing after sku create: ${JSON.stringify(categorySuggestions)}`)
  }

  const form = new FormData()
  form.append('files', new Blob([tinyPng], { type: 'image/png' }), 'cover.png')
  form.append('files', new Blob([tinyPng], { type: 'image/png' }), 'detail.png')

  const upload = await expectJson(`/api/skus/${sku.sku_id}/images`, {
    method: 'POST',
    headers: authHeaders,
    body: form,
  })

  if (!Array.isArray(upload.images) || upload.images.length !== 2) {
    throw new Error(`upload returned unexpected payload: ${JSON.stringify(upload)}`)
  }

  const initialDetail = await expectJson(`/api/skus/${sku.sku_id}`, {
    headers: authHeaders,
  })

  const [firstImage, secondImage] = initialDetail.images ?? []
  if (!firstImage?.is_primary || secondImage?.is_primary) {
    throw new Error(`unexpected primary state after upload: ${JSON.stringify(initialDetail)}`)
  }

  const initialSkuList = await expectJson('/api/skus', {
    headers: authHeaders,
  })
  const listedSku = initialSkuList.find((item) => item.sku_id === sku.sku_id)
  if (listedSku?.primary_image_thumb_url !== firstImage.thumb_url) {
    throw new Error(`sku list did not include primary thumb summary: ${JSON.stringify(listedSku)}`)
  }

  const reordered = await expectJson(`/api/skus/${sku.sku_id}/images/reorder`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify({ imageIds: [secondImage.image_id, firstImage.image_id] }),
  })
  if (
    reordered.images?.[0]?.image_id !== secondImage.image_id ||
    reordered.images?.[0]?.sort_order !== 1 ||
    reordered.images?.[1]?.image_id !== firstImage.image_id ||
    reordered.images?.[1]?.is_primary !== true
  ) {
    throw new Error(`reorder did not preserve primary/order invariants: ${JSON.stringify(reordered)}`)
  }

  await expectJson(`/api/skus/${sku.sku_id}/images/${secondImage.image_id}/primary`, {
    method: 'PATCH',
    headers: authHeaders,
  })

  const afterPrimarySwitch = await expectJson(`/api/skus/${sku.sku_id}`, {
    headers: authHeaders,
  })
  if (afterPrimarySwitch.images?.[0]?.is_primary !== true || afterPrimarySwitch.images?.[1]?.is_primary !== false) {
    throw new Error(`primary switch did not persist: ${JSON.stringify(afterPrimarySwitch)}`)
  }

  const deleted = await expectJson(`/api/skus/${sku.sku_id}/images/${secondImage.image_id}`, {
    method: 'DELETE',
    headers: authHeaders,
  })
  if (!deleted?.ok || deleted.nextPrimaryImageId !== firstImage.image_id) {
    throw new Error(`delete did not promote fallback primary: ${JSON.stringify(deleted)}`)
  }

  const afterDelete = await expectJson(`/api/skus/${sku.sku_id}`, {
    headers: authHeaders,
  })
  if (afterDelete.images?.length !== 1 || !afterDelete.images?.[0]?.is_primary) {
    throw new Error(`delete did not leave a single primary image: ${JSON.stringify(afterDelete)}`)
  }

  const postDeleteForm = new FormData()
  postDeleteForm.append('files', new Blob([tinyPng], { type: 'image/png' }), 'after-delete.png')
  const postDeleteUpload = await expectJson(`/api/skus/${sku.sku_id}/images`, {
    method: 'POST',
    headers: authHeaders,
    body: postDeleteForm,
  })
  if (!Array.isArray(postDeleteUpload.images) || postDeleteUpload.images[0]?.sort_order !== 2) {
    throw new Error(`post-delete upload did not resequence sort order correctly: ${JSON.stringify(postDeleteUpload)}`)
  }

  const parsedDeletedRows = runSql(`
    select coalesce(
      json_agg(row_to_json(t)),
      '[]'::json
    )
    from (
      select original_relpath, thumb_relpath, deleted_at
      from product_images
      where image_id = '${secondImage.image_id}'
    ) t;
  `)
  if (!Array.isArray(parsedDeletedRows) || parsedDeletedRows.length !== 1) {
    throw new Error(`deleted image row missing: ${JSON.stringify(parsedDeletedRows)}`)
  }

  const [deletedRow] = parsedDeletedRows
  if (!deletedRow?.original_relpath || !deletedRow?.thumb_relpath) {
    throw new Error(`deleted row missing trash paths: ${JSON.stringify(parsedDeletedRows)}`)
  }

  const trashOriginalPath = path.resolve(productImageRoot, deletedRow.original_relpath)
  const trashThumbPath = path.resolve(productImageRoot, deletedRow.thumb_relpath)

  runSql(`
    update product_images
    set deleted_at = now() - interval '31 days'
    where image_id = '${secondImage.image_id}';
  `)

  const cleanup = await expectJson('/api/internal/jobs/cleanup-product-images', {
    method: 'POST',
    headers: authHeaders,
  })
  if (
    !cleanup?.ok ||
    typeof cleanup.imageCount !== 'number' ||
    typeof cleanup.deletedFileCount !== 'number' ||
    cleanup.imageCount < 1 ||
    cleanup.deletedFileCount < 2
  ) {
    throw new Error(`cleanup returned unexpected payload: ${JSON.stringify(cleanup)}`)
  }

  const parsedCleanedRow = runSql(`
    select coalesce(
      json_agg(row_to_json(t)),
      '[]'::json
    )
    from (
      select status, deleted_at
      from product_images
      where image_id = '${secondImage.image_id}'
    ) t;
  `)
  if (parsedCleanedRow[0]?.status !== 'deleted') {
    throw new Error(`cleanup should keep deleted row: ${JSON.stringify(parsedCleanedRow)}`)
  }

  await expectFileMissing(trashOriginalPath)
  await expectFileMissing(trashThumbPath)

  const remainingRows = runSql(`
    select coalesce(
      json_agg(row_to_json(t)),
      '[]'::json
    )
    from (
      select image_id, original_relpath, thumb_relpath
      from product_images
      where sku_id = '${sku.sku_id}'
      order by sort_order asc, created_at asc
    ) t;
  `)

  const activeRow = remainingRows.find((row) => row.image_id === firstImage.image_id)
  if (!activeRow?.original_relpath || !activeRow?.thumb_relpath) {
    throw new Error(`active image row missing before sku delete: ${JSON.stringify(remainingRows)}`)
  }

  const activeOriginalPath = path.resolve(productImageRoot, activeRow.original_relpath)
  const activeThumbPath = path.resolve(productImageRoot, activeRow.thumb_relpath)

  const deleteSku = await expectJson(`/api/skus/${sku.sku_id}`, {
    method: 'DELETE',
    headers: authHeaders,
  })
  if (!deleteSku?.ok || deleteSku.deletedSkuId !== sku.sku_id) {
    throw new Error(`sku delete returned unexpected payload: ${JSON.stringify(deleteSku)}`)
  }

  const deletedSkuResponse = await fetch(`${baseUrl}/api/skus/${sku.sku_id}`, {
    headers: authHeaders,
  })
  if (deletedSkuResponse.status !== 404) {
    const payload = await deletedSkuResponse.text()
    throw new Error(`deleted sku should return 404, got ${deletedSkuResponse.status}: ${payload}`)
  }

  const afterSkuDeleteRows = runSql(`
    select coalesce(
      json_agg(row_to_json(t)),
      '[]'::json
    )
    from (
      select image_id
      from product_images
      where sku_id = '${sku.sku_id}'
    ) t;
  `)
  if (Array.isArray(afterSkuDeleteRows) && afterSkuDeleteRows.length !== 0) {
    throw new Error(`sku delete left image rows behind: ${JSON.stringify(afterSkuDeleteRows)}`)
  }

  await expectFileMissing(activeOriginalPath)
  await expectFileMissing(activeThumbPath)

  const result = {
    ok: true,
    baseUrl,
    app: meta.app,
    orderId,
    skuId: sku.sku_id,
    uploadedImages: upload.images.length,
    cleanup,
    deletedSkuId: deleteSku.deletedSkuId,
    checkedAt: new Date().toISOString(),
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exit(1)
})
