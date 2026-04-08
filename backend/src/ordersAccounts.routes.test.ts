import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { execFileSync, spawnSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Pool } from 'pg'
import { runInitDb } from './scripts/initDbRunner.js'

const dockerAvailable = spawnSync('docker', ['version'], { stdio: 'ignore' }).status === 0
const dbTest = dockerAvailable ? test : test.skip
const schemaSql = readFileSync(path.resolve(process.cwd(), 'db/init.sql'), 'utf8')
const originalDbEnv = {
  DB_HOST: process.env.DB_HOST,
  DB_PORT: process.env.DB_PORT,
  DB_USER: process.env.DB_USER,
  DB_PASSWORD: process.env.DB_PASSWORD,
  DB_NAME: process.env.DB_NAME,
}

type RunningDatabase = {
  pool: Pool
  containerName: string
}

let sharedRunningDatabase: RunningDatabase | null = null
let appModulePool: Pool | null = null

async function waitForDatabase(pool: Pool) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await pool.query('select 1')
      return
    } catch {
      await delay(500)
    }
  }

  throw new Error('postgres container did not become ready in time')
}

async function startDisposablePostgres(): Promise<RunningDatabase> {
  const containerName = `codex-orders-accounts-routes-${process.pid}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`

  execFileSync(
    'docker',
    [
      'run',
      '-d',
      '--rm',
      '--name',
      containerName,
      '-e',
      'POSTGRES_PASSWORD=postgres',
      '-e',
      'POSTGRES_DB=dt_ship_manager',
      '-P',
      'postgres:16',
    ],
    { stdio: 'ignore' }
  )

  const portMapping = execFileSync('docker', ['port', containerName, '5432/tcp'], {
    encoding: 'utf8',
  }).trim()
  const port = Number(portMapping.split(':').pop())

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`failed to resolve mapped postgres port from: ${portMapping}`)
  }

  const pool = new Pool({
    host: '127.0.0.1',
    port,
    user: 'postgres',
    password: 'postgres',
    database: 'dt_ship_manager',
  })

  await waitForDatabase(pool)
  return { pool, containerName }
}

async function stopDisposablePostgres(running: RunningDatabase) {
  await running.pool.end().catch(() => undefined)
  spawnSync('docker', ['rm', '-f', running.containerName], { stdio: 'ignore' })
}

async function getSharedRunningDatabase() {
  if (!sharedRunningDatabase) {
    sharedRunningDatabase = await startDisposablePostgres()
    process.env.DB_HOST = '127.0.0.1'
    process.env.DB_PORT = String(sharedRunningDatabase.pool.options.port)
    process.env.DB_USER = 'postgres'
    process.env.DB_PASSWORD = 'postgres'
    process.env.DB_NAME = 'dt_ship_manager'
  }

  await runInitDb(sharedRunningDatabase.pool, schemaSql)
  await sharedRunningDatabase.pool.query(`
    truncate table
      product_images,
      orders,
      skus,
      fish_accounts,
      push_subscriptions
    restart identity cascade
  `)

  return sharedRunningDatabase
}

async function startTestApp(t: test.TestContext) {
  const createAppModuleUrl = `${pathToFileURL(
    path.resolve(process.cwd(), 'src/createApp.ts')
  ).href}?orders-accounts-test=${Date.now()}-${Math.random()}`
  const [{ createApp }, { pool: canonicalPool }] = await Promise.all([
    import(createAppModuleUrl),
    import(pathToFileURL(path.resolve(process.cwd(), 'src/db.ts')).href),
  ])
  appModulePool = canonicalPool as Pool

  const app = createApp(process.env)
  const server = createServer(app)
  server.listen(0)
  await once(server, 'listening')
  t.after(() => {
    server.close()
  })

  const { port } = server.address() as { port: number }

  const loginRes = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: '123456' }),
  })
  const loginBody = await loginRes.text()
  assert.equal(loginRes.status, 200, loginBody)
  const login = JSON.parse(loginBody) as { token: string }

  return { port, token: login.token }
}

async function postJson(port: number, pathname: string, token: string, body: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  return { response, text }
}

async function putJson(port: number, pathname: string, token: string, body: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  return { response, text }
}

