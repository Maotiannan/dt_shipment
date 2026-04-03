import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildOrderPayload,
  computeOrderTotal,
  createEmptyOrderForm,
  createOrderFormFromOrder,
} from './orderForm'

test('createEmptyOrderForm seeds a usable create-order default state', () => {
  const form = createEmptyOrderForm()

  assert.equal(form.orderType, 'wholesale')
  assert.equal(form.shipStatus, 'pending')
  assert.equal(form.items.length, 1)
  assert.equal(form.items[0]?.name, '')
  assert.equal(form.settlementStatus, 'unpaid')
  assert.equal(form.paidAmount, 0)
})

test('createOrderFormFromOrder normalizes persisted order detail for editing', () => {
  const form = createOrderFormFromOrder({
    order_id: 'ORDER-1',
    account_id: 'account-a',
    order_type: 'retail',
    buyer_name: 'Buyer A',
    shipping_address: 'Shanghai',
    items: [
      { sku_id: null, inventory_id: null, name: 'Item A', qty: 2, unit_price: 3.5 },
      { sku_id: null, inventory_id: null, name: 'Item B', qty: 1, unit_price: 9 },
    ],
    total_amount: 16,
    ship_status: 'shipped_uploaded',
    tracking_number: 'YT123',
    tracking_method: 'platform_upload',
    is_abnormal: true,
    abnormal_type: 'other',
    remark: 'check manually',
    settlement_status: null,
    paid_amount: 0,
    paid_at: null,
    paid_remark: null,
    created_at: '2026-04-03T00:00:00.000Z',
    shipped_at: '2026-04-03T02:00:00.000Z',
  })

  assert.equal(form.orderId, 'ORDER-1')
  assert.equal(form.accountId, 'account-a')
  assert.equal(form.orderType, 'retail')
  assert.equal(form.items.length, 2)
  assert.equal(form.items[0]?.name, 'Item A')
  assert.equal(form.trackingMethod, 'platform_upload')
  assert.equal(form.remark, 'check manually')
  assert.equal(form.shippedAt, '2026-04-03T02:00:00.000Z')
})

test('buildOrderPayload computes totals and clears retail-only settlement noise', () => {
  const payload = buildOrderPayload({
    ...createEmptyOrderForm(),
    orderId: 'ORDER-2',
    accountId: 'account-b',
    orderType: 'retail',
    buyerName: 'Buyer B',
    address: 'Hangzhou',
    shipStatus: 'pending',
    isAbnormal: false,
    remark: 'should clear',
    settlementStatus: 'partial_paid',
    paidAmount: 8,
    paidAt: '2026-04-03T01:00:00.000Z',
    paidRemark: 'should clear',
    items: [
      { sku_id: null, inventory_id: null, name: 'Beta', qty: 2, unit_price: 4 },
      { sku_id: null, inventory_id: null, name: 'Gamma', qty: 1, unit_price: 1.5 },
    ],
  })

  assert.equal(payload.total_amount, 9.5)
  assert.equal(payload.remark, null)
  assert.equal(payload.settlement_status, null)
  assert.equal(payload.paid_amount, 0)
  assert.equal(payload.paid_at, null)
  assert.equal(payload.shipped_at, null)
  assert.deepEqual(payload.items, [
    { sku_id: null, inventory_id: null, name: 'Beta', qty: 2, unit_price: 4 },
    { sku_id: null, inventory_id: null, name: 'Gamma', qty: 1, unit_price: 1.5 },
  ])
})

test('computeOrderTotal ignores invalid numeric noise', () => {
  assert.equal(
    computeOrderTotal([
      { sku_id: null, inventory_id: null, name: 'A', qty: 2, unit_price: 5 },
      { sku_id: null, inventory_id: null, name: 'B', qty: Number.NaN, unit_price: 3 },
    ]),
    10
  )
})
