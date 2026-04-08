import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildDashboardSummary,
  type DashboardAccount,
  type DashboardOrder,
} from './dashboardSummary'

test('buildDashboardSummary counts shipped orders by delivery channel and includes all outstanding receivables', () => {
  const accounts: DashboardAccount[] = [
    {
      account_id: 'acc-1',
      account_name: '主账号',
      biz_type: 'mixed',
    },
  ]

  const orders: DashboardOrder[] = [
    {
      account_id: 'acc-1',
      order_type: 'retail',
      ship_status: 'pending',
      delivery_channel: null,
      is_abnormal: false,
      total_amount: 100,
      paid_amount: 0,
      settlement_status: null,
      created_at: '2026-04-08T00:00:00.000Z',
    },
    {
      account_id: 'acc-1',
      order_type: 'wholesale',
      ship_status: 'shipped',
      delivery_channel: 'private_chat',
      is_abnormal: true,
      total_amount: 200,
      paid_amount: 60,
      settlement_status: 'partial_paid',
      created_at: '2026-04-08T00:00:00.000Z',
    },
    {
      account_id: 'acc-1',
      order_type: 'retail',
      ship_status: 'shipped',
      delivery_channel: 'platform_upload',
      is_abnormal: false,
      total_amount: 88,
      paid_amount: 88,
      settlement_status: null,
      created_at: '2026-04-08T00:00:00.000Z',
    },
  ]

  const result = buildDashboardSummary(accounts, orders)

  assert.equal(result.abnormalCount, 1)
  assert.equal(result.dueAmount, 240)
  assert.equal(result.accountStats.length, 1)
  const account = result.accountStats[0]
  assert.ok(account)
  assert.equal(account.pendingCount, 1)
  assert.equal(account.shippedCount, 2)
  assert.equal(account.shippedPrivateCount, 1)
  assert.equal(account.shippedUploadedCount, 1)
  assert.equal(account.unpaidCount, 1)
  assert.equal(account.partialPaidCount, 1)
  assert.equal(account.settledCount, 1)
  assert.equal(account.dueAmount, 240)
})
