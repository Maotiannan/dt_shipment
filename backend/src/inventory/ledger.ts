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
type InventoryState = Map<string, number>

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

function ensureValidSkuId(value: unknown) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InventoryLedgerError('sku_id must be a UUID for inventory-managed items', 400)
  }

  const skuId = value.trim()
  if (!UUID_PATTERN.test(skuId)) {
    throw new InventoryLedgerError(`invalid sku_id: ${skuId}`, 400)
  }

  return skuId
}

function ensureValidQuantity(value: unknown, skuId: string) {
  const quantity = toFiniteNumber(value)
  if (quantity === null || !Number.isInteger(quantity) || quantity <= 0) {
    throw new InventoryLedgerError(
      `quantity must be a positive integer for sku ${skuId}`,
      400
    )
  }

  return quantity
}

function ensureNonNegativeInteger(value: unknown, label: string) {
  const quantity = toFiniteNumber(value)
  if (quantity === null || !Number.isInteger(quantity) || quantity < 0) {
    throw new InventoryLedgerError(`${label} must be a non-negative integer`, 400)
  }

  return quantity
}

export function normalizeInventoryItems(items: unknown): InventoryLine[] {
  if (items == null) {
    return []
  }

  if (!Array.isArray(items)) {
    throw new InventoryLedgerError('items must be an array', 400)
  }

  return items.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return []
    }

    const rawItem = item as { sku_id?: unknown; qty?: unknown }
    if (rawItem.sku_id == null) {
      return []
    }

    const skuId = ensureValidSkuId(rawItem.sku_id)
    const quantity = ensureValidQuantity(rawItem.qty, skuId)

    return [{ skuId, quantity }]
  })
}

export function collectInventoryLockSkuIds(before: InventoryLine[], after: InventoryLine[]) {
  return Array.from(new Set([...before.map((item) => item.skuId), ...after.map((item) => item.skuId)])).sort(
    (left, right) => left.localeCompare(right)
  )
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

async function lockInventoryStateTx(client: InventoryQueryClient, skuIds: string[]) {
  if (skuIds.length === 0) {
    return new Map<string, number>()
  }

  const { rows } = await client.query<{
    sku_id: string
    inventory_quantity: number | null
  }>(
    `select sku_id, inventory_quantity
     from skus
     where sku_id = any($1::uuid[])
     order by sku_id asc
     for update`,
    [skuIds]
  )

  return new Map(
    rows.map((row) => [row.sku_id, Number(row.inventory_quantity ?? 0)] as const)
  )
}

export async function applyInventoryMovementTx(params: {
  client: InventoryQueryClient
  orderId?: string | null
  beforeItems?: InventoryLine[]
  afterItems?: InventoryLine[]
  inventoryState?: InventoryState
  reason: InventoryMovementReason
  remark?: string | null
}) {
  const delta = computeInventoryDelta(params.beforeItems ?? [], params.afterItems ?? [])

  if (delta.length === 0) {
    return []
  }

  const skuIds = Array.from(new Set(delta.map((item) => item.skuId))).sort((left, right) =>
    left.localeCompare(right)
  )
  const inventoryBySkuId =
    params.inventoryState ?? (await lockInventoryStateTx(params.client, skuIds))

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
    const nextQuantity = nextInventory.find((item) => item.skuId === movement.skuId)?.nextQuantity

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

    if (typeof nextQuantity === 'number') {
      inventoryBySkuId.set(movement.skuId, nextQuantity)
    }
  }

  return nextInventory
}

export async function lockInventoryStateForOrderChangeTx(
  client: InventoryQueryClient,
  beforeItems: InventoryLine[],
  afterItems: InventoryLine[]
) {
  return lockInventoryStateTx(client, collectInventoryLockSkuIds(beforeItems, afterItems))
}

export async function setSkuInventoryQuantityTx(params: {
  client: InventoryQueryClient
  skuId: string
  nextQuantity: unknown
  reason?: InventoryMovementReason
  remark?: string | null
}) {
  const skuId = ensureValidSkuId(params.skuId)
  const nextQuantity = ensureNonNegativeInteger(params.nextQuantity, 'inventory_quantity')
  const inventoryState = await lockInventoryStateTx(params.client, [skuId])
  const currentQuantity = inventoryState.get(skuId)

  if (typeof currentQuantity !== 'number') {
    throw new InventoryLedgerError(`sku not found: ${skuId}`, 404)
  }

  const delta = nextQuantity - currentQuantity
  if (delta === 0) {
    return nextQuantity
  }

  await params.client.query(
    `insert into inventory_movements(sku_id, order_id, delta_quantity, reason, remark)
     values ($1, null, $2, $3, $4)`,
    [skuId, delta, params.reason ?? 'manual_adjustment', params.remark ?? null]
  )

  await params.client.query(
    `update skus
     set inventory_quantity = $1
     where sku_id = $2`,
    [nextQuantity, skuId]
  )

  return nextQuantity
}
