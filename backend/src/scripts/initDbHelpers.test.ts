import test from 'node:test'
import assert from 'node:assert/strict'
import {
  needsLegacyProductImageRepair,
  needsProductImageRepair,
} from './initDbHelpers.js'

test('needsLegacyProductImageRepair only triggers for legacy product image indexes', () => {
  assert.equal(needsLegacyProductImageRepair([]), false)
  assert.equal(needsLegacyProductImageRepair(['orders_created_idx']), false)
  assert.equal(needsLegacyProductImageRepair(['product_images_sku_sort_idx']), true)
  assert.equal(needsLegacyProductImageRepair(['product_images_primary_idx']), true)
})

test('needsProductImageRepair triggers for legacy indexes or integrity violations', () => {
  assert.equal(
    needsProductImageRepair({
      hasLegacyIndexes: false,
      hasDuplicateActiveSortOrders: false,
      hasDuplicateActivePrimaries: false,
    }),
    false
  )

  assert.equal(
    needsProductImageRepair({
      hasLegacyIndexes: true,
      hasDuplicateActiveSortOrders: false,
      hasDuplicateActivePrimaries: false,
    }),
    true
  )

  assert.equal(
    needsProductImageRepair({
      hasLegacyIndexes: false,
      hasDuplicateActiveSortOrders: true,
      hasDuplicateActivePrimaries: false,
    }),
    true
  )
})
