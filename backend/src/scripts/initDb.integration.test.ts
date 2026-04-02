import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Pool } from 'pg'
import { runInitDb } from './initDbRunner.js'

const dockerAvailable = spawnSync('docker', ['version'], { stdio: 'ignore' }).status === 0

const dbTest = dockerAvailable ? test : test.skip

type RunningDatabase = {
  pool: Pool
  containerName: string
}

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
  const containerName = `codex-product-images-initdb-${process.pid}-${Date.now()}-${Math.random()
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

async function withDisposablePostgres<T>(fn: (pool: Pool) => Promise<T>) {
  const running = await startDisposablePostgres()
  try {
    return await fn(running.pool)
  } finally {
    await stopDisposablePostgres(running)
  }
}

async function seedLegacyDuplicateState(pool: Pool, includeLegacyIndexes: boolean) {
  await pool.query(`
    create table if not exists skus (
      sku_id uuid primary key,
      name text not null,
      status text not null default 'active'
    );
  `)

  await pool.query(`
    create table if not exists product_images (
      image_id uuid primary key,
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
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `)

  await pool.query(`
    insert into skus (sku_id, name)
    values ('11111111-1111-1111-1111-111111111111', 'legacy sku');
  `)

  await pool.query(`
    insert into product_images (
      image_id, sku_id, storage_key, original_relpath, thumb_relpath,
      mime_type, file_ext, file_size, width, height, sha256,
      sort_order, is_primary, status, created_at, updated_at
    ) values
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'legacy/a', 'a', 'a', 'image/jpeg', 'jpg', 1, 10, 10, 'hash-a', 5, true,  'active', '2026-04-01 10:00:00+00', '2026-04-01 10:00:00+00'),
      ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'legacy/b', 'b', 'b', 'image/jpeg', 'jpg', 1, 10, 10, 'hash-b', 5, true,  'active', '2026-04-01 10:01:00+00', '2026-04-01 10:01:00+00'),
      ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'legacy/c', 'c', 'c', 'image/jpeg', 'jpg', 1, 10, 10, 'hash-c', 9, false, 'active', '2026-04-01 10:02:00+00', '2026-04-01 10:02:00+00');
  `)

  if (includeLegacyIndexes) {
    await pool.query(
      'create index product_images_sku_sort_idx on product_images(sku_id, sort_order);'
    )
    await pool.query(
      "create index product_images_primary_idx on product_images(sku_id, is_primary) where status = 'active';"
    )
  }
}

async function seedGappedNoPrimaryState(pool: Pool) {
  await pool.query(`
    create table if not exists skus (
      sku_id uuid primary key,
      name text not null,
      status text not null default 'active'
    );
  `)

  await pool.query(`
    create table if not exists product_images (
      image_id uuid primary key,
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
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `)

  await pool.query(`
    insert into skus (sku_id, name)
    values ('22222222-2222-2222-2222-222222222222', 'gap sku');
  `)

  await pool.query(`
    insert into product_images (
      image_id, sku_id, storage_key, original_relpath, thumb_relpath,
      mime_type, file_ext, file_size, width, height, sha256,
      sort_order, is_primary, status, created_at, updated_at
    ) values
      ('cccccccc-cccc-cccc-cccc-cccccccccccc', '22222222-2222-2222-2222-222222222222', 'gap/c', 'c', 'c', 'image/jpeg', 'jpg', 1, 10, 10, 'hash-c', 20, false, 'active', '2026-04-01 11:00:00+00', '2026-04-01 11:00:00+00'),
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'gap/a', 'a', 'a', 'image/jpeg', 'jpg', 1, 10, 10, 'hash-a', 20, false, 'active', '2026-04-01 11:01:00+00', '2026-04-01 11:01:00+00'),
      ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'gap/b', 'b', 'b', 'image/jpeg', 'jpg', 1, 10, 10, 'hash-b', 40, false, 'active', '2026-04-01 11:02:00+00', '2026-04-01 11:02:00+00');
  `)
}

async function seedPartialProductImagesTable(pool: Pool) {
  await pool.query(`
    create table if not exists skus (
      sku_id uuid primary key,
      name text not null,
      status text not null default 'active'
    );
  `)

  await pool.query(`
    create table if not exists product_images (
      image_id uuid,
      sku_id uuid,
      storage_key text
    );
  `)
}

async function seedWrongPrimaryState(pool: Pool) {
  await pool.query(`
    create table if not exists skus (
      sku_id uuid primary key,
      name text not null,
      status text not null default 'active'
    );
  `)

  await pool.query(`
    create table if not exists product_images (
      image_id uuid primary key,
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
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `)

  await pool.query(`
    insert into skus (sku_id, name)
    values ('33333333-3333-3333-3333-333333333333', 'wrong primary sku');
  `)

  await pool.query(`
    insert into product_images (
      image_id, sku_id, storage_key, original_relpath, thumb_relpath,
      mime_type, file_ext, file_size, width, height, sha256,
      sort_order, is_primary, status, created_at, updated_at
    ) values
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'wrong/a', 'a', 'a', 'image/jpeg', 'jpg', 1, 10, 10, 'hash-a', 1, false, 'active', '2026-04-01 12:00:00+00', '2026-04-01 12:00:00+00'),
      ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333', 'wrong/b', 'b', 'b', 'image/jpeg', 'jpg', 1, 10, 10, 'hash-b', 2, true,  'active', '2026-04-01 12:01:00+00', '2026-04-01 12:01:00+00'),
      ('cccccccc-cccc-cccc-cccc-cccccccccccc', '33333333-3333-3333-3333-333333333333', 'wrong/c', 'c', 'c', 'image/jpeg', 'jpg', 1, 10, 10, 'hash-c', 3, false, 'active', '2026-04-01 12:02:00+00', '2026-04-01 12:02:00+00');
  `)
}

async function readProductImageState(pool: Pool) {
  const rows = await pool.query<{
    image_id: string
    sort_order: number
    is_primary: boolean
    updated_at: Date
  }>(`
    select image_id, sort_order, is_primary, updated_at
    from product_images
    order by sort_order, image_id
  `)

  const indexes = await pool.query<{ indexname: string }>(`
    select indexname
    from pg_indexes
    where schemaname = current_schema()
      and tablename = 'product_images'
    order by indexname
  `)

  return {
    rows: rows.rows,
    indexes: indexes.rows.map((row) => row.indexname),
  }
}

async function readProductImageColumns(pool: Pool) {
  const columns = await pool.query<{ column_name: string }>(`
    select column_name
    from information_schema.columns
    where table_schema = current_schema()
      and table_name = 'product_images'
    order by column_name
  `)

  return columns.rows.map((row) => row.column_name)
}

async function readProductImageColumnMetadata(pool: Pool) {
  const columns = await pool.query<{
    column_name: string
    is_nullable: 'YES' | 'NO'
    column_default: string | null
  }>(`
    select column_name, is_nullable, column_default
    from information_schema.columns
    where table_schema = current_schema()
      and table_name = 'product_images'
    order by column_name
  `)

  return Object.fromEntries(
    columns.rows.map((row) => [
      row.column_name,
      { isNullable: row.is_nullable, columnDefault: row.column_default },
    ])
  ) as Record<string, { isNullable: 'YES' | 'NO'; columnDefault: string | null }>
}

async function readProductImageConstraintNames(pool: Pool) {
  const constraints = await pool.query<{ conname: string; contype: string }>(`
    select constraint_row.conname, constraint_row.contype
    from pg_constraint constraint_row
    join pg_class table_row
      on table_row.oid = constraint_row.conrelid
    join pg_namespace namespace_row
      on namespace_row.oid = table_row.relnamespace
    where namespace_row.nspname = current_schema()
      and table_row.relname = 'product_images'
    order by constraint_row.conname
  `)

  return constraints.rows.map((row) => `${row.conname}:${row.contype}`)
}

const schemaSql = readFileSync(path.resolve(process.cwd(), 'db/init.sql'), 'utf8')

dbTest('db:init converges clean, legacy, gapped, and partial postgres states', async () => {
  await withDisposablePostgres(async (pool) => {
    await runInitDb(pool, schemaSql)
    await runInitDb(pool, schemaSql)

    const state = await readProductImageState(pool)
    assert.equal(state.rows.length, 0)
    assert.deepEqual(state.indexes, [
      'product_images_active_primary_uidx',
      'product_images_active_sku_sort_uidx',
      'product_images_pkey',
      'product_images_status_idx',
      'product_images_storage_key_key',
    ])
  })

  await withDisposablePostgres(async (pool) => {
    await seedLegacyDuplicateState(pool, true)
    await runInitDb(pool, schemaSql)

    const state = await readProductImageState(pool)
    assert.deepEqual(
      state.rows.map((row) => [row.image_id, row.sort_order, row.is_primary]),
      [
        ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, true],
        ['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 2, false],
        ['cccccccc-cccc-cccc-cccc-cccccccccccc', 3, false],
      ]
    )
    assert.ok(state.rows.every((row) => row.updated_at.getTime() > new Date('2026-04-01T00:00:00Z').getTime()))
    assert.deepEqual(state.indexes, [
      'product_images_active_primary_uidx',
      'product_images_active_sku_sort_uidx',
      'product_images_pkey',
      'product_images_status_idx',
      'product_images_storage_key_key',
    ])
  })

  await withDisposablePostgres(async (pool) => {
    await seedLegacyDuplicateState(pool, false)
    await runInitDb(pool, schemaSql)

    const state = await readProductImageState(pool)
    assert.deepEqual(
      state.rows.map((row) => [row.image_id, row.sort_order, row.is_primary]),
      [
        ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, true],
        ['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 2, false],
        ['cccccccc-cccc-cccc-cccc-cccccccccccc', 3, false],
      ]
    )
    assert.ok(state.rows.every((row) => row.updated_at.getTime() > new Date('2026-04-01T00:00:00Z').getTime()))
    assert.deepEqual(state.indexes, [
      'product_images_active_primary_uidx',
      'product_images_active_sku_sort_uidx',
      'product_images_pkey',
      'product_images_status_idx',
      'product_images_storage_key_key',
    ])
  })

  await withDisposablePostgres(async (pool) => {
    await seedGappedNoPrimaryState(pool)
    await runInitDb(pool, schemaSql)

    const state = await readProductImageState(pool)
    assert.deepEqual(
      state.rows.map((row) => [row.image_id, row.sort_order, row.is_primary]),
      [
        ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, true],
        ['cccccccc-cccc-cccc-cccc-cccccccccccc', 2, false],
        ['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 3, false],
      ]
    )
    assert.ok(state.rows.every((row) => row.updated_at.getTime() > new Date('2026-04-01T00:00:00Z').getTime()))
    assert.deepEqual(state.indexes, [
      'product_images_active_primary_uidx',
      'product_images_active_sku_sort_uidx',
      'product_images_pkey',
      'product_images_status_idx',
      'product_images_storage_key_key',
    ])
  })

  await withDisposablePostgres(async (pool) => {
    await seedWrongPrimaryState(pool)
    await runInitDb(pool, schemaSql)

    const state = await readProductImageState(pool)
    assert.deepEqual(
      state.rows.map((row) => [row.image_id, row.sort_order, row.is_primary]),
      [
        ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, true],
        ['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 2, false],
        ['cccccccc-cccc-cccc-cccc-cccccccccccc', 3, false],
      ]
    )
  })

  await withDisposablePostgres(async (pool) => {
    await seedPartialProductImagesTable(pool)
    await runInitDb(pool, schemaSql)

    const columns = await readProductImageColumns(pool)
    assert.deepEqual(columns, [
      'created_at',
      'deleted_at',
      'file_ext',
      'file_size',
      'height',
      'image_id',
      'is_primary',
      'mime_type',
      'original_relpath',
      'sha256',
      'sku_id',
      'sort_order',
      'status',
      'storage_key',
      'thumb_relpath',
      'updated_at',
      'width',
    ])

    const metadata = await readProductImageColumnMetadata(pool)
    assert.equal(metadata.image_id.isNullable, 'NO')
    assert.ok(metadata.image_id.columnDefault?.includes('gen_random_uuid()'))
    assert.equal(metadata.sku_id.isNullable, 'NO')
    assert.equal(metadata.storage_key.isNullable, 'NO')
    assert.equal(metadata.original_relpath.isNullable, 'NO')
    assert.equal(metadata.thumb_relpath.isNullable, 'NO')
    assert.equal(metadata.mime_type.isNullable, 'NO')
    assert.equal(metadata.file_ext.isNullable, 'NO')
    assert.equal(metadata.file_size.isNullable, 'NO')
    assert.equal(metadata.width.isNullable, 'NO')
    assert.equal(metadata.height.isNullable, 'NO')
    assert.equal(metadata.sha256.isNullable, 'NO')
    assert.equal(metadata.sort_order.isNullable, 'NO')
    assert.ok(metadata.sort_order.columnDefault?.includes('1'))
    assert.equal(metadata.is_primary.isNullable, 'NO')
    assert.ok(metadata.is_primary.columnDefault?.includes('false'))
    assert.equal(metadata.status.isNullable, 'NO')
    assert.ok(metadata.status.columnDefault?.includes('active'))
    assert.equal(metadata.created_at.isNullable, 'NO')
    assert.ok(metadata.created_at.columnDefault?.includes('now()') || metadata.created_at.columnDefault?.includes('CURRENT_TIMESTAMP'))
    assert.equal(metadata.updated_at.isNullable, 'NO')
    assert.ok(metadata.updated_at.columnDefault?.includes('now()') || metadata.updated_at.columnDefault?.includes('CURRENT_TIMESTAMP'))

    assert.deepEqual(await readProductImageConstraintNames(pool), [
      'product_images_pkey:p',
      'product_images_sku_id_fkey:f',
      'product_images_storage_key_key:u',
    ])
  })
})
