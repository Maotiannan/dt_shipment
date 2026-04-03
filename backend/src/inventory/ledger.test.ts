import test from 'node:test'
import assert from 'node:assert/strict'

import {
  computeInventoryDelta,
  ensureInventoryAvailable,
  normalizeInventoryItems,
} from './ledger.js'

test('normalizeInventoryItems keeps only sku-linked positive quantity lines', () => {
  assert.deepEqual(
    normalizeInventoryItems([
      { sku_id: 'sku-a', qty: 2, name: 'Alpha' },
      { sku_id: 'sku-a', qty: '3', name: 'Alpha Duplicate' },
      { sku_id: 'sku-b', qty: 0, name: 'Zero' },
      { sku_id: null, qty: 9, name: 'Free Text' },
      { sku_id: '   ', qty: 1, name: 'Blank Sku' },
    ]),
    [
      { skuId: 'sku-a', quantity: 2 },
      { skuId: 'sku-a', quantity: 3 },
    ]
  )
})

test('computeInventoryDelta aggregates sku-level deductions and rollbacks', () => {
  const beforeItems = normalizeInventoryItems([
    { sku_id: 'sku-a', qty: 1, name: 'Alpha Before' },
    { sku_id: 'sku-b', qty: 2, name: 'Beta Before' },
  ])
  const afterItems = normalizeInventoryItems([
    { sku_id: 'sku-a', qty: 3, name: 'Alpha After' },
    { sku_id: 'sku-b', qty: 1, name: 'Beta After' },
    { sku_id: null, qty: 5, name: 'Ignore Free Text' },
  ])

  assert.deepEqual(computeInventoryDelta(beforeItems, afterItems), [
    { skuId: 'sku-a', delta: -2 },
    { skuId: 'sku-b', delta: 1 },
  ])
})

test('ensureInventoryAvailable rejects negative inventory snapshots', () => {
  assert.throws(() =>
    ensureInventoryAvailable([{ skuId: 'sku-a', nextQuantity: -1 }])
  )
})
