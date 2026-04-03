import test from 'node:test'
import assert from 'node:assert/strict'

import {
  collectInventoryLockSkuIds,
  computeInventoryDelta,
  ensureInventoryAvailable,
  normalizeInventoryItems,
} from './ledger.js'

test('normalizeInventoryItems keeps only sku-linked positive quantity lines', () => {
  assert.deepEqual(
    normalizeInventoryItems([
      { sku_id: '11111111-1111-1111-1111-111111111111', qty: 2, name: 'Alpha' },
      {
        sku_id: '11111111-1111-1111-1111-111111111111',
        qty: '3',
        name: 'Alpha Duplicate',
      },
      { sku_id: null, qty: 9, name: 'Free Text' },
    ]),
    [
      { skuId: '11111111-1111-1111-1111-111111111111', quantity: 2 },
      { skuId: '11111111-1111-1111-1111-111111111111', quantity: 3 },
    ]
  )
})

test('computeInventoryDelta aggregates sku-level deductions and rollbacks', () => {
  const beforeItems = normalizeInventoryItems([
    { sku_id: '11111111-1111-1111-1111-111111111111', qty: 1, name: 'Alpha Before' },
    { sku_id: '22222222-2222-2222-2222-222222222222', qty: 2, name: 'Beta Before' },
  ])
  const afterItems = normalizeInventoryItems([
    { sku_id: '11111111-1111-1111-1111-111111111111', qty: 3, name: 'Alpha After' },
    { sku_id: '22222222-2222-2222-2222-222222222222', qty: 1, name: 'Beta After' },
    { sku_id: null, qty: 5, name: 'Ignore Free Text' },
  ])

  assert.deepEqual(computeInventoryDelta(beforeItems, afterItems), [
    { skuId: '11111111-1111-1111-1111-111111111111', delta: -2 },
    { skuId: '22222222-2222-2222-2222-222222222222', delta: 1 },
  ])
})

test('collectInventoryLockSkuIds returns a stable sorted union for old and new sku lines', () => {
  const beforeItems = normalizeInventoryItems([
    { sku_id: '22222222-2222-2222-2222-222222222222', qty: 1 },
    { sku_id: '11111111-1111-1111-1111-111111111111', qty: 2 },
  ])
  const afterItems = normalizeInventoryItems([
    { sku_id: '11111111-1111-1111-1111-111111111111', qty: 1 },
    { sku_id: '33333333-3333-3333-3333-333333333333', qty: 4 },
  ])

  assert.deepEqual(collectInventoryLockSkuIds(beforeItems, afterItems), [
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333',
  ])
})

test('normalizeInventoryItems rejects malformed sku identifiers', () => {
  assert.throws(
    () => normalizeInventoryItems([{ sku_id: 'not-a-uuid', qty: 1, name: 'Broken' }]),
    /sku/i
  )
})

test('normalizeInventoryItems rejects invalid quantities for sku-linked lines', () => {
  assert.throws(
    () =>
      normalizeInventoryItems([
        {
          sku_id: '11111111-1111-1111-1111-111111111111',
          qty: 'oops',
          name: 'Broken Qty',
        },
      ]),
    /quantity/i
  )
})

test('ensureInventoryAvailable rejects negative inventory snapshots', () => {
  assert.throws(() =>
    ensureInventoryAvailable([{ skuId: 'sku-a', nextQuantity: -1 }])
  )
})