async function seedSku(
  pool: Pool,
  sku: {
    skuId: string
    name: string
    inventoryQuantity: number
  }
) {
  await pool.query(
    `insert into skus(sku_id, name, status, inventory_quantity)
     values ($1, $2, 'active', $3)`,
    [sku.skuId, sku.name, sku.inventoryQuantity]
  )
}

async function readSkuInventory(pool: Pool, skuId: string) {
  const { rows } = await pool.query<{ inventory_quantity: number | null }>(
    `select inventory_quantity
     from skus
     where sku_id = $1`,
    [skuId]
  )

  return Number(rows[0]?.inventory_quantity ?? 0)
}

async function readInventoryMovements(pool: Pool, orderId: string) {
  const { rows } = await pool.query<{
    sku_id: string
    delta_quantity: number
    reason: string
  }>(
    `select sku_id, delta_quantity, reason
     from inventory_movements
     where order_id = $1
     order by created_at asc, movement_id asc`,
    [orderId]
  )

  const reasonRank = new Map([
    ['order_create', 1],
    ['order_update_revert', 2],
    ['order_update_apply', 3],
    ['order_delete_revert', 4],
    ['manual_adjustment', 5],
  ])

  return rows
    .map((row) => ({
      sku_id: row.sku_id,
      delta_quantity: Number(row.delta_quantity),
      reason: row.reason,
    }))
    .sort(
      (left, right) =>
        (reasonRank.get(left.reason) ?? Number.MAX_SAFE_INTEGER) -
          (reasonRank.get(right.reason) ?? Number.MAX_SAFE_INTEGER) ||
        left.sku_id.localeCompare(right.sku_id) ||
        left.delta_quantity - right.delta_quantity
    )
}

async function readManualInventoryMovements(pool: Pool, skuId: string) {
  const { rows } = await pool.query<{
    delta_quantity: number
    reason: string
  }>(
    `select delta_quantity, reason
     from inventory_movements
     where sku_id = $1
     order by created_at asc, movement_id asc`,
    [skuId]
  )

  return rows.map((row) => ({
    delta_quantity: Number(row.delta_quantity),
    reason: row.reason,
  }))
}

