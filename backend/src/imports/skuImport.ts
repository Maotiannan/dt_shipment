import type { Pool } from 'pg'

import { InventoryLedgerError, setSkuInventoryQuantityTx } from '../inventory/ledger.js'
import { upsertSkuAttributeSuggestionsTx } from '../skuAttributes/suggestions.js'
import type { ImportPreviewResult, ImportPreviewRow } from './types.js'

export type SkuImportData = {
  sku_code: string
  name: string
  category_name: string | null
  color_name: string | null
  variant_name: string | null
  unit_price: number
  inventory_quantity: number
  status: 'active' | 'inactive'
}

type ExistingSku = {
  sku_id: string
  sku_code: string
}

type InternalSkuImportRow = ImportPreviewRow<SkuImportData> & {
  existing_sku_id: string | null
}

function normalizeOptionalText(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized ? normalized : null
}

function normalizeMoney(value: unknown) {
  if (value == null || value === '') {
    return 0
  }

  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new InventoryLedgerError('unit_price must be a non-negative number', 400)
  }

  return Number(parsed)
}

function normalizeInventoryQuantity(value: unknown) {
  if (value == null || value === '') {
    return 0
  }

  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new InventoryLedgerError('inventory_quantity must be a non-negative integer', 400)
  }

  return Number(parsed)
}

function normalizeStatus(value: unknown) {
  const normalized = String(value ?? 'active').trim().toLowerCase()
  return normalized === 'inactive' ? 'inactive' : 'active'
}

function previewStatus(errors: string[], action: 'create' | 'overwrite') {
  if (errors.length) {
    return 'error' as const
  }

  return action === 'overwrite' ? ('warning' as const) : ('success' as const)
}

async function loadExistingSkus(pool: Pool, skuCodes: string[]) {
  if (skuCodes.length === 0) {
    return new Map<string, ExistingSku>()
  }

  const { rows } = await pool.query<ExistingSku>(
    `select sku_id, sku_code
     from skus
     where sku_code = any($1::text[])`,
    [skuCodes]
  )

  return new Map(rows.map((row) => [row.sku_code, row] as const))
}

export async function previewSkuImport(
  pool: Pool,
  rawRows: Array<Record<string, unknown>>
): Promise<ImportPreviewResult<SkuImportData> & { rows: InternalSkuImportRow[] }> {
  const normalizedCodes = rawRows
    .map((row) => normalizeOptionalText(row.sku_code))
    .filter((value): value is string => Boolean(value))
  const duplicates = new Set<string>()
  const seen = new Set<string>()
  for (const skuCode of normalizedCodes) {
    if (seen.has(skuCode)) {
      duplicates.add(skuCode)
    }
    seen.add(skuCode)
  }

  const existingByCode = await loadExistingSkus(pool, Array.from(new Set(normalizedCodes)))

  const rows: InternalSkuImportRow[] = rawRows.map((row, index) => {
    const skuCode = normalizeOptionalText(row.sku_code) ?? ''
    const name = normalizeOptionalText(row.name) ?? ''
    const categoryName = normalizeOptionalText(row.category_name)
    const colorName = normalizeOptionalText(row.color_name)
    const variantName = normalizeOptionalText(row.variant_name)
    const errors: string[] = []

    let unitPrice = 0
    let inventoryQuantity = 0

    if (!skuCode) {
      errors.push('sku_code 不能为空')
    }
    if (!name) {
      errors.push('name 不能为空')
    }
    if (skuCode && duplicates.has(skuCode)) {
      errors.push('同批次 sku_code 重复')
    }

    try {
      unitPrice = normalizeMoney(row.unit_price)
    } catch (error) {
      errors.push((error as Error).message)
    }

    try {
      inventoryQuantity = normalizeInventoryQuantity(row.inventory_quantity)
    } catch (error) {
      errors.push((error as Error).message)
    }

    const existing = skuCode ? existingByCode.get(skuCode) ?? null : null
    const action = existing ? 'overwrite' : 'create'

    return {
      row_index: index + 1,
      key: skuCode || `row-${index + 1}`,
      action,
      status: previewStatus(errors, action),
      errors,
      warnings: action === 'overwrite' && errors.length === 0 ? ['将覆盖现有 SKU'] : [],
      existing_sku_id: existing?.sku_id ?? null,
      data: {
        sku_code: skuCode,
        name,
        category_name: categoryName,
        color_name: colorName,
        variant_name: variantName,
        unit_price: unitPrice,
        inventory_quantity: inventoryQuantity,
        status: normalizeStatus(row.status),
      },
    }
  })

  return {
    can_commit: rows.every((row) => row.status !== 'error'),
    rows,
  }
}

export async function commitSkuImport(pool: Pool, rawRows: Array<Record<string, unknown>>) {
  const preview = await previewSkuImport(pool, rawRows)
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
      if (row.action === 'overwrite' && row.existing_sku_id) {
        await client.query(
          `update skus
           set sku_code = $1,
               name = $2,
               spec = $3,
               unit_price = $4,
               category = $5,
               category_name = $6,
               color_name = $7,
               variant_name = $8,
               status = $9
           where sku_id = $10`,
          [
            row.data.sku_code,
            row.data.name,
            row.data.variant_name,
            row.data.unit_price,
            row.data.category_name,
            row.data.category_name,
            row.data.color_name,
            row.data.variant_name,
            row.data.status,
            row.existing_sku_id,
          ]
        )

        await setSkuInventoryQuantityTx({
          client,
          skuId: row.existing_sku_id,
          nextQuantity: row.data.inventory_quantity,
          reason: 'manual_adjustment',
          remark: 'sku_import_overwrite',
        })

        await upsertSkuAttributeSuggestionsTx(client, {
          categoryName: row.data.category_name,
          colorName: row.data.color_name,
          variantName: row.data.variant_name,
          source: 'sku_import',
        })

        overwrittenCount += 1
        continue
      }

      const inserted = await client.query<{ sku_id: string }>(
        `insert into skus(
          sku_code,
          name,
          spec,
          unit_price,
          category,
          category_name,
          color_name,
          variant_name,
          status,
          inventory_quantity
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,0)
         returning sku_id`,
        [
          row.data.sku_code,
          row.data.name,
          row.data.variant_name,
          row.data.unit_price,
          row.data.category_name,
          row.data.category_name,
          row.data.color_name,
          row.data.variant_name,
          row.data.status,
        ]
      )

      const createdSkuId = inserted.rows[0]?.sku_id
      if (!createdSkuId) {
        throw new Error(`failed to create sku for ${row.data.sku_code}`)
      }

      await setSkuInventoryQuantityTx({
        client,
        skuId: createdSkuId,
        nextQuantity: row.data.inventory_quantity,
        reason: 'manual_adjustment',
        remark: 'sku_import_create',
      })

      await upsertSkuAttributeSuggestionsTx(client, {
        categoryName: row.data.category_name,
        colorName: row.data.color_name,
        variantName: row.data.variant_name,
        source: 'sku_import',
      })

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
