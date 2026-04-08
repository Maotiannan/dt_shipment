import type { Pool } from 'pg'

import {
  applyInventoryMovementTx,
  computeInventoryDelta,
  InventoryLedgerError,
  lockInventoryStateForOrderChangeTx,
  normalizeInventoryItems,
} from '../inventory/ledger.js'
import type { ImportPreviewResult, ImportPreviewRow } from './types.js'

type AccountRow = {
  account_id: string
  account_name: string
}

type ExistingOrder = {
  order_id: string
  items: unknown
}

type ExistingSku = {
  sku_id: string
  sku_code: string
  name: string
  inventory_quantity: number | null
}

export type OrderImportItem = {
  sku_id: string | null
  inventory_id: null
  name: string
  qty: number
  unit_price: number
}

export type OrderImportData = {
  order_id: string
  account_id: string | null
  account_name: string
  order_type: 'wholesale' | 'retail'
  buyer_name: string
  shipping_address: string
  sku_code: string | null
  sku_name: string
  qty: number
  unit_price: number
  items: OrderImportItem[]
  total_amount: number
  ship_status: 'pending'
  tracking_number: null
  delivery_channel: null
  tracking_method: null
  is_abnormal: boolean
  abnormal_type: 'resend' | 'address_error' | 'reject' | 'other' | null
  remark: string | null
  settlement_status: 'unpaid' | null
  paid_amount: number
  paid_at: null
  paid_remark: null
  shipped_at: null
}

type InternalOrderImportRow = ImportPreviewRow<OrderImportData> & {
  existing_order_id: string | null
}

function normalizeOptionalText(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized ? normalized : null
}

function normalizeRequiredText(value: unknown) {
  return normalizeOptionalText(value) ?? ''
}

function parsePositiveInteger(value: unknown, label: string) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InventoryLedgerError(`${label} must be a positive integer`, 400)
  }

  return Number(parsed)
}

function parseNonNegativeNumber(value: unknown, label: string) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new InventoryLedgerError(`${label} must be a non-negative number`, 400)
  }

  return Number(parsed)
}

function parseBoolean(value: unknown) {
  const normalized = String(value ?? '').trim().toLowerCase()
  return ['true', '1', 'yes', 'y', '是'].includes(normalized)
}

function normalizeOrderType(value: unknown) {
  return String(value ?? '').trim() === 'retail' ? 'retail' : 'wholesale'
}

function normalizeAbnormalType(value: unknown) {
  const normalized = String(value ?? '').trim() as
    | 'resend'
    | 'address_error'
    | 'reject'
    | 'other'
    | ''

  if (normalized === 'resend' || normalized === 'address_error' || normalized === 'reject' || normalized === 'other') {
    return normalized
  }

  return null
}

async function loadAccounts(pool: Pool, accountNames: string[]) {
  if (accountNames.length === 0) {
    return new Map<string, AccountRow>()
  }

  const { rows } = await pool.query<AccountRow>(
    `select account_id, account_name
     from fish_accounts
     where account_name = any($1::text[])`,
    [accountNames]
  )

  return new Map(rows.map((row) => [row.account_name, row] as const))
}

async function loadExistingSkus(pool: Pool, skuCodes: string[]) {
  if (skuCodes.length === 0) {
    return new Map<string, ExistingSku>()
  }

  const { rows } = await pool.query<ExistingSku>(
    `select sku_id, sku_code, name, inventory_quantity
     from skus
     where sku_code = any($1::text[])`,
    [skuCodes]
  )

  return new Map(rows.map((row) => [row.sku_code, row] as const))
}

async function loadExistingOrders(pool: Pool, orderIds: string[]) {
  if (orderIds.length === 0) {
    return new Map<string, ExistingOrder>()
  }

  const { rows } = await pool.query<ExistingOrder>(
    `select order_id, items
     from orders
     where order_id = any($1::text[])`,
    [orderIds]
  )

  return new Map(rows.map((row) => [row.order_id, row] as const))
}

