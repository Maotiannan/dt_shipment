import assert from 'node:assert/strict'
import test from 'node:test'

import { removeItemById, upsertItemById } from './collectionState'

test('upsertItemById inserts new rows using the provided ordering', () => {
  const rows = [
    { account_id: 'older', account_name: 'Older', created_at: '2026-04-01T00:00:00.000Z' },
  ]

  const next = upsertItemById(
    rows,
    { account_id: 'newer', account_name: 'Newer', created_at: '2026-04-02T00:00:00.000Z' },
    (row) => row.account_id,
    (left, right) => right.created_at.localeCompare(left.created_at)
  )

  assert.deepEqual(
    next.map((row) => row.account_id),
    ['newer', 'older']
  )
})

test('upsertItemById replaces an existing row without duplicating it', () => {
  const rows = [
    { sku_id: 'sku-1', name: 'Old', created_at: '2026-04-01T00:00:00.000Z' },
    { sku_id: 'sku-2', name: 'Keep', created_at: '2026-04-01T00:00:00.000Z' },
  ]

  const next = upsertItemById(
    rows,
    { sku_id: 'sku-1', name: 'Updated', created_at: '2026-04-01T00:00:00.000Z' },
    (row) => row.sku_id
  )

  assert.deepEqual(next, [
    { sku_id: 'sku-1', name: 'Updated', created_at: '2026-04-01T00:00:00.000Z' },
    { sku_id: 'sku-2', name: 'Keep', created_at: '2026-04-01T00:00:00.000Z' },
  ])
})

test('removeItemById removes the matching row and preserves the others', () => {
  const rows = [
    { sku_id: 'sku-1', name: 'A' },
    { sku_id: 'sku-2', name: 'B' },
  ]

  const next = removeItemById(rows, 'sku-1', (row) => row.sku_id)

  assert.deepEqual(next, [{ sku_id: 'sku-2', name: 'B' }])
})
