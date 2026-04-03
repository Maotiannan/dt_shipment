import test from 'node:test'
import assert from 'node:assert/strict'
import { runInitDb } from './initDbRunner.js'

type Scenario = {
  legacyIndexNames: string[]
  currentIndexNames: string[]
  currentIndexDefinitions: Record<string, string>
  hasRows: boolean
  hasCanonicalDrift: boolean
  hasPgcryptoExtension: boolean
  tableCount: number
  schemaTables?: string[]
  schemaColumnsByTable?: Record<string, string[]>
  skuRows?: Array<Record<string, string | null>>
}

function makePool(scenario: Scenario) {
  const queries: string[] = []
  let repairRan = false
  let droppedLegacyIndexes = false
  let currentIndexesCreated = false
  const state = {
    legacyIndexNames: [...scenario.legacyIndexNames],
    currentIndexNames: [...scenario.currentIndexNames],
    currentIndexDefinitions: { ...scenario.currentIndexDefinitions },
    hasRows: scenario.hasRows,
    hasCanonicalDrift: scenario.hasCanonicalDrift,
    hasPgcryptoExtension: scenario.hasPgcryptoExtension,
    tableCount: scenario.tableCount,
    skuRows: scenario.skuRows ?? [],
    schemaTables: scenario.schemaTables ?? [
      'fish_accounts',
      'skus',
      'orders',
      'push_subscriptions',
      'product_images',
    ],
    schemaColumnsByTable: scenario.schemaColumnsByTable ?? {
      skus: [
        'sku_id',
        'sku_code',
        'name',
        'spec',
        'unit_price',
        'category',
        'status',
        'inventory_id',
        'inventory_quantity',
        'created_at',
      ],
      orders: [
        'order_id',
        'account_id',
        'order_type',
        'buyer_name',
        'shipping_address',
        'items',
        'total_amount',
        'ship_status',
        'tracking_number',
        'tracking_method',
        'is_abnormal',
        'abnormal_type',
        'remark',
        'settlement_status',
        'paid_amount',
        'paid_at',
        'paid_remark',
        'created_at',
        'shipped_at',
      ],
    },
  }

  function buildCanonicalIndexState(indexname: string) {
    if (indexname === 'product_images_active_sku_sort_uidx') {
      return {
        indexname,
        access_method: 'btree',
        is_unique: true,
        key_att_count: 2,
        total_att_count: 2,
        has_expressions: false,
        reloptions: [],
        predicate_sql: "(status = 'active'::text)",
        key_columns: ['sku_id', 'sort_order'],
      }
    }

    if (indexname === 'product_images_active_primary_uidx') {
      return {
        indexname,
        access_method: 'btree',
        is_unique: true,
        key_att_count: 1,
        total_att_count: 1,
        has_expressions: false,
        reloptions: [],
        predicate_sql: "((status = 'active'::text) and is_primary)",
        key_columns: ['sku_id'],
      }
    }

    return {
      indexname,
      access_method: 'btree',
      is_unique: false,
      key_att_count: 2,
      total_att_count: 2,
      has_expressions: false,
      reloptions: [],
      predicate_sql: null,
      key_columns: ['status', 'deleted_at'],
    }
  }

  return {
    queries,
    get state() {
      return { repairRan, droppedLegacyIndexes, currentIndexesCreated, state }
    },
    async query(sql: string) {
      const normalized = sql.replace(/\s+/g, ' ').trim()
      queries.push(normalized)

      if (normalized === 'create extension if not exists pgcrypto;') {
        state.hasPgcryptoExtension = true
        return { rows: [] }
      }

      if (normalized === 'schema-sql') {
        return { rows: [] }
      }

      if (
        normalized.includes('alter table if exists skus add column if not exists category_name text') &&
        normalized.includes('alter table if exists skus add column if not exists color_name text') &&
        normalized.includes('alter table if exists skus add column if not exists variant_name text') &&
        normalized.includes('alter table if exists orders add column if not exists delivery_channel text') &&
        normalized.includes('create table if not exists inventory_movements') &&
        normalized.includes('create table if not exists sku_attribute_suggestions')
      ) {
        for (const columnName of ['category_name', 'color_name', 'variant_name']) {
          if (!state.schemaColumnsByTable.skus.includes(columnName)) {
            state.schemaColumnsByTable.skus.push(columnName)
          }
        }

        if (!state.schemaColumnsByTable.orders.includes('delivery_channel')) {
          state.schemaColumnsByTable.orders.push('delivery_channel')
        }

        for (const tableName of ['inventory_movements', 'sku_attribute_suggestions']) {
          if (!state.schemaTables.includes(tableName)) {
            state.schemaTables.push(tableName)
          }
        }

        return { rows: [] }
      }

      if (normalized.startsWith('alter table if exists skus add column if not exists category_name text')) {
        if (!state.schemaColumnsByTable.skus.includes('category_name')) {
          state.schemaColumnsByTable.skus.push('category_name')
        }
        return { rows: [] }
      }

      if (normalized.startsWith('alter table if exists skus add column if not exists color_name text')) {
        if (!state.schemaColumnsByTable.skus.includes('color_name')) {
          state.schemaColumnsByTable.skus.push('color_name')
        }
        return { rows: [] }
      }

      if (normalized.startsWith('alter table if exists skus add column if not exists variant_name text')) {
        if (!state.schemaColumnsByTable.skus.includes('variant_name')) {
          state.schemaColumnsByTable.skus.push('variant_name')
        }
        return { rows: [] }
      }

      if (normalized.startsWith('alter table if exists orders add column if not exists delivery_channel text')) {
        if (!state.schemaColumnsByTable.orders.includes('delivery_channel')) {
          state.schemaColumnsByTable.orders.push('delivery_channel')
        }
        return { rows: [] }
      }

      if (normalized.startsWith('create table if not exists inventory_movements')) {
        if (!state.schemaTables.includes('inventory_movements')) {
          state.schemaTables.push('inventory_movements')
        }
        return { rows: [] }
      }

      if (normalized.startsWith('create table if not exists sku_attribute_suggestions')) {
        if (!state.schemaTables.includes('sku_attribute_suggestions')) {
          state.schemaTables.push('sku_attribute_suggestions')
        }
        return { rows: [] }
      }

      if (
        normalized.startsWith('update skus') &&
        normalized.includes('category_name = coalesce(category_name, category)') &&
        normalized.includes('variant_name = coalesce(variant_name, spec)')
      ) {
        state.skuRows = state.skuRows.map((row) => ({
          ...row,
          category_name: row.category_name ?? row.category ?? null,
          variant_name: row.variant_name ?? row.spec ?? null,
        }))
        return { rows: [] }
      }

      if (
        normalized.includes('from skus') &&
        normalized.includes('category is not null and category_name is null') &&
        normalized.includes('spec is not null and variant_name is null') &&
        normalized.includes('needs_backfill')
      ) {
        return {
          rows: [
            {
              needs_backfill: state.skuRows.some(
                (row) =>
                  (row.category != null && row.category_name == null) ||
                  (row.spec != null && row.variant_name == null)
              ),
            },
          ],
        }
      }

      if (
        normalized.includes('from information_schema.columns') &&
        normalized.includes("table_name = 'skus'")
      ) {
        return {
          rows: state.schemaColumnsByTable.skus.map((column_name) => ({ column_name })),
        }
      }

      if (
        normalized.includes('from information_schema.columns') &&
        normalized.includes("table_name = 'orders'")
      ) {
        return {
          rows: state.schemaColumnsByTable.orders.map((column_name) => ({ column_name })),
        }
      }

      if (normalized.includes('from information_schema.columns') && normalized.includes('product_images')) {
        return {
          rows: [
            { column_name: 'image_id', is_nullable: 'NO', column_default: 'gen_random_uuid()' },
            { column_name: 'sku_id', is_nullable: 'NO', column_default: null },
            { column_name: 'storage_key', is_nullable: 'NO', column_default: null },
            { column_name: 'original_relpath', is_nullable: 'NO', column_default: null },
            { column_name: 'thumb_relpath', is_nullable: 'NO', column_default: null },
            { column_name: 'mime_type', is_nullable: 'NO', column_default: null },
            { column_name: 'file_ext', is_nullable: 'NO', column_default: null },
            { column_name: 'file_size', is_nullable: 'NO', column_default: null },
            { column_name: 'width', is_nullable: 'NO', column_default: null },
            { column_name: 'height', is_nullable: 'NO', column_default: null },
            { column_name: 'sha256', is_nullable: 'NO', column_default: null },
            { column_name: 'sort_order', is_nullable: 'NO', column_default: '1' },
            { column_name: 'is_primary', is_nullable: 'NO', column_default: 'false' },
            { column_name: 'status', is_nullable: 'NO', column_default: "'active'::text" },
            { column_name: 'created_at', is_nullable: 'NO', column_default: 'now()' },
            { column_name: 'updated_at', is_nullable: 'NO', column_default: 'now()' },
            { column_name: 'deleted_at', is_nullable: 'YES', column_default: null },
          ],
        }
      }

      if (
        normalized ===
        'select sku_id, category, spec from skus order by sku_id'
      ) {
        return {
          rows: state.skuRows.map((row) => ({
            sku_id: row.sku_id,
            category: row.category,
            spec: row.spec,
          })),
        }
      }

      if (
        normalized ===
        'select sku_id, category_name, variant_name from skus order by sku_id'
      ) {
        return {
          rows: state.skuRows.map((row) => ({
            sku_id: row.sku_id,
            category_name: row.category_name,
            variant_name: row.variant_name,
          })),
        }
      }

      if (
        normalized.includes('from information_schema.tables') &&
        normalized.includes('select table_name')
      ) {
        return {
          rows: state.schemaTables.map((table_name) => ({ table_name })),
        }
      }

      if (normalized.includes('from pg_constraint') && normalized.includes("contype = 'p'")) {
        return { rows: [{ has_primary_key: true }] }
      }

      if (normalized.includes('from pg_constraint') && normalized.includes("contype = 'u'")) {
        return { rows: [{ has_storage_key_unique: true }] }
      }

      if (normalized.includes('from pg_constraint') && normalized.includes("contype = 'f'")) {
        return { rows: [{ has_sku_foreign_key: true }] }
      }

      if (
        normalized.includes('select exists ( select 1 from ( select image_id from product_images') &&
        normalized.includes('having count(*) > 1')
      ) {
        return { rows: [{ has_duplicate_image_ids: false }] }
      }

      if (
        normalized.includes('select exists ( select 1 from ( select storage_key from product_images') &&
        normalized.includes('having count(*) > 1')
      ) {
        return { rows: [{ has_duplicate_storage_keys: false }] }
      }

      if (normalized.includes("from pg_indexes") && normalized.includes("product_images_sku_sort_idx")) {
        if (normalized.includes('indexdef')) {
          return {
            rows: state.legacyIndexNames.map((indexname) => ({
              indexname,
              indexdef: state.currentIndexDefinitions[indexname] ?? '',
            })),
          }
        }

        return { rows: state.legacyIndexNames.map((indexname) => ({ indexname })) }
      }

      if (
        normalized.includes("from pg_indexes") &&
        normalized.includes("product_images_active_sku_sort_uidx")
      ) {
        if (normalized.includes('access_method.amname as access_method')) {
          return {
            rows: state.currentIndexNames.map((indexname) => buildCanonicalIndexState(indexname)),
          }
        }

        if (normalized.includes('indexdef')) {
          return {
            rows: state.currentIndexNames.map((indexname) => ({
              indexname,
              indexdef: state.currentIndexDefinitions[indexname] ?? '',
            })),
          }
        }

        return { rows: state.currentIndexNames.map((indexname) => ({ indexname })) }
      }

      if (normalized.includes('from pg_extension') && normalized.includes("extname = 'pgcrypto'")) {
        return { rows: [{ has_pgcrypto: state.hasPgcryptoExtension }] }
      }

      if (
        normalized.includes('from information_schema.tables') &&
        normalized.includes('table_name = any (array[')
      ) {
        return { rows: [{ table_count: state.tableCount }] }
      }

      if (normalized.includes('select exists ( select 1 from product_images limit 1 ) as has_rows')) {
        return { rows: [{ has_rows: state.hasRows }] }
      }

      if (
        normalized.includes('count(*) as active_count') &&
        normalized.includes('distinct_sort_count') &&
        normalized.includes('primary_count') &&
        normalized.includes('canonical_primary_count')
      ) {
        return { rows: [{ has_duplicates: state.hasCanonicalDrift }] }
      }

      if (normalized.startsWith('with normalized_active_images as')) {
        repairRan = true
        return { rows: [] }
      }

      if (normalized.startsWith('insert into skus (sku_id, name, status)')) {
        return { rows: [] }
      }

      if (normalized.startsWith('insert into skus')) {
        return { rows: [] }
      }

      if (normalized.startsWith('with legacy_rows as (')) {
        return { rows: [] }
      }

      if (normalized.startsWith('alter table if exists product_images alter column')) {
        return { rows: [] }
      }

      if (normalized.startsWith('alter table if exists product_images add constraint')) {
        return { rows: [] }
      }

      if (normalized === 'drop index if exists product_images_sku_sort_idx;') {
        droppedLegacyIndexes = true
        state.legacyIndexNames = state.legacyIndexNames.filter(
          (indexname) => indexname !== 'product_images_sku_sort_idx'
        )
        return { rows: [] }
      }

      if (normalized === 'drop index if exists product_images_primary_idx;') {
        droppedLegacyIndexes = true
        state.legacyIndexNames = state.legacyIndexNames.filter(
          (indexname) => indexname !== 'product_images_primary_idx'
        )
        return { rows: [] }
      }

      if (normalized.startsWith('create unique index if not exists product_images_active_sku_sort_uidx')) {
        currentIndexesCreated = true
        state.currentIndexNames = [
          ...new Set([...state.currentIndexNames, 'product_images_active_sku_sort_uidx']),
        ]
        state.currentIndexDefinitions.product_images_active_sku_sort_uidx =
          'create unique index product_images_active_sku_sort_uidx on product_images using btree (sku_id, sort_order) where (status = \'active\'::text)'
        return { rows: [] }
      }

      if (normalized.startsWith('create unique index if not exists product_images_active_primary_uidx')) {
        currentIndexesCreated = true
        state.currentIndexNames = [
          ...new Set([...state.currentIndexNames, 'product_images_active_primary_uidx']),
        ]
        state.currentIndexDefinitions.product_images_active_primary_uidx =
          'create unique index product_images_active_primary_uidx on product_images using btree (sku_id) where ((status = \'active\'::text) and is_primary)'
        return { rows: [] }
      }

      if (normalized.startsWith('create index if not exists product_images_status_idx')) {
        currentIndexesCreated = true
        state.currentIndexNames = [...new Set([...state.currentIndexNames, 'product_images_status_idx'])]
        state.currentIndexDefinitions.product_images_status_idx =
          'create index product_images_status_idx on product_images using btree (status, deleted_at)'
        return { rows: [] }
      }

      if (normalized.startsWith('drop index if exists product_images_active_sku_sort_uidx')) {
        state.currentIndexNames = state.currentIndexNames.filter(
          (indexname) => indexname !== 'product_images_active_sku_sort_uidx'
        )
        delete state.currentIndexDefinitions.product_images_active_sku_sort_uidx
        return { rows: [] }
      }

      if (normalized.startsWith('drop index if exists product_images_active_primary_uidx')) {
        state.currentIndexNames = state.currentIndexNames.filter(
          (indexname) => indexname !== 'product_images_active_primary_uidx'
        )
        delete state.currentIndexDefinitions.product_images_active_primary_uidx
        return { rows: [] }
      }

      if (normalized.startsWith('drop index if exists product_images_status_idx')) {
        state.currentIndexNames = state.currentIndexNames.filter(
          (indexname) => indexname !== 'product_images_status_idx'
        )
        delete state.currentIndexDefinitions.product_images_status_idx
        return { rows: [] }
      }

      throw new Error(`Unexpected SQL: ${normalized}`)
    },
    async end() {
      return undefined
    },
  }
}

