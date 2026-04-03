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

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase()
}

function isSchemaMutationQuery(sql: string) {
  const normalized = normalizeSql(sql)
  return (
    normalized.startsWith('alter table') ||
    normalized.startsWith('update product_images') ||
    normalized.startsWith('insert into skus') ||
    normalized.startsWith('drop index') ||
    normalized.startsWith('create unique index') ||
    normalized.startsWith('create index if not exists product_images_status_idx')
  )
}

function countSchemaMutationQueries(queries: string[]) {
  return queries.filter(isSchemaMutationQuery).length
}

function createRecordingPool(pool: Pool) {
  const queries: string[] = []

  return {
    queries,
    async query(sql: string) {
      queries.push(normalizeSql(sql))
      return pool.query(sql)
    },
    async connect() {
      const client = await pool.connect()
      return {
        async query(sql: string) {
          queries.push(normalizeSql(sql))
          return client.query(sql)
        },
        release() {
          client.release()
        },
      }
    },
    async end() {
      await pool.end()
    },
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
      sort_order integer,
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
      sort_order integer,
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

async function seedPartialProductImagesDuplicateStorageKeyState(pool: Pool) {
  await seedPartialProductImagesTable(pool)

  await pool.query(`
    insert into product_images (image_id, sku_id, storage_key)
    values
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'dup-storage'),
      ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '44444444-4444-4444-4444-444444444444', 'dup-storage');
  `)
}

async function seedPartialProductImagesDuplicateImageIdState(pool: Pool) {
  await seedPartialProductImagesTable(pool)

  await pool.query(`
    insert into product_images (image_id, sku_id, storage_key)
    values
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '66666666-6666-6666-6666-666666666666', 'dup-image-a'),
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '66666666-6666-6666-6666-666666666666', 'dup-image-b');
  `)
}

async function seedWrongDefinitionProductImageIndexes(pool: Pool) {
  await seedWrongPrimaryState(pool)

  await pool.query(`
    create index product_images_active_sku_sort_uidx
      on product_images(sku_id, sort_order);
  `)

  await pool.query(`
    create index product_images_active_primary_uidx
      on product_images(sku_id);
  `)

  await pool.query(`
    create index product_images_status_idx
      on product_images(status);
  `)
}

async function seedMixedDriftProductImageState(pool: Pool) {
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
      sort_order integer,
      is_primary boolean not null default false,
      status text not null default 'active',
      deleted_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `)

  await pool.query(`
    insert into skus (sku_id, name)
    values ('77777777-7777-7777-7777-777777777777', 'mixed drift sku');
  `)

  await pool.query(`
    insert into product_images (
      image_id, sku_id, storage_key, original_relpath, thumb_relpath,
      mime_type, file_ext, file_size, width, height, sha256,
      sort_order, is_primary, status, deleted_at, created_at, updated_at
    ) values
      ('dddddddd-dddd-dddd-dddd-dddddddddddd', '77777777-7777-7777-7777-777777777777', 'mixed/d', 'd', 'd', 'image/jpeg', 'jpg', 1, 10, 10, 'hash-d', 1, false, 'deleted', '2026-04-01 08:00:00+00', '2026-04-01 08:00:00+00', '2026-04-01 08:00:00+00'),
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '77777777-7777-7777-7777-777777777777', 'mixed/a', 'a', 'a', 'image/jpeg', 'jpg', 1, 10, 10, 'hash-a', null, false, 'active',  null, '2026-04-01 08:01:00+00', '2026-04-01 08:01:00+00'),
      ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '77777777-7777-7777-7777-777777777777', 'mixed/b', 'b', 'b', 'image/jpeg', 'jpg', 1, 10, 10, 'hash-b', 3, true,  'active',  null, '2026-04-01 08:02:00+00', '2026-04-01 08:02:00+00');
  `)

  await pool.query(`
    create unique index product_images_active_sku_sort_uidx
      on product_images(sku_id, sort_order);
  `)
}

async function seedExtraClausesProductImageIndexes(pool: Pool) {
  await seedWrongPrimaryState(pool)

  await pool.query(`
    alter table product_images
      add column if not exists deleted_at timestamptz;
  `)

  await pool.query(`
    create unique index product_images_active_sku_sort_uidx
      on product_images(sku_id, sort_order) include (image_id)
      where status = 'active';
  `)

  await pool.query(`
    create unique index product_images_active_primary_uidx
      on product_images(sku_id)
      where status = 'active' and is_primary and deleted_at is null;
  `)

  await pool.query(`
    create index product_images_status_idx
      on product_images(status, deleted_at)
      where status = 'active';
  `)
}

async function seedPartialProductImagesCompositeUniqueState(pool: Pool) {
  await seedPartialProductImagesTable(pool)

  await pool.query(`
    alter table product_images
      add constraint product_images_storage_key_sku_id_key unique (storage_key, sku_id);
  `)

  await pool.query(`
    insert into skus (sku_id, name)
    values ('55555555-5555-5555-5555-555555555555', 'composite unique sku');
  `)

  await pool.query(`
    insert into product_images (image_id, sku_id, storage_key)
    values
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '55555555-5555-5555-5555-555555555555', 'composite/a'),
      ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '55555555-5555-5555-5555-555555555555', 'composite/b');
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