export async function previewOrderImport(
  pool: Pool,
  rawRows: Array<Record<string, unknown>>
): Promise<ImportPreviewResult<OrderImportData> & { rows: InternalOrderImportRow[] }> {
  const normalizedOrderIds = rawRows
    .map((row) => normalizeOptionalText(row.order_id))
    .filter((value): value is string => Boolean(value))
  const duplicateOrderIds = new Set<string>()
  const seenOrderIds = new Set<string>()
  for (const orderId of normalizedOrderIds) {
    if (seenOrderIds.has(orderId)) {
      duplicateOrderIds.add(orderId)
    }
    seenOrderIds.add(orderId)
  }

  const accountNames = rawRows
    .map((row) => normalizeOptionalText(row.account_name))
    .filter((value): value is string => Boolean(value))
  const skuCodes = rawRows
    .map((row) => normalizeOptionalText(row.sku_code))
    .filter((value): value is string => Boolean(value))

  const [accountsByName, skusByCode, existingOrdersById] = await Promise.all([
    loadAccounts(pool, Array.from(new Set(accountNames))),
    loadExistingSkus(pool, Array.from(new Set(skuCodes))),
    loadExistingOrders(pool, Array.from(new Set(normalizedOrderIds))),
  ])

  const rows: InternalOrderImportRow[] = rawRows.map((row, index) => {
    const orderId = normalizeRequiredText(row.order_id)
    const orderType = normalizeOrderType(row.order_type)
    const accountName = normalizeRequiredText(row.account_name)
    const buyerName = normalizeRequiredText(row.buyer_name)
    const shippingAddress = normalizeRequiredText(row.shipping_address)
    const skuCode = normalizeOptionalText(row.sku_code)
    const skuName = normalizeRequiredText(row.sku_name)
    const errors: string[] = []

    let qty = 0
    let unitPrice = 0

    if (!orderId) {
      errors.push('order_id 不能为空')
    }
    if (orderId && duplicateOrderIds.has(orderId)) {
      errors.push('同批次 order_id 重复')
    }
    if (!accountName) {
      errors.push('account_name 不能为空')
    }
    if (!buyerName) {
      errors.push('buyer_name 不能为空')
    }
    if (!shippingAddress) {
      errors.push('shipping_address 不能为空')
    }

    try {
      qty = parsePositiveInteger(row.qty, 'qty')
    } catch (error) {
      errors.push((error as Error).message)
    }

    try {
      unitPrice = parseNonNegativeNumber(row.unit_price, 'unit_price')
    } catch (error) {
      errors.push((error as Error).message)
    }

    const account = accountName ? accountsByName.get(accountName) ?? null : null
    if (!account) {
      errors.push(`account_name「${accountName}」未找到对应闲鱼账号`)
    }

    const sku = skuCode ? skusByCode.get(skuCode) ?? null : null
    if (skuCode && !sku) {
      errors.push(`sku_code「${skuCode}」未找到对应 SKU`)
    }
    if (!skuCode && !skuName) {
      errors.push('sku_name 不能为空')
    }

    const isAbnormal = parseBoolean(row.is_abnormal)
    const abnormalType = isAbnormal ? normalizeAbnormalType(row.abnormal_type) : null
    const abnormalRemark = isAbnormal ? normalizeOptionalText(row.abnormal_remark) : null
    if (isAbnormal && !abnormalType) {
      errors.push('abnormal_type 非法')
    }
    if (isAbnormal && !abnormalRemark) {
      errors.push('abnormal_remark 不能为空')
    }

    const itemName = sku?.name ?? skuName
    const items: OrderImportItem[] =
      qty > 0 && unitPrice >= 0
        ? [
            {
              sku_id: sku?.sku_id ?? null,
              inventory_id: null,
              name: itemName,
              qty,
              unit_price: unitPrice,
            },
          ]
        : []

    const existingOrder = orderId ? existingOrdersById.get(orderId) ?? null : null
    const action = existingOrder ? 'overwrite' : 'create'

    return {
      row_index: index + 1,
      key: orderId || `row-${index + 1}`,
      action,
      status: errors.length ? 'error' : action === 'overwrite' ? 'warning' : 'success',
      errors,
      warnings: action === 'overwrite' && errors.length === 0 ? ['将覆盖现有订单'] : [],
      existing_order_id: existingOrder?.order_id ?? null,
      data: {
        order_id: orderId,
        account_id: account?.account_id ?? null,
        account_name: accountName,
        order_type: orderType,
        buyer_name: buyerName,
        shipping_address: shippingAddress,
        sku_code: skuCode,
        sku_name: itemName,
        qty,
        unit_price: unitPrice,
        items,
        total_amount: Number((qty * unitPrice).toFixed(2)),
        ship_status: 'pending',
        tracking_number: null,
        delivery_channel: null,
        tracking_method: null,
        is_abnormal: isAbnormal,
        abnormal_type: abnormalType,
        remark: isAbnormal ? abnormalRemark : null,
        settlement_status: orderType === 'wholesale' ? 'unpaid' : null,
        paid_amount: 0,
        paid_at: null,
        paid_remark: null,
        shipped_at: null,
      },
    }
  })

  const projectedInventory = new Map<string, number>()
  for (const sku of skusByCode.values()) {
    projectedInventory.set(sku.sku_id, Number(sku.inventory_quantity ?? 0))
  }

  for (const row of rows) {
    if (row.status === 'error') {
      continue
    }

    const beforeItems = row.existing_order_id
      ? normalizeInventoryItems(existingOrdersById.get(row.existing_order_id)?.items ?? [])
      : []
    const afterItems = normalizeInventoryItems(row.data.items)
    const delta = computeInventoryDelta(beforeItems, afterItems)

    let insufficient = false
    for (const movement of delta) {
      const nextQuantity = (projectedInventory.get(movement.skuId) ?? 0) + movement.delta
      if (nextQuantity < 0) {
        row.errors.push(`sku「${row.data.sku_code ?? row.data.sku_name}」库存不足`)
        row.status = 'error'
        insufficient = true
        break
      }
    }

    if (insufficient) {
      continue
    }

    for (const movement of delta) {
      projectedInventory.set(
        movement.skuId,
        (projectedInventory.get(movement.skuId) ?? 0) + movement.delta
      )
    }
  }

  return {
    can_commit: rows.every((row) => row.status !== 'error'),
    rows,
  }
}