const SCHEMA_SQL = 'schema-sql'

async function readCommerceFoundationSchema(pool: ReturnType<typeof makePool>) {
  const [skusColumns, ordersColumns, tables] = await Promise.all([
    pool.query(`
      select column_name
      from information_schema.columns
      where table_schema = current_schema()
        and table_name = 'skus'
    `),
    pool.query(`
      select column_name
      from information_schema.columns
      where table_schema = current_schema()
        and table_name = 'orders'
    `),
    pool.query(`
      select table_name
      from information_schema.tables
      where table_schema = current_schema()
        and table_name in (
          'fish_accounts',
          'skus',
          'orders',
          'push_subscriptions',
          'product_images',
          'inventory_movements',
          'sku_attribute_suggestions'
        )
    `),
  ])

  const skuColumnRows = skusColumns.rows as Array<{ column_name: string }>
  const orderColumnRows = ordersColumns.rows as Array<{ column_name: string }>
  const tableRows = tables.rows as Array<{ table_name: string }>

  return {
    columns: new Set([
      ...skuColumnRows.map((row) => String(row.column_name)),
      ...orderColumnRows.map((row) => String(row.column_name)),
    ]),
    tables: new Set(tableRows.map((row) => String(row.table_name))),
  }
}

async function readLegacySkuRows(pool: ReturnType<typeof makePool>) {
  const rows = await pool.query(`
    select sku_id, category, spec
    from skus
    order by sku_id
  `)

  return rows.rows as Array<{
    sku_id: string
    category: string | null
    spec: string | null
  }>
}

