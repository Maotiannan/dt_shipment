import test from 'node:test'
import assert from 'node:assert/strict'
import { runInitDb } from './initDbRunner.js'

type Scenario = {
  legacyIndexNames: string[]
  currentIndexNames: string[]
  hasRows: boolean
  duplicateActiveSortOrders: boolean
  duplicateActivePrimaries: boolean
}

function makePool(scenario: Scenario) {
  const queries: string[] = []
  let repairRan = false
  let droppedLegacyIndexes = false
  let currentIndexesCreated = false
  const state = {
    legacyIndexNames: [...scenario.legacyIndexNames],
    currentIndexNames: [...scenario.currentIndexNames],
    hasRows: scenario.hasRows,
    duplicateActiveSortOrders: scenario.duplicateActiveSortOrders,
    duplicateActivePrimaries: scenario.duplicateActivePrimaries,
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
        return { rows: [] }
      }

      if (normalized === 'schema-sql') {
        return { rows: [] }
      }

      if (normalized.includes("from pg_indexes") && normalized.includes("product_images_sku_sort_idx")) {
        return { rows: state.legacyIndexNames.map((indexname) => ({ indexname })) }
      }

      if (
        normalized.includes("from pg_indexes") &&
        normalized.includes("product_images_active_sku_sort_uidx")
      ) {
        return { rows: state.currentIndexNames.map((indexname) => ({ indexname })) }
      }

      if (normalized.includes('select exists ( select 1 from product_images limit 1 ) as has_rows')) {
        return { rows: [{ has_rows: state.hasRows }] }
      }

      if (
        normalized.includes('group by sku_id, sort_order') &&
        normalized.includes('having count(*) > 1')
      ) {
        return { rows: [{ has_duplicates: state.duplicateActiveSortOrders }] }
      }

      if (
        normalized.includes('where status = \'active\' and is_primary') &&
        normalized.includes('group by sku_id') &&
        normalized.includes('having count(*) > 1')
      ) {
        return { rows: [{ has_duplicates: state.duplicateActivePrimaries }] }
      }

      if (normalized.startsWith('with normalized_active_images as')) {
        repairRan = true
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
        if (normalized.includes('product_images_active_primary_uidx')) {
          state.currentIndexNames = [
            ...new Set([...state.currentIndexNames, 'product_images_active_primary_uidx']),
          ]
        }
        if (normalized.includes('product_images_status_idx')) {
          state.currentIndexNames = [...new Set([...state.currentIndexNames, 'product_images_status_idx'])]
        }
        return { rows: [] }
      }

      if (normalized.startsWith('create index if not exists product_images_status_idx')) {
        currentIndexesCreated = true
        state.currentIndexNames = [...new Set([...state.currentIndexNames, 'product_images_status_idx'])]
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

test('runInitDb skips repair on clean steady-state boot', async () => {
  const pool = makePool({
    legacyIndexNames: [],
    currentIndexNames: [],
    hasRows: false,
    duplicateActiveSortOrders: false,
    duplicateActivePrimaries: false,
  })

  await runInitDb(pool, SCHEMA_SQL)

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
})

test('runInitDb repairs legacy product image indexes and duplicate rows', async () => {
  const pool = makePool({
    legacyIndexNames: ['product_images_sku_sort_idx', 'product_images_primary_idx'],
    currentIndexNames: [],
    hasRows: true,
    duplicateActiveSortOrders: true,
    duplicateActivePrimaries: true,
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
    hasRows: true,
    duplicateActiveSortOrders: true,
    duplicateActivePrimaries: true,
  })

  await runInitDb(pool, SCHEMA_SQL)

  assert.equal(pool.state.repairRan, true)
  assert.equal(pool.state.droppedLegacyIndexes, false)
  assert.equal(pool.state.currentIndexesCreated, true)
  assert.equal(pool.queries.some((sql) => sql.includes('group by sku_id, sort_order')), true)
})
