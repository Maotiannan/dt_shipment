import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildSkuPayload,
  createEmptySkuForm,
  createSkuFormFromSku,
  matchesSkuQuery,
} from './skuForm'

test('createEmptySkuForm seeds structured sku fields and inventory defaults', () => {
  const form = createEmptySkuForm()

  assert.equal(form.categoryName, '')
  assert.equal(form.colorName, '')
  assert.equal(form.variantName, '')
  assert.equal(form.inventoryQuantity, '0')
  assert.equal(form.status, 'active')
})

test('createSkuFormFromSku maps structured sku detail into editable form state', () => {
  const form = createSkuFormFromSku({
    sku_id: 'sku-1',
    sku_code: 'SKU-001',
    name: '云朵上衣',
    category_name: '上衣',
    color_name: '白色',
    variant_name: 'XL',
    unit_price: 88,
    inventory_quantity: 6,
    status: 'inactive',
    created_at: '2026-04-08T00:00:00.000Z',
  })

  assert.equal(form.skuCode, 'SKU-001')
  assert.equal(form.categoryName, '上衣')
  assert.equal(form.colorName, '白色')
  assert.equal(form.variantName, 'XL')
  assert.equal(form.inventoryQuantity, '6')
  assert.equal(form.status, 'inactive')
})

test('buildSkuPayload normalizes structured fields and inventory quantity', () => {
  const payload = buildSkuPayload({
    skuCode: ' SKU-002 ',
    name: ' 轻羽外套 ',
    categoryName: ' 外套 ',
    colorName: ' 黑色 ',
    variantName: ' L ',
    unitPrice: '129.5',
    inventoryQuantity: '12',
    status: 'active',
  })

  assert.deepEqual(payload, {
    sku_code: 'SKU-002',
    name: '轻羽外套',
    category_name: '外套',
    color_name: '黑色',
    variant_name: 'L',
    unit_price: 129.5,
    inventory_quantity: 12,
    status: 'active',
  })
})

test('matchesSkuQuery searches sku code, name, category, color, and variant fields', () => {
  const sku = {
    sku_id: 'sku-2',
    sku_code: 'SKU-CLOUD',
    name: '云朵上衣',
    category_name: '上衣',
    color_name: '白色',
    variant_name: 'XL',
    unit_price: 88,
    inventory_quantity: 6,
    status: 'active' as const,
    created_at: '2026-04-08T00:00:00.000Z',
    primary_image_thumb_url: null,
  }

  assert.equal(matchesSkuQuery(sku, 'cloud'), true)
  assert.equal(matchesSkuQuery(sku, '白色'), true)
  assert.equal(matchesSkuQuery(sku, 'xl'), true)
  assert.equal(matchesSkuQuery(sku, '裤子'), false)
})
