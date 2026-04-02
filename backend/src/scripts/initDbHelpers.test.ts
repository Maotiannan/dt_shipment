import test from 'node:test'
import assert from 'node:assert/strict'
import { needsLegacyProductImageRepair } from './initDbHelpers.js'

test('needsLegacyProductImageRepair only triggers for legacy product image indexes', () => {
  assert.equal(needsLegacyProductImageRepair([]), false)
  assert.equal(needsLegacyProductImageRepair(['orders_created_idx']), false)
  assert.equal(needsLegacyProductImageRepair(['product_images_sku_sort_idx']), true)
  assert.equal(needsLegacyProductImageRepair(['product_images_primary_idx']), true)
})

