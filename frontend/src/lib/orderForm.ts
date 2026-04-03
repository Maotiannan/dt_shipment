export type BizOrderType = 'wholesale' | 'retail'
export type ShipStatus = 'pending' | 'shipped_private' | 'shipped_uploaded'
export type TrackingMethod = 'private_chat' | 'platform_upload'
export type AbnormalType = 'resend' | 'address_error' | 'reject' | 'other'
export type SettlementStatus = 'unpaid' | 'partial_paid' | 'settled'

export type OrderItem = {
  sku_id: string | null
  inventory_id: string | null
  name: string
  qty: number
  unit_price: number
}

export type FishOrder = {
  order_id: string
  account_id: string
  order_type: BizOrderType
  buyer_name: string
  shipping_address: string
  items: OrderItem[] | unknown
  total_amount: number
  ship_status: ShipStatus
  tracking_number: string | null
  tracking_method: TrackingMethod | null
  is_abnormal: boolean
  abnormal_type: AbnormalType | null
  remark: string | null
  settlement_status: SettlementStatus | null
  paid_amount: number
  paid_at: string | null
  paid_remark: string | null
  created_at: string
  shipped_at: string | null
}

export type OrderFormState = {
  orderId: string
  accountId: string | null
  orderType: BizOrderType
  buyerName: string
  address: string
  items: OrderItem[]
  shipStatus: ShipStatus
  trackingNumber: string
  trackingMethod: TrackingMethod
  isAbnormal: boolean
  abnormalType: AbnormalType
  remark: string
  settlementStatus: SettlementStatus | null
  paidAmount: number
  paidAt: string | null
  paidRemark: string
  shippedAt: string | null
}

function toFiniteNumber(value: unknown, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function createEmptyOrderItem(): OrderItem {
  return {
    sku_id: null,
    inventory_id: null,
    name: '',
    qty: 1,
    unit_price: 0,
  }
}

export function normalizeOrderItems(items: FishOrder['items']): OrderItem[] {
  if (!Array.isArray(items)) {
    return [createEmptyOrderItem()]
  }

  const normalized = items
    .map((item) => {
      const row = item as Partial<OrderItem> & { sku_code?: string | null }
      return {
        sku_id: row.sku_id ?? null,
        inventory_id: row.inventory_id ?? null,
        name: String(row.name ?? row.sku_code ?? ''),
        qty: toFiniteNumber(row.qty, 1),
        unit_price: toFiniteNumber(row.unit_price, 0),
      }
    })
    .filter((item) => item.name.trim())

  return normalized.length ? normalized : [createEmptyOrderItem()]
}

export function computeOrderTotal(items: OrderItem[]) {
  return items.reduce((sum, item) => {
    return sum + toFiniteNumber(item.qty, 0) * toFiniteNumber(item.unit_price, 0)
  }, 0)
}

export function createEmptyOrderForm(): OrderFormState {
  return {
    orderId: '',
    accountId: null,
    orderType: 'wholesale',
    buyerName: '',
    address: '',
    items: [createEmptyOrderItem()],
    shipStatus: 'pending',
    trackingNumber: '',
    trackingMethod: 'private_chat',
    isAbnormal: false,
    abnormalType: 'resend',
    remark: '',
    settlementStatus: 'unpaid',
    paidAmount: 0,
    paidAt: null,
    paidRemark: '',
    shippedAt: null,
  }
}

export function createOrderFormFromOrder(order: FishOrder): OrderFormState {
  return {
    orderId: order.order_id,
    accountId: order.account_id,
    orderType: order.order_type,
    buyerName: order.buyer_name,
    address: order.shipping_address,
    items: normalizeOrderItems(order.items),
    shipStatus: order.ship_status,
    trackingNumber: order.tracking_number ?? '',
    trackingMethod: order.tracking_method ?? 'private_chat',
    isAbnormal: order.is_abnormal,
    abnormalType: order.abnormal_type ?? 'resend',
    remark: order.remark ?? '',
    settlementStatus: order.settlement_status ?? (order.order_type === 'wholesale' ? 'unpaid' : null),
    paidAmount: toFiniteNumber(order.paid_amount, 0),
    paidAt: order.paid_at ?? null,
    paidRemark: order.paid_remark ?? '',
    shippedAt: order.shipped_at ?? null,
  }
}

export function buildOrderPayload(form: OrderFormState) {
  const normalizedItems = form.items
    .map((item) => ({
      sku_id: item.sku_id ?? null,
      inventory_id: item.inventory_id ?? null,
      name: item.name.trim(),
      qty: toFiniteNumber(item.qty, 1),
      unit_price: toFiniteNumber(item.unit_price, 0),
    }))
    .filter((item) => item.name)

  const isWholesale = form.orderType === 'wholesale'
  const isShipped = form.shipStatus !== 'pending'
  const trimmedTrackingNumber = form.trackingNumber.trim()
  const trimmedRemark = form.remark.trim()
  const trimmedPaidRemark = form.paidRemark.trim()

  return {
    order_id: form.orderId.trim(),
    account_id: form.accountId,
    order_type: form.orderType,
    buyer_name: form.buyerName.trim(),
    shipping_address: form.address.trim(),
    items: normalizedItems,
    total_amount: computeOrderTotal(normalizedItems),
    ship_status: form.shipStatus,
    tracking_number: isShipped && trimmedTrackingNumber ? trimmedTrackingNumber : null,
    tracking_method: isShipped ? form.trackingMethod : null,
    is_abnormal: form.isAbnormal,
    abnormal_type: form.isAbnormal ? form.abnormalType : null,
    remark: form.isAbnormal && trimmedRemark ? trimmedRemark : null,
    settlement_status: isWholesale ? form.settlementStatus ?? 'unpaid' : null,
    paid_amount: isWholesale ? toFiniteNumber(form.paidAmount, 0) : 0,
    paid_at: isWholesale ? form.paidAt : null,
    paid_remark: isWholesale && trimmedPaidRemark ? trimmedPaidRemark : null,
    shipped_at: isShipped ? form.shippedAt : null,
  }
}