test.after(async () => {
  await appModulePool?.end().catch(() => undefined)

  if (sharedRunningDatabase) {
    await stopDisposablePostgres(sharedRunningDatabase)
  }

  for (const [key, value] of Object.entries(originalDbEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})

dbTest(
  'sku routes persist structured attributes, seed suggestions, and record manual inventory adjustments',
  { concurrency: false },
  async (t) => {
    const runningDb = await getSharedRunningDatabase()
    const { port, token } = await startTestApp(t)

    const createSkuRes = await postJson(port, '/api/skus', token, {
      sku_code: `SKU-STRUCTURED-${Date.now()}`,
      name: 'Structured Tee',
      category_name: '上衣',
      color_name: '白色',
      variant_name: 'XL',
      unit_price: 99,
      inventory_quantity: 12,
      status: 'active',
    })
    assert.equal(createSkuRes.response.status, 200, createSkuRes.text)
    const createdSku = JSON.parse(createSkuRes.text) as {
      sku_id: string
      category_name: string | null
      color_name: string | null
      variant_name: string | null
      inventory_quantity: number
    }
    assert.equal(createdSku.category_name, '上衣')
    assert.equal(createdSku.color_name, '白色')
    assert.equal(createdSku.variant_name, 'XL')
    assert.equal(Number(createdSku.inventory_quantity), 12)

    const getCreatedSkuRes = await fetch(`http://127.0.0.1:${port}/api/skus/${createdSku.sku_id}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    const getCreatedSkuBody = await getCreatedSkuRes.text()
    assert.equal(getCreatedSkuRes.status, 200, getCreatedSkuBody)
    const createdSkuDetail = JSON.parse(getCreatedSkuBody) as {
      category_name: string | null
      color_name: string | null
      variant_name: string | null
      inventory_quantity: number
    }
    assert.equal(createdSkuDetail.category_name, '上衣')
    assert.equal(createdSkuDetail.color_name, '白色')
    assert.equal(createdSkuDetail.variant_name, 'XL')
    assert.equal(Number(createdSkuDetail.inventory_quantity), 12)

    const updateSkuRes = await putJson(port, `/api/skus/${createdSku.sku_id}`, token, {
      sku_code: `SKU-STRUCTURED-${Date.now()}-2`,
      name: 'Structured Tee Updated',
      category_name: '上衣',
      color_name: '黑色',
      variant_name: '2XL',
      unit_price: 109,
      inventory_quantity: 7,
      status: 'active',
      inventory_id: null,
    })
    assert.equal(updateSkuRes.response.status, 200, updateSkuRes.text)
    const updatedSku = JSON.parse(updateSkuRes.text) as {
      category_name: string | null
      color_name: string | null
      variant_name: string | null
      inventory_quantity: number
    }
    assert.equal(updatedSku.category_name, '上衣')
    assert.equal(updatedSku.color_name, '黑色')
    assert.equal(updatedSku.variant_name, '2XL')
    assert.equal(Number(updatedSku.inventory_quantity), 7)

    assert.deepEqual(await readManualInventoryMovements(runningDb.pool, createdSku.sku_id), [
      { delta_quantity: 12, reason: 'manual_adjustment' },
      { delta_quantity: -5, reason: 'manual_adjustment' },
    ])

    const categorySuggestionsRes = await fetch(
      `http://127.0.0.1:${port}/api/sku-attribute-suggestions?attribute=category`,
      { headers: { authorization: `Bearer ${token}` } }
    )
    const categorySuggestionsBody = await categorySuggestionsRes.text()
    assert.equal(categorySuggestionsRes.status, 200, categorySuggestionsBody)
    const categorySuggestions = JSON.parse(categorySuggestionsBody) as {
      suggestions: Array<{ value: string; usage_count: number }>
    }
    assert.equal(categorySuggestions.suggestions.some((item) => item.value === '上衣'), true)

    const colorSuggestionsRes = await fetch(
      `http://127.0.0.1:${port}/api/sku-attribute-suggestions?attribute=color&category_name=${encodeURIComponent('上衣')}`,
      { headers: { authorization: `Bearer ${token}` } }
    )
    const colorSuggestionsBody = await colorSuggestionsRes.text()
    assert.equal(colorSuggestionsRes.status, 200, colorSuggestionsBody)
    const colorSuggestions = JSON.parse(colorSuggestionsBody) as {
      suggestions: Array<{ value: string }>
    }
    assert.equal(colorSuggestions.suggestions.some((item) => item.value === '白色'), true)
    assert.equal(colorSuggestions.suggestions.some((item) => item.value === '黑色'), true)

    const variantSuggestionsRes = await fetch(
      `http://127.0.0.1:${port}/api/sku-attribute-suggestions?attribute=variant&category_name=${encodeURIComponent('上衣')}`,
      { headers: { authorization: `Bearer ${token}` } }
    )
    const variantSuggestionsBody = await variantSuggestionsRes.text()
    assert.equal(variantSuggestionsRes.status, 200, variantSuggestionsBody)
    const variantSuggestions = JSON.parse(variantSuggestionsBody) as {
      suggestions: Array<{ value: string }>
    }
    assert.equal(variantSuggestions.suggestions.some((item) => item.value === 'XL'), true)
    assert.equal(variantSuggestions.suggestions.some((item) => item.value === '2XL'), true)
  }
)

dbTest(
  'account deletion blocks referenced accounts and removes safe accounts',
  { concurrency: false },
  async (t) => {
    await getSharedRunningDatabase()
    const { port, token } = await startTestApp(t)

    const referencedAccountRes = await postJson(port, '/api/accounts', token, {
      account_name: 'Referenced Account',
      remark: 'has orders',
      biz_type: 'mixed',
      status: 'active',
    })
    assert.equal(referencedAccountRes.response.status, 200, referencedAccountRes.text)
    const referencedAccount = JSON.parse(referencedAccountRes.text) as { account_id: string }

    const orphanAccountRes = await postJson(port, '/api/accounts', token, {
      account_name: 'Orphan Account',
      remark: null,
      biz_type: 'mixed',
      status: 'active',
    })
    assert.equal(orphanAccountRes.response.status, 200, orphanAccountRes.text)
    const orphanAccount = JSON.parse(orphanAccountRes.text) as { account_id: string }

    const orderRes = await postJson(port, '/api/orders', token, {
      order_id: `ORDER-ACCOUNT-${Date.now()}`,
      account_id: referencedAccount.account_id,
      order_type: 'wholesale',
      buyer_name: 'Buyer A',
      shipping_address: 'Shanghai',
      items: [{ sku_id: null, inventory_id: null, name: 'Box', qty: 1, unit_price: 9.9 }],
      total_amount: 9.9,
      ship_status: 'pending',
      is_abnormal: false,
      settlement_status: 'unpaid',
      paid_amount: 0,
    })
    assert.equal(orderRes.response.status, 200, orderRes.text)

    const blockedDeleteRes = await fetch(
      `http://127.0.0.1:${port}/api/accounts/${referencedAccount.account_id}`,
      {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      }
    )
    const blockedDeleteBody = await blockedDeleteRes.text()
    assert.equal(blockedDeleteRes.status, 409, blockedDeleteBody)
    assert.match(blockedDeleteBody, /order/i)

    const orphanDeleteRes = await fetch(
      `http://127.0.0.1:${port}/api/accounts/${orphanAccount.account_id}`,
      {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      }
    )
    const orphanDeleteBody = await orphanDeleteRes.text()
    assert.equal(orphanDeleteRes.status, 200, orphanDeleteBody)
    assert.deepEqual(JSON.parse(orphanDeleteBody), {
      ok: true,
      deletedAccountId: orphanAccount.account_id,
    })

    const accountsRes = await fetch(`http://127.0.0.1:${port}/api/accounts`, {
      headers: { authorization: `Bearer ${token}` },
    })
    const accountsBody = await accountsRes.text()
    assert.equal(accountsRes.status, 200, accountsBody)
    const accounts = JSON.parse(accountsBody) as Array<{ account_id: string }>

    assert.ok(accounts.some((item) => item.account_id === referencedAccount.account_id))
    assert.ok(!accounts.some((item) => item.account_id === orphanAccount.account_id))
  }
)

dbTest(
  'orders support get put delete lifecycle',
  { concurrency: false },
  async (t) => {
    await getSharedRunningDatabase()
    const { port, token } = await startTestApp(t)

    const firstAccountRes = await postJson(port, '/api/accounts', token, {
      account_name: 'Order Account A',
      remark: null,
      biz_type: 'mixed',
      status: 'active',
    })
    assert.equal(firstAccountRes.response.status, 200, firstAccountRes.text)
    const firstAccount = JSON.parse(firstAccountRes.text) as { account_id: string }

    const secondAccountRes = await postJson(port, '/api/accounts', token, {
      account_name: 'Order Account B',
      remark: null,
      biz_type: 'mixed',
      status: 'active',
    })
    assert.equal(secondAccountRes.response.status, 200, secondAccountRes.text)
    const secondAccount = JSON.parse(secondAccountRes.text) as { account_id: string }

    const orderId = `ORDER-LIFECYCLE-${Date.now()}`
    const orderCreateRes = await postJson(port, '/api/orders', token, {
      order_id: orderId,
      account_id: firstAccount.account_id,
      order_type: 'wholesale',
      buyer_name: 'Lifecycle Buyer',
      shipping_address: 'Shanghai Pudong',
      items: [{ sku_id: null, inventory_id: null, name: 'Alpha', qty: 1, unit_price: 12.5 }],
      total_amount: 12.5,
      ship_status: 'pending',
      tracking_number: null,
      tracking_method: null,
      is_abnormal: false,
      abnormal_type: null,
      remark: null,
      settlement_status: 'unpaid',
      paid_amount: 0,
    })
    assert.equal(orderCreateRes.response.status, 200, orderCreateRes.text)

    const getOrderRes = await fetch(`http://127.0.0.1:${port}/api/orders/${orderId}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    const getOrderBody = await getOrderRes.text()
    assert.equal(getOrderRes.status, 200, getOrderBody)
    const fetchedOrder = JSON.parse(getOrderBody) as { order_id: string; buyer_name: string }
    assert.equal(fetchedOrder.order_id, orderId)
    assert.equal(fetchedOrder.buyer_name, 'Lifecycle Buyer')

    const paidAt = new Date('2026-04-03T03:00:00.000Z').toISOString()
    const shippedAt = new Date('2026-04-03T04:00:00.000Z').toISOString()
    const updateOrderRes = await fetch(`http://127.0.0.1:${port}/api/orders/${orderId}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        account_id: secondAccount.account_id,
        order_type: 'retail',
        buyer_name: 'Lifecycle Buyer Updated',
        shipping_address: 'Hangzhou Binjiang',
        items: [
          { sku_id: null, inventory_id: null, name: 'Beta', qty: 2, unit_price: 5 },
          { sku_id: null, inventory_id: null, name: 'Gamma', qty: 1, unit_price: 8 },
        ],
        total_amount: 18,
        ship_status: 'shipped_uploaded',
        tracking_number: 'YT123456789',
        tracking_method: 'platform_upload',
        is_abnormal: true,
        abnormal_type: 'other',
        remark: 'updated by test',
        settlement_status: 'partial_paid',
        paid_amount: 6,
        paid_at: paidAt,
        paid_remark: 'deposit',
        shipped_at: shippedAt,
      }),
    })
    const updateOrderBody = await updateOrderRes.text()
    assert.equal(updateOrderRes.status, 200, updateOrderBody)
    const updatedOrder = JSON.parse(updateOrderBody) as {
      account_id: string
      buyer_name: string
      shipping_address: string
      order_type: string
      total_amount: string
      tracking_number: string
      tracking_method: string
      is_abnormal: boolean
      abnormal_type: string
      remark: string
      settlement_status: string
      paid_amount: string
      paid_remark: string
      paid_at: string
      shipped_at: string
      items: Array<{ name: string; qty: number; unit_price: number }>
    }
    assert.equal(updatedOrder.account_id, secondAccount.account_id)
    assert.equal(updatedOrder.buyer_name, 'Lifecycle Buyer Updated')
    assert.equal(updatedOrder.shipping_address, 'Hangzhou Binjiang')
    assert.equal(updatedOrder.order_type, 'retail')
    assert.equal(updatedOrder.total_amount, '18.00')
    assert.equal(updatedOrder.tracking_number, 'YT123456789')
    assert.equal(updatedOrder.tracking_method, 'platform_upload')
    assert.equal(updatedOrder.is_abnormal, true)
    assert.equal(updatedOrder.abnormal_type, 'other')
    assert.equal(updatedOrder.remark, 'updated by test')
    assert.equal(updatedOrder.settlement_status, 'partial_paid')
    assert.equal(updatedOrder.paid_amount, '6.00')
    assert.equal(updatedOrder.paid_remark, 'deposit')
    assert.equal(updatedOrder.paid_at, paidAt)
    assert.equal(updatedOrder.shipped_at, shippedAt)
    assert.deepEqual(updatedOrder.items, [
      { sku_id: null, inventory_id: null, name: 'Beta', qty: 2, unit_price: 5 },
      { sku_id: null, inventory_id: null, name: 'Gamma', qty: 1, unit_price: 8 },
    ])

    const getUpdatedRes = await fetch(`http://127.0.0.1:${port}/api/orders/${orderId}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    const getUpdatedBody = await getUpdatedRes.text()
    assert.equal(getUpdatedRes.status, 200, getUpdatedBody)
    const updatedOrderFromGet = JSON.parse(getUpdatedBody) as { buyer_name: string; account_id: string }
    assert.equal(updatedOrderFromGet.buyer_name, 'Lifecycle Buyer Updated')
    assert.equal(updatedOrderFromGet.account_id, secondAccount.account_id)

    const deleteOrderRes = await fetch(`http://127.0.0.1:${port}/api/orders/${orderId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    })
    const deleteOrderBody = await deleteOrderRes.text()
    assert.equal(deleteOrderRes.status, 200, deleteOrderBody)
    assert.deepEqual(JSON.parse(deleteOrderBody), {
      ok: true,
      deletedOrderId: orderId,
    })

    const getDeletedRes = await fetch(`http://127.0.0.1:${port}/api/orders/${orderId}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    const getDeletedBody = await getDeletedRes.text()
    assert.equal(getDeletedRes.status, 404, getDeletedBody)
    assert.match(getDeletedBody, /order/i)
  }
)

dbTest(
  'orders apply inventory deductions, recompute updates, restore deletes, and record movements',
  { concurrency: false },
  async (t) => {
    const runningDb = await getSharedRunningDatabase()
    const { port, token } = await startTestApp(t)

    const accountRes = await postJson(port, '/api/accounts', token, {
      account_name: 'Inventory Account',
      remark: null,
      biz_type: 'mixed',
      status: 'active',
    })
    assert.equal(accountRes.response.status, 200, accountRes.text)
    const account = JSON.parse(accountRes.text) as { account_id: string }

    const skuA = '11111111-1111-1111-1111-111111111111'
    const skuB = '22222222-2222-2222-2222-222222222222'
    await seedSku(runningDb.pool, {
      skuId: skuA,
      name: 'Inventory A',
      inventoryQuantity: 10,
    })
    await seedSku(runningDb.pool, {
      skuId: skuB,
      name: 'Inventory B',
      inventoryQuantity: 4,
    })

    const orderId = `ORDER-INVENTORY-${Date.now()}`
    const createRes = await postJson(port, '/api/orders', token, {
      order_id: orderId,
      account_id: account.account_id,
      order_type: 'wholesale',
      buyer_name: 'Inventory Buyer',
      shipping_address: 'Shanghai Jingan',
      items: [{ sku_id: skuA, inventory_id: null, name: 'Inventory A', qty: 2, unit_price: 11 }],
      total_amount: 22,
      ship_status: 'pending',
      tracking_number: null,
      tracking_method: null,
      is_abnormal: false,
      abnormal_type: null,
      remark: null,
      settlement_status: 'unpaid',
      paid_amount: 0,
    })
    assert.equal(createRes.response.status, 200, createRes.text)
    assert.equal(await readSkuInventory(runningDb.pool, skuA), 8)
    assert.equal(await readSkuInventory(runningDb.pool, skuB), 4)
    assert.deepEqual(await readInventoryMovements(runningDb.pool, orderId), [
      { sku_id: skuA, delta_quantity: -2, reason: 'order_create' },
    ])

    const updateRes = await putJson(port, `/api/orders/${orderId}`, token, {
      account_id: account.account_id,
      order_type: 'wholesale',
      buyer_name: 'Inventory Buyer Updated',
      shipping_address: 'Suzhou SIP',
      items: [
        { sku_id: skuA, inventory_id: null, name: 'Inventory A', qty: 1, unit_price: 11 },
        { sku_id: skuB, inventory_id: null, name: 'Inventory B', qty: 3, unit_price: 7 },
      ],
      total_amount: 32,
      ship_status: 'pending',
      tracking_number: null,
      tracking_method: null,
      is_abnormal: false,
      abnormal_type: null,
      remark: 'inventory update',
      settlement_status: 'unpaid',
      paid_amount: 0,
      paid_at: null,
      paid_remark: null,
      shipped_at: null,
    })
    assert.equal(updateRes.response.status, 200, updateRes.text)
    assert.equal(await readSkuInventory(runningDb.pool, skuA), 9)
    assert.equal(await readSkuInventory(runningDb.pool, skuB), 1)
    assert.deepEqual(await readInventoryMovements(runningDb.pool, orderId), [
      { sku_id: skuA, delta_quantity: -2, reason: 'order_create' },
      { sku_id: skuA, delta_quantity: 2, reason: 'order_update_revert' },
      { sku_id: skuA, delta_quantity: -1, reason: 'order_update_apply' },
      { sku_id: skuB, delta_quantity: -3, reason: 'order_update_apply' },
    ])

    const insufficientOrderRes = await postJson(port, '/api/orders', token, {
      order_id: `${orderId}-INSUFFICIENT`,
      account_id: account.account_id,
      order_type: 'wholesale',
      buyer_name: 'Inventory Buyer Overflow',
      shipping_address: 'Shanghai',
      items: [{ sku_id: skuB, inventory_id: null, name: 'Inventory B', qty: 5, unit_price: 7 }],
      total_amount: 35,
      ship_status: 'pending',
      tracking_number: null,
      tracking_method: null,
      is_abnormal: false,
      abnormal_type: null,
      remark: null,
      settlement_status: 'unpaid',
      paid_amount: 0,
    })
    assert.equal(insufficientOrderRes.response.status, 409, insufficientOrderRes.text)
    assert.match(insufficientOrderRes.text, /inventory/i)
    assert.equal(await readSkuInventory(runningDb.pool, skuA), 9)
    assert.equal(await readSkuInventory(runningDb.pool, skuB), 1)
    assert.deepEqual(await readInventoryMovements(runningDb.pool, `${orderId}-INSUFFICIENT`), [])

    const deleteRes = await fetch(`http://127.0.0.1:${port}/api/orders/${orderId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    })
    const deleteBody = await deleteRes.text()
    assert.equal(deleteRes.status, 200, deleteBody)
    assert.equal(await readSkuInventory(runningDb.pool, skuA), 10)
    assert.equal(await readSkuInventory(runningDb.pool, skuB), 4)
    assert.deepEqual(await readInventoryMovements(runningDb.pool, orderId), [
      { sku_id: skuA, delta_quantity: -2, reason: 'order_create' },
      { sku_id: skuA, delta_quantity: 2, reason: 'order_update_revert' },
      { sku_id: skuA, delta_quantity: -1, reason: 'order_update_apply' },
      { sku_id: skuB, delta_quantity: -3, reason: 'order_update_apply' },
      { sku_id: skuA, delta_quantity: 1, reason: 'order_delete_revert' },
      { sku_id: skuB, delta_quantity: 3, reason: 'order_delete_revert' },
    ])
  }
)

dbTest(
  'orders reject malformed sku ids and invalid quantities as request errors',
  { concurrency: false },
  async (t) => {
    const runningDb = await getSharedRunningDatabase()
    const { port, token } = await startTestApp(t)

    const accountRes = await postJson(port, '/api/accounts', token, {
      account_name: 'Validation Account',
      remark: null,
      biz_type: 'mixed',
      status: 'active',
    })
    assert.equal(accountRes.response.status, 200, accountRes.text)
    const account = JSON.parse(accountRes.text) as { account_id: string }

    const validSkuId = '33333333-3333-3333-3333-333333333333'
    await seedSku(runningDb.pool, {
      skuId: validSkuId,
      name: 'Validation SKU',
      inventoryQuantity: 6,
    })

    const malformedSkuRes = await postJson(port, '/api/orders', token, {
      order_id: `ORDER-BAD-SKU-${Date.now()}`,
      account_id: account.account_id,
      order_type: 'wholesale',
      buyer_name: 'Bad SKU Buyer',
      shipping_address: 'Shanghai',
      items: [{ sku_id: 'not-a-uuid', inventory_id: null, name: 'Broken', qty: 1, unit_price: 1 }],
      total_amount: 1,
      ship_status: 'pending',
      is_abnormal: false,
      settlement_status: 'unpaid',
      paid_amount: 0,
    })
    assert.equal(malformedSkuRes.response.status, 400, malformedSkuRes.text)
    assert.match(malformedSkuRes.text, /sku/i)

    const malformedQtyRes = await postJson(port, '/api/orders', token, {
      order_id: `ORDER-BAD-QTY-${Date.now()}`,
      account_id: account.account_id,
      order_type: 'wholesale',
      buyer_name: 'Bad Qty Buyer',
      shipping_address: 'Shanghai',
      items: [{ sku_id: validSkuId, inventory_id: null, name: 'Broken Qty', qty: 'oops', unit_price: 1 }],
      total_amount: 1,
      ship_status: 'pending',
      is_abnormal: false,
      settlement_status: 'unpaid',
      paid_amount: 0,
    })
    assert.equal(malformedQtyRes.response.status, 400, malformedQtyRes.text)
    assert.match(malformedQtyRes.text, /quantity/i)
    assert.equal(await readSkuInventory(runningDb.pool, validSkuId), 6)
  }
)
