import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Pool } from 'pg'
import { runInitDb } from '../scripts/initDbRunner.js'

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0xQAAAAASUVORK5CYII=',
  'base64'
)
const brokenPng = Buffer.from('this-is-not-a-real-image')
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
  const containerName = `codex-product-images-routes-${process.pid}-${Date.now()}-${Math.random()
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

async function listFilesRecursive(rootDir: string, currentDir = rootDir): Promise<string[]> {
  const entries = await readdir(currentDir, { withFileTypes: true }).catch(() => [])
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(rootDir, fullPath)))
      continue
    }

    files.push(path.relative(rootDir, fullPath))
  }

  return files.sort()
}

test.after(async () => {
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
  'upload returns first image as primary and serves thumb/original',
  { concurrency: false },
  async (t) => {
    const running = await getSharedRunningDatabase()
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'dt-shipment-images-root-'))
    const tempUpload = await mkdtemp(path.join(os.tmpdir(), 'dt-shipment-images-tmp-'))
    const originalEnv = {
      PRODUCT_IMAGE_ROOT: process.env.PRODUCT_IMAGE_ROOT,
      PRODUCT_IMAGE_TMP_DIR: process.env.PRODUCT_IMAGE_TMP_DIR,
      PRODUCT_IMAGE_ALLOWED_MIME: process.env.PRODUCT_IMAGE_ALLOWED_MIME,
    }

    let server: ReturnType<typeof createServer> | null = null

    t.after(async () => {
      server?.close()
      await rm(tempRoot, { recursive: true, force: true })
      await rm(tempUpload, { recursive: true, force: true })

      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
    })

    process.env.PRODUCT_IMAGE_ROOT = tempRoot
    process.env.PRODUCT_IMAGE_TMP_DIR = tempUpload
    process.env.PRODUCT_IMAGE_ALLOWED_MIME = 'image/jpeg,image/png,image/webp'

    const createAppModuleUrl = `${pathToFileURL(
      path.resolve(process.cwd(), 'src/createApp.ts')
    ).href}?routes-test=${Date.now()}`
    const [{ createApp }] = await Promise.all([import(createAppModuleUrl)])

    const app = createApp(process.env)
    server = createServer(app)
    server.listen(0)
    await once(server, 'listening')

    const { port } = server.address() as { port: number }

    const loginRes = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: '123456' }),
    })

    assert.equal(loginRes.status, 200)
    const login = (await loginRes.json()) as { token: string }

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

    assert.equal(skuRes.status, 200)
    const sku = (await skuRes.json()) as { sku_id: string }

    const form = new FormData()
    form.append('files', new Blob([tinyPng], { type: 'image/png' }), 'cover.png')
    form.append('files', new Blob([tinyPng], { type: 'image/png' }), 'detail.png')

    const uploadRes = await fetch(`http://127.0.0.1:${port}/api/skus/${sku.sku_id}/images`, {
      method: 'POST',
      headers: { authorization: `Bearer ${login.token}` },
      body: form,
    })

    const uploadBody = await uploadRes.text()
    assert.equal(uploadRes.status, 201, uploadBody)
    const payload = JSON.parse(uploadBody) as {
      images: Array<{
        image_id: string
        is_primary: boolean
        sort_order: number
      }>
    }

    assert.equal(payload.images.length, 2)
    assert.equal(payload.images[0]?.is_primary, true)
    assert.deepEqual(
      payload.images.map((image) => image.sort_order),
      [1, 2]
    )

    const thumbRes = await fetch(
      `http://127.0.0.1:${port}/api/product-images/${payload.images[0]?.image_id}/thumb`,
      {
        headers: { authorization: `Bearer ${login.token}` },
      }
    )
    assert.equal(thumbRes.status, 200)
    assert.match(thumbRes.headers.get('content-type') ?? '', /^image\/jpeg/)
    assert.ok((await thumbRes.arrayBuffer()).byteLength > 0)

    const originalRes = await fetch(
      `http://127.0.0.1:${port}/api/product-images/${payload.images[0]?.image_id}/original`,
      {
        headers: { authorization: `Bearer ${login.token}` },
      }
    )
    assert.equal(originalRes.status, 200)
    assert.match(originalRes.headers.get('content-type') ?? '', /^image\/png/)
    assert.ok((await originalRes.arrayBuffer()).byteLength > 0)

    const originalFiles = await readFile(
      path.join(tempRoot, 'original', sku.sku_id, `${payload.images[0]?.image_id}.png`)
    )
    assert.ok(originalFiles.byteLength > 0)
    assert.ok((await listFilesRecursive(tempRoot)).length > 0)
    assert.equal(running.pool.options.database, 'dt_ship_manager')
  }
)

