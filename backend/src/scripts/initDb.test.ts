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
    schemaTables: scenario.schemaTables ?? [
      'fish_accounts',
      'skus',
      'orders',
      'inventory_movements',
      'sku_attribute_suggestions',
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
        'category_name',
        'color_name',
        'variant_name',
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
        'delivery_channel',
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
        state.tableCount = 7
        state.schemaTables = [
          'fish_accounts',
          'skus',
          'orders',
          'inventory_movements',
          'sku_attribute_suggestions',
          'push_subscriptions',
          'product_images',
        ]
        state.schemaColumnsByTable = {
          skus: [
            'sku_id',
            'sku_code',
            'name',
            'spec',
            'unit_price',
            'category',
            'category_name',
            'color_name',
            'variant_name',
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
            'delivery_channel',
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
        }
        return { rows: [] }
      }

      if (normalized.startsWith('alter table if exists skus add column if not exists category_name text')) {
        return { rows: [] }
      }

      if (normalized.startsWith('alter table if exists skus add column if not exists color_name text')) {
        return { rows: [] }
      }

      if (normalized.startsWith('alter table if exists skus add column if not exists variant_name text')) {
        return { rows: [] }
      }

      if (normalized.startsWith('alter table if exists orders add column if not exists delivery_channel text')) {
        return { rows: [] }
      }

      if (normalized.startsWith('create table if not exists inventory_movements')) {
        return { rows: [] }
      }

      if (normalized.startsWith('create table if not exists sku_attribute_suggestions')) {
        return { rows: [] }
      }

      if (
        normalized.startsWith('update skus') &&
        normalized.includes('category_name = coalesce(category_name, category)') &&
        normalized.includes('variant_name = coalesce(variant_name, spec)')
      ) {
        return { rows: [] }
      }

      if (
        normalized.includes('from skus') &&
        normalized.includes('category_name is null') &&
        normalized.includes('variant_name is null') &&
        normalized.includes('needs_backfill')
      ) {
        return { rows: [{ needs_backfill: false }] }
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

  return {
    columns: new Set([
      ...skusColumns.rows.map((row) => String(row.column_name)),
      ...ordersColumns.rows.map((row) => String(row.column_name)),
    ]),
    tables: new Set(tables.rows.map((row) => String(row.table_name))),
  }
}

test('runInitDb skips repair on clean steady-state boot', async () => {
  const pool = makePool({
    legacyIndexNames: [],
    currentIndexNames: [],
    currentIndexDefinitions: {},
    hasRows: false,
    hasCanonicalDrift: false,
    hasPgcryptoExtension: false,
    tableCount: 0,
  })

  await runInitDb(pool, SCHEMA_SQL)

  const { columns, tables } = await readCommerceFoundationSchema(pool)
  assert(columns.has('category_name'))
  assert(columns.has('color_name'))
  assert(columns.has('variant_name'))
  assert(columns.has('delivery_channel'))
  assert(tables.has('inventory_movements'))
  assert(tables.has('sku_attribute_suggestions'))

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