async function readBackfilledSkuRows(pool: ReturnType<typeof makePool>) {
  const rows = await pool.query(`
    select sku_id, category_name, variant_name
    from skus
    order by sku_id
  `)

  return rows.rows as Array<{
    sku_id: string
    category_name: string | null
    variant_name: string | null
  }>
}

test('runInitDb repairs missing commerce foundation schema and stays stable on second boot', async () => {
  const pool = makePool({
    legacyIndexNames: [],
    currentIndexNames: [],
    currentIndexDefinitions: {},
    hasRows: false,
    hasCanonicalDrift: false,
    hasPgcryptoExtension: false,
    tableCount: 0,
  })

  const before = await readCommerceFoundationSchema(pool)
  assert.equal(before.columns.has('category_name'), false)
  assert.equal(before.columns.has('color_name'), false)
  assert.equal(before.columns.has('variant_name'), false)
  assert.equal(before.columns.has('delivery_channel'), false)
  assert.equal(before.tables.has('inventory_movements'), false)
  assert.equal(before.tables.has('sku_attribute_suggestions'), false)

  await runInitDb(pool, SCHEMA_SQL)

  const after = await readCommerceFoundationSchema(pool)
  assert(after.columns.has('category_name'))
  assert(after.columns.has('color_name'))
  assert(after.columns.has('variant_name'))
  assert(after.columns.has('delivery_channel'))
  assert(after.tables.has('inventory_movements'))
  assert(after.tables.has('sku_attribute_suggestions'))

  assert.equal(
    pool.queries.some((sql) =>
      sql.startsWith('alter table if exists skus add column if not exists category_name text')
    ),
    true
  )
  assert.equal(
    pool.queries.some((sql) =>
      sql.includes('alter table if exists orders add column if not exists delivery_channel text')
    ),
    true
  )
  assert.equal(
    pool.queries.some((sql) => sql.includes('create table if not exists inventory_movements')),
    true
  )
  assert.equal(
    pool.queries.some((sql) => sql.includes('create table if not exists sku_attribute_suggestions')),
    true
  )

  assert.equal(pool.state.repairRan, false)
  assert.equal(pool.state.droppedLegacyIndexes, false)
  assert.equal(pool.state.currentIndexesCreated, true)
  assert.deepEqual(pool.state.state.currentIndexNames.sort(), [
    'product_images_active_primary_uidx',
    'product_images_active_sku_sort_uidx',
    'product_images_status_idx',
  ])

  pool.queries.length = 0

  await runInitDb(pool, SCHEMA_SQL)

  assert.equal(pool.state.repairRan, false)
  assert.equal(
    pool.queries.some((sql) => sql.includes('alter table if exists skus add column if not exists category_name text')),
    false
  )
  assert.equal(
    pool.queries.some((sql) => sql.includes('create table if not exists inventory_movements')),
    false
  )
  assert.equal(pool.queries.some((sql) => sql.includes('group by sku_id, sort_order')), false)
  assert.equal(pool.queries.some((sql) => sql.includes('group by sku_id') && sql.includes('is_primary')), false)
  assert.equal(
    pool.queries.some((sql) => sql.startsWith('alter table if exists product_images alter column')),
    false
  )
  assert.equal(
    pool.queries.some((sql) => sql.startsWith('alter table if exists product_images add constraint')),
    false
  )
  assert.equal(pool.queries.some((sql) => sql.startsWith('with legacy_rows as (')), false)
  assert.equal(
    pool.queries.some((sql) => sql.startsWith('create unique index if not exists product_images_active_sku_sort_uidx')),
    false
  )
  assert.equal(
    pool.queries.some((sql) => sql.startsWith('create unique index if not exists product_images_active_primary_uidx')),
    false
  )
  assert.equal(
    pool.queries.some((sql) => sql.startsWith('create index if not exists product_images_status_idx')),
    false
  )
})

