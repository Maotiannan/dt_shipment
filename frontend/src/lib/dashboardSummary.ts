export type DashboardAccount = {
  account_id: string
  account_name: string
  biz_type: 'wholesale' | 'retail' | 'mixed'
}

export type DashboardOrder = {
  account_id: string
  order_type: string | null
  ship_status: string | null
  delivery_channel: string | null
  is_abnormal: boolean
  total_amount: number | string | null
  paid_amount: number | string | null
  settlement_status: string | null
  created_at: string
}

export type DashboardAccountStat = DashboardAccount & {
  wholesaleCount: number
  retailCount: number
  pendingCount: number
  shippedCount: number
  shippedPrivateCount: number
  shippedUploadedCount: number
  abnormalCount: number
  unpaidCount: number
  partialPaidCount: number
  settledCount: number
  dueAmount: number
}

export type DashboardSummary = {
  abnormalCount: number
  dueAmount: number
  accountStats: DashboardAccountStat[]
}

function toAmount(value: number | string | null | undefined) {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function getDueAmount(order: DashboardOrder) {
  return Math.max(0, toAmount(order.total_amount) - toAmount(order.paid_amount))
}

function getSettlementBucket(order: DashboardOrder) {
  const dueAmount = getDueAmount(order)
  if (dueAmount <= 0) {
    return 'settled' as const
  }

  return toAmount(order.paid_amount) > 0 ? ('partial_paid' as const) : ('unpaid' as const)
}

export function buildDashboardSummary(
  accounts: DashboardAccount[],
  orders: DashboardOrder[]
): DashboardSummary {
  const map = new Map<string, DashboardAccountStat>()

  for (const account of accounts) {
    map.set(account.account_id, {
      ...account,
      wholesaleCount: 0,
      retailCount: 0,
      pendingCount: 0,
      shippedCount: 0,
      shippedPrivateCount: 0,
      shippedUploadedCount: 0,
      abnormalCount: 0,
      unpaidCount: 0,
      partialPaidCount: 0,
      settledCount: 0,
      dueAmount: 0,
    })
  }

  let abnormalCount = 0
  let dueAmount = 0

  for (const order of orders) {
    const stat = map.get(order.account_id)
    const due = getDueAmount(order)

    if (order.is_abnormal) {
      abnormalCount += 1
    }
    dueAmount += due

    if (!stat) {
      continue
    }

    if (order.order_type === 'wholesale') stat.wholesaleCount += 1
    if (order.order_type === 'retail') stat.retailCount += 1

    if (order.ship_status === 'pending') {
      stat.pendingCount += 1
    } else if (order.ship_status === 'shipped') {
      stat.shippedCount += 1
      if (order.delivery_channel === 'private_chat') {
        stat.shippedPrivateCount += 1
      }
      if (order.delivery_channel === 'platform_upload') {
        stat.shippedUploadedCount += 1
      }
    }

    if (order.is_abnormal) {
      stat.abnormalCount += 1
    }

    const settlementBucket = getSettlementBucket(order)
    if (settlementBucket === 'unpaid') stat.unpaidCount += 1
    if (settlementBucket === 'partial_paid') stat.partialPaidCount += 1
    if (settlementBucket === 'settled') stat.settledCount += 1
    stat.dueAmount += due
  }

  return {
    abnormalCount,
    dueAmount,
    accountStats: Array.from(map.values()).sort((left, right) => right.dueAmount - left.dueAmount),
  }
}