export async function commitOrderImport(pool: Pool, rawRows: Array<Record<string, unknown>>) {
  const preview = await previewOrderImport(pool, rawRows)
  const invalidRows = preview.rows.filter((row) => row.status === 'error')
  if (invalidRows.length > 0) {
    throw new InventoryLedgerError('import preview contains blocking errors', 400)
  }

  const client = await pool.connect()
  let createdCount = 0
  let overwrittenCount = 0

  try {
    await client.query('begin')

    for (const row of preview.rows) {
      const payload = row.data
      if (!payload.account_id) {
        throw new InventoryLedgerError(`account_id missing for order ${payload.order_id}`, 400)
      }

      if (row.action === 'overwrite' && row.existing_order_id) {
        const existingOrder = await client.query<{ items: unknown }>(
          `select items
           from orders
           where order_id = $1
           limit 1
           for update`,
          [row.existing_order_id]
        )

        if (!existingOrder.rows[0]) {
          throw new InventoryLedgerError(`order not found: ${row.existing_order_id}`, 404)
        }

        const beforeItems = normalizeInventoryItems(existingOrder.rows[0].items)
        const afterItems = normalizeInventoryItems(payload.items)
        const inventoryState = await lockInventoryStateForOrderChangeTx(client, beforeItems, afterItems)

        await applyInventoryMovementTx({
          client,
          orderId: payload.order_id,
          beforeItems,
          afterItems: [],
          inventoryState,
          reason: 'order_update_revert',
        })
        await applyInventoryMovementTx({
          client,
          orderId: payload.order_id,
          beforeItems: [],
          afterItems,
          inventoryState,
          reason: 'order_update_apply',
        })

        await client.query(
          `update orders
           set account_id=$1,
               order_type=$2,
               buyer_name=$3,
               shipping_address=$4,
               items=$5::jsonb,
               total_amount=$6,
               ship_status=$7,
               delivery_channel=$8,
               tracking_number=$9,
               tracking_method=$10,
               is_abnormal=$11,
               abnormal_type=$12,
               remark=$13,
               settlement_status=$14,
               paid_amount=$15,
               paid_at=$16,
               paid_remark=$17,
               shipped_at=$18
           where order_id=$19`,
          [
            payload.account_id,
            payload.order_type,
            payload.buyer_name,
            payload.shipping_address,
            JSON.stringify(payload.items),
            payload.total_amount,
            payload.ship_status,
            payload.delivery_channel,
            payload.tracking_number,
            payload.tracking_method,
            payload.is_abnormal,
            payload.abnormal_type,
            payload.remark,
            payload.settlement_status,
            payload.paid_amount,
            payload.paid_at,
            payload.paid_remark,
            payload.shipped_at,
            payload.order_id,
          ]
        )

        overwrittenCount += 1
        continue
      }

      await applyInventoryMovementTx({
        client,
        orderId: payload.order_id,
        beforeItems: [],
        afterItems: normalizeInventoryItems(payload.items),
        reason: 'order_create',
      })

      await client.query(
        `insert into orders(
          order_id,account_id,order_type,buyer_name,shipping_address,items,total_amount,
          ship_status,delivery_channel,tracking_number,tracking_method,is_abnormal,abnormal_type,remark,
          settlement_status,paid_amount,paid_at,paid_remark,shipped_at
        ) values (
          $1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
        )`,
        [
          payload.order_id,
          payload.account_id,
          payload.order_type,
          payload.buyer_name,
          payload.shipping_address,
          JSON.stringify(payload.items),
          payload.total_amount,
          payload.ship_status,
          payload.delivery_channel,
          payload.tracking_number,
          payload.tracking_method,
          payload.is_abnormal,
          payload.abnormal_type,
          payload.remark,
          payload.settlement_status,
          payload.paid_amount,
          payload.paid_at,
          payload.paid_remark,
          payload.shipped_at,
        ]
      )

      createdCount += 1
    }

    await client.query('commit')
    return {
      ok: true,
      created_count: createdCount,
      overwritten_count: overwrittenCount,
    }
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}