test('runInitDb backfills legacy sku fields once and skips repeat backfill on second boot', async () => {
  const pool = makePool({
    legacyIndexNames: [],
    currentIndexNames: [],
    currentIndexDefinitions: {},
    hasRows: false,
    hasCanonicalDrift: false,
    hasPgcryptoExtension: false,
    tableCount: 0,
    skuRows: [
      {
        sku_id: 'sku-legacy-1',
        category: 'hardware',
        spec: 'xl',
        category_name: null,
        variant_name: null,
      },
    ],
  })

  const beforeColumns = await readCommerceFoundationSchema(pool)
  assert.equal(beforeColumns.columns.has('category_name'), false)
  assert.equal(beforeColumns.columns.has('variant_name'), false)

  const beforeRows = await readLegacySkuRows(pool)
  assert.deepEqual(beforeRows, [
    {
      sku_id: 'sku-legacy-1',
      category: 'hardware',
      spec: 'xl',
    },
  ])

  await runInitDb(pool, SCHEMA_SQL)

  const afterColumns = await readCommerceFoundationSchema(pool)
  assert.equal(afterColumns.columns.has('category_name'), true)
  assert.equal(afterColumns.columns.has('variant_name'), true)

  const afterRows = await readBackfilledSkuRows(pool)
  assert.deepEqual(afterRows, [
    {
      sku_id: 'sku-legacy-1',
      category_name: 'hardware',
      variant_name: 'xl',
    },
  ])
  assert.equal(
    pool.queries.some((sql) =>
      sql.startsWith('update skus set category_name = coalesce(category_name, category)')
    ),
    true
  )

  pool.queries.length = 0

  await runInitDb(pool, SCHEMA_SQL)

  const secondRunRows = await readBackfilledSkuRows(pool)
  assert.deepEqual(secondRunRows, afterRows)
  assert.equal(
    pool.queries.some((sql) =>
      sql.startsWith('update skus set category_name = coalesce(category_name, category)')
    ),
    false
  )
})