async function readProductImageIndexDefinitions(pool: Pool) {
  const indexes = await pool.query<{ indexname: string; indexdef: string }>(`
    select indexname, indexdef
    from pg_indexes
    where schemaname = current_schema()
      and tablename = 'product_images'
      and indexname in (
        'product_images_active_sku_sort_uidx',
        'product_images_active_primary_uidx',
        'product_images_status_idx'
      )
    order by indexname
  `)

  return Object.fromEntries(indexes.rows.map((row) => [row.indexname, row.indexdef]))
}

function normalizeIndexDefinition(indexDef: string) {
  return indexDef.replace(/\s+/g, ' ').trim().toLowerCase()
}

const schemaSql = readFileSync(path.resolve(process.cwd(), 'db/init.sql'), 'utf8')

dbTest('db:init leaves product_images convergence no-op on clean steady-state boot', async () => {
  await withDisposablePostgres(async (pool) => {
    const recordingPool = createRecordingPool(pool)

    await runInitDb(recordingPool, schemaSql)
    recordingPool.queries.length = 0
    await runInitDb(recordingPool, schemaSql)

    assert.equal(countSchemaMutationQueries(recordingPool.queries), 0)
    assert.equal(recordingPool.queries.length > 0, true)

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
    await seedWrongPrimaryState(pool)
    await pool.query(`
      create unique index product_images_active_sku_sort_uidx
        on product_images(sku_id, sort_order)
        where status = 'active';
    `)
    await pool.query(`
      create unique index product_images_active_primary_uidx
        on product_images(sku_id)
        where status = 'active' and is_primary;
    `)

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

  await withDisposablePostgres(async (pool) => {
    await seedPartialProductImagesDuplicateStorageKeyState(pool)
    const recordingPool = createRecordingPool(pool)

    await assert.rejects(() => runInitDb(recordingPool, schemaSql), /duplicate image_id or storage_key values/)
    assert.equal(countSchemaMutationQueries(recordingPool.queries), 0)

    const columns = await readProductImageColumns(pool)
    assert.deepEqual(columns, ['image_id', 'sku_id', 'storage_key'])

    const rows = await pool.query<{
      image_id: string
      sku_id: string
      storage_key: string
    }>(`
      select image_id, sku_id, storage_key
      from product_images
      order by image_id
    `)

    assert.deepEqual(rows.rows, [
      {
        image_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        sku_id: '44444444-4444-4444-4444-444444444444',
        storage_key: 'dup-storage',
      },
      {
        image_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        sku_id: '44444444-4444-4444-4444-444444444444',
        storage_key: 'dup-storage',
      },
    ])
  })

  await withDisposablePostgres(async (pool) => {
    await seedPartialProductImagesDuplicateImageIdState(pool)
    const recordingPool = createRecordingPool(pool)

    await assert.rejects(() => runInitDb(recordingPool, schemaSql), /duplicate image_id or storage_key values/)
    assert.equal(countSchemaMutationQueries(recordingPool.queries), 0)

    const rows = await pool.query<{
      image_id: string
      sku_id: string
      storage_key: string
    }>(`
      select image_id, sku_id, storage_key
      from product_images
      order by storage_key
    `)

    assert.deepEqual(rows.rows, [
      {
        image_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        sku_id: '66666666-6666-6666-6666-666666666666',
        storage_key: 'dup-image-a',
      },
      {
        image_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        sku_id: '66666666-6666-6666-6666-666666666666',
        storage_key: 'dup-image-b',
      },
    ])
  })

  await withDisposablePostgres(async (pool) => {
    await seedWrongDefinitionProductImageIndexes(pool)
    await runInitDb(pool, schemaSql)

    const indexDefinitions = await readProductImageIndexDefinitions(pool)
    const activePrimaryIndexDef = normalizeIndexDefinition(
      indexDefinitions.product_images_active_primary_uidx
    )
    const activeSkuSortIndexDef = normalizeIndexDefinition(
      indexDefinitions.product_images_active_sku_sort_uidx
    )
    const statusIndexDef = normalizeIndexDefinition(indexDefinitions.product_images_status_idx)

    assert.ok(
      activePrimaryIndexDef.includes(
        'create unique index product_images_active_primary_uidx'
      )
    )
    assert.ok(
      activePrimaryIndexDef.includes(
        'where ((status = \'active\'::text) and is_primary)'
      )
    )
    assert.ok(
      activeSkuSortIndexDef.includes(
        'create unique index product_images_active_sku_sort_uidx'
      )
    )
    assert.ok(
      activeSkuSortIndexDef.includes(
        'where (status = \'active\'::text)'
      )
    )
    assert.ok(
      statusIndexDef.includes(
        'create index product_images_status_idx'
      )
    )
    assert.ok(statusIndexDef.includes('on public.product_images using btree (status, deleted_at)'))
    assert.equal(statusIndexDef.includes('unique'), false)
  })

  await withDisposablePostgres(async (pool) => {
    await seedMixedDriftProductImageState(pool)
    await runInitDb(pool, schemaSql)

    const activeRows = await pool.query<{
      image_id: string
      sort_order: number
      is_primary: boolean
    }>(`
      select image_id, sort_order, is_primary
      from product_images
      where sku_id = '77777777-7777-7777-7777-777777777777'
        and status = 'active'
      order by sort_order, image_id
    `)

    assert.deepEqual(activeRows.rows, [
      {
        image_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        sort_order: 1,
        is_primary: true,
      },
      {
        image_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        sort_order: 2,
        is_primary: false,
      },
    ])
  })

  await withDisposablePostgres(async (pool) => {
    await seedExtraClausesProductImageIndexes(pool)
    await runInitDb(pool, schemaSql)

    const indexDefinitions = await readProductImageIndexDefinitions(pool)
    const activePrimaryIndexDef = normalizeIndexDefinition(
      indexDefinitions.product_images_active_primary_uidx
    )
    const activeSkuSortIndexDef = normalizeIndexDefinition(
      indexDefinitions.product_images_active_sku_sort_uidx
    )
    const statusIndexDef = normalizeIndexDefinition(indexDefinitions.product_images_status_idx)

    assert.equal(activePrimaryIndexDef.includes('deleted_at is null'), false)
    assert.equal(activePrimaryIndexDef.includes('include ('), false)
    assert.equal(activeSkuSortIndexDef.includes('include ('), false)
    assert.equal(statusIndexDef.includes('where ('), false)
    assert.ok(
      activePrimaryIndexDef.includes(
        'where ((status = \'active\'::text) and is_primary)'
      )
    )
    assert.ok(
      activeSkuSortIndexDef.includes(
        'where (status = \'active\'::text)'
      )
    )
    assert.ok(statusIndexDef.includes('on public.product_images using btree (status, deleted_at)'))
  })

  await withDisposablePostgres(async (pool) => {
    await seedPartialProductImagesCompositeUniqueState(pool)
    await runInitDb(pool, schemaSql)

    const constraintNames = await readProductImageConstraintNames(pool)
    assert.ok(constraintNames.includes('product_images_storage_key_key:u'))
    assert.ok(constraintNames.includes('product_images_storage_key_sku_id_key:u'))
  })
})
