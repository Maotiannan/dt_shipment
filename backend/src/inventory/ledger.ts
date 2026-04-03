import type { PoolClient } from 'pg'

export type InventoryLine = {
  skuId: string
  quantity: number
}

export type InventoryDelta = {
  skuId: string
  delta: number
}

export type InventoryAvailability = {
  skuId: string
  nextQuantity: number
}

export type InventoryMovementReason =
  | 'order_create'
  | 'order_update_revert'
  | 'order_update_apply'
  | 'order_delete_revert'
  | 'manual_adjustment'

type InventoryQueryClient = Pick<PoolClient, 'query'>

export class InventoryLedgerError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message)
  }
}

function toFiniteNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return null
}

export function normalizeInventoryItems(items: unknown): InventoryLine[] {
  if (!Array.isArray(items)) {
    return []
  }

  return items.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return []
    }

    const skuId =
      typeof item.sku_id === 'string' && item.sku_id.trim().length > 0
        ? item.sku_id.trim()
        : null
    const quantity = toFiniteNumber(item.qty)

    if (!skuId || quantity === null || quantity <= 0) {
      return []
    }

    return [{ skuId, quantity }]
  })
}

export function computeInventoryDelta(before: InventoryLine[], after: InventoryLine[]) {
  const totals = new Map<string, number>()

  for (const item of before) {
    totals.set(item.skuId, (totals.get(item.skuId) ?? 0) + item.quantity)
  }

  for (const item of after) {
    totals.set(item.skuId, (totals.get(item.skuId) ?? 0) - item.quantity)
  }

  return Array.from(totals.entries())
    .filter(([, delta]) => delta !== 0)
    .map(([skuId, delta]) => ({ skuId, delta }))
}

export function ensureInventoryAvailable(items: InventoryAvailability[]) {
  const insufficient = items.find((item) => item.nextQuantity < 0)

  if (insufficient) {
    throw new InventoryLedgerError(
      `inventory insufficient for sku ${insufficient.skuId}`,
      409
    )
  }
}

export async function applyInventoryMovementTx(params: {
  client: InventoryQueryClient
  orderId?: string | null
  beforeItems?: InventoryLine[]
  afterItems?: InventoryLine[]
  reason: InventoryMovementReason
  remark?: string | null
}) {
  const delta = computeInventoryDelta(params.beforeItems ?? [], params.afterItems ?? [])

  if (delta.length === 0) {
    return []
  }

  const skuIds = delta.map((item) => item.skuId)
  const { rows } = await params.client.query<{
    sku_id: string
    inventory_quantity: number | null
  }>(
    `select sku_id, inventory_quantity
     from skus
     where sku_id = any($1::uuid[])
     for update`,
    [skuIds]
  )

  const inventoryBySkuId = new Map(
    rows.map((row) => [row.sku_id, Number(row.inventory_quantity ?? 0)] as const)
  )

  const missingSkuId = skuIds.find((skuId) => !inventoryBySkuId.has(skuId))
  if (missingSkuId) {
    throw new InventoryLedgerError(`sku not found: ${missingSkuId}`, 404)
  }

  const nextInventory = delta.map(({ skuId, delta: movement }) => ({
    skuId,
    nextQuantity: (inventoryBySkuId.get(skuId) ?? 0) + movement,
  }))

  ensureInventoryAvailable(nextInventory)

  for (const movement of delta) {
    await params.client.query(
      `insert into inventory_movements(sku_id, order_id, delta_quantity, reason, remark)
       values ($1, $2, $3, $4, $5)`,
      [
        movement.skuId,
        params.orderId ?? null,
        movement.delta,
        params.reason,
        params.remark ?? null,
      ]
    )

    await params.client.query(
      `update skus
       set inventory_quantity = coalesce(inventory_quantity, 0) + $1
       where sku_id = $2`,
      [movement.delta, movement.skuId]
    )
  }

  return nextInventory
}