test('runInitDb leaves empty legacy sku fields empty and does not backfill them again', async () => {
  const pool = makePool({
    legacyIndexNames: [],
    currentIndexNames: [],
    currentIndexDefinitions: {},
    hasRows: false,
    hasCanonicalDrift: false,
    hasPgcryptoExtension: false,
    tableCount: 0,
    skuRows: [
      {
        sku_id: 'sku-empty-1',
        category: null,
        spec: null,
        category_name: null,
        variant_name: null,
      },
    ],
  })

  await runInitDb(pool, SCHEMA_SQL)

  assert.deepEqual(await readBackfilledSkuRows(pool), [
    {
      sku_id: 'sku-empty-1',
      category_name: null,
      variant_name: null,
    },
  ])
  assert.equal(
    pool.queries.some((sql) =>
      sql.startsWith('update skus set category_name = coalesce(category_name, category)')
    ),
    false
  )

  pool.queries.length = 0

  await runInitDb(pool, SCHEMA_SQL)

  assert.deepEqual(await readBackfilledSkuRows(pool), [
    {
      sku_id: 'sku-empty-1',
      category_name: null,
      variant_name: null,
    },
  ])
  assert.equal(
    pool.queries.some((sql) =>
      sql.startsWith('update skus set category_name = coalesce(category_name, category)')
    ),
    false
  )
})