dbTest(
  'invalid image content does not persist files or rows',
  { concurrency: false },
  async (t) => {
    const running = await getSharedRunningDatabase()
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'dt-shipment-images-root-'))
    const tempUpload = await mkdtemp(path.join(os.tmpdir(), 'dt-shipment-images-tmp-'))
    const originalEnv = {
      PRODUCT_IMAGE_ROOT: process.env.PRODUCT_IMAGE_ROOT,
      PRODUCT_IMAGE_TMP_DIR: process.env.PRODUCT_IMAGE_TMP_DIR,
      PRODUCT_IMAGE_ALLOWED_MIME: process.env.PRODUCT_IMAGE_ALLOWED_MIME,
    }

    let server: ReturnType<typeof createServer> | null = null

    t.after(async () => {
      server?.close()
      await rm(tempRoot, { recursive: true, force: true })
      await rm(tempUpload, { recursive: true, force: true })

      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
    })

    process.env.PRODUCT_IMAGE_ROOT = tempRoot
    process.env.PRODUCT_IMAGE_TMP_DIR = tempUpload
    process.env.PRODUCT_IMAGE_ALLOWED_MIME = 'image/jpeg,image/png,image/webp'

    const createAppModuleUrl = `${pathToFileURL(
      path.resolve(process.cwd(), 'src/createApp.ts')
    ).href}?routes-test-invalid=${Date.now()}`
    const [{ createApp }] = await Promise.all([import(createAppModuleUrl)])

    const app = createApp(process.env)
    server = createServer(app)
    server.listen(0)
    await once(server, 'listening')

    const { port } = server.address() as { port: number }

    const loginRes = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: '123456' }),
    })

    assert.equal(loginRes.status, 200)
    const login = (await loginRes.json()) as { token: string }

    const skuRes = await fetch(`http://127.0.0.1:${port}/api/skus`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${login.token}`,
      },
      body: JSON.stringify({
        sku_code: `TEST-BAD-${Date.now()}`,
        name: 'Broken image product',
        spec: '坏图测试',
        unit_price: 1,
        category: 'test',
        status: 'active',
      }),
    })

    assert.equal(skuRes.status, 200)
    const sku = (await skuRes.json()) as { sku_id: string }

    const form = new FormData()
    form.append('files', new Blob([brokenPng], { type: 'image/png' }), 'broken.png')

    const uploadRes = await fetch(`http://127.0.0.1:${port}/api/skus/${sku.sku_id}/images`, {
      method: 'POST',
      headers: { authorization: `Bearer ${login.token}` },
      body: form,
    })

    const uploadBody = await uploadRes.text()
    assert.equal(uploadRes.status, 500, uploadBody)

    const persistedRows = await running.pool.query<{ count: string }>(
      `select count(*)::text as count
       from product_images
       where sku_id = $1`,
      [sku.sku_id]
    )

    assert.equal(Number(persistedRows.rows[0]?.count ?? '0'), 0)
    assert.deepEqual(await listFilesRecursive(tempRoot), [])
    assert.deepEqual(await readdir(tempUpload).catch(() => []), [])
  }
)