test('runInitDb repairs legacy product image indexes and duplicate rows', async () => {
  const pool = makePool({
    legacyIndexNames: ['product_images_sku_sort_idx', 'product_images_primary_idx'],
    currentIndexNames: [],
    currentIndexDefinitions: {},
    hasRows: true,
    hasCanonicalDrift: true,
    hasPgcryptoExtension: false,
    tableCount: 0,
  })

  await runInitDb(pool, SCHEMA_SQL)

  assert.equal(pool.state.repairRan, true)
  assert.equal(pool.state.droppedLegacyIndexes, true)
  assert.equal(pool.state.currentIndexesCreated, true)
})

test('runInitDb repairs inconsistent rows even without legacy index names', async () => {
  const pool = makePool({
    legacyIndexNames: [],
    currentIndexNames: [],
    currentIndexDefinitions: {},
    hasRows: true,
    hasCanonicalDrift: true,
    hasPgcryptoExtension: false,
    tableCount: 0,
  })

  await runInitDb(pool, SCHEMA_SQL)

  assert.equal(pool.state.repairRan, true)
  assert.equal(pool.state.droppedLegacyIndexes, false)
  assert.equal(pool.state.currentIndexesCreated, true)
  assert.equal(
    pool.queries.some((sql) => sql.includes('distinct_sort_count') && sql.includes('primary_count')),
    true
  )
})
