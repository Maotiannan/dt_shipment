import bcrypt from 'bcryptjs'
import cors from 'cors'
import express from 'express'

import { appMeta } from './appMeta.js'
import { pool } from './db.js'
import {
  applyInventoryMovementTx,
  lockInventoryStateForOrderChangeTx,
  InventoryLedgerError,
  normalizeInventoryItems,
  setSkuInventoryQuantityTx,
} from './inventory/ledger.js'
import { requireAuth, signToken, type AuthPayload } from './auth.js'
import { loadProductImageConfig } from './productImages/config.js'
import { productImageRepository, type ProductImageRow } from './productImages/repository.js'
import { removeTrashFilePair } from './productImages/fileStore.js'
import { createProductImageRouter } from './productImages/routes.js'
import {
  listSkuAttributeSuggestions,
  upsertSkuAttributeSuggestionsTx,
  type SkuAttributeType,
} from './skuAttributes/suggestions.js'
import { commitOrderImport, previewOrderImport } from './imports/orderImport.js'
import { commitSkuImport, previewSkuImport } from './imports/skuImport.js'

function toProductImageSummary(row: ProductImageRow) {
  return {
    image_id: row.image_id,
    sort_order: Number(row.sort_order),
    is_primary: row.is_primary,
    mime_type: row.mime_type,
    file_size: Number(row.file_size),
    width: row.width,
    height: row.height,
    thumb_url: `/api/product-images/${row.image_id}/thumb`,
    original_url: `/api/product-images/${row.image_id}/original`,
  }
}

async function listPrimaryImageThumbUrlsForSkus(skuIds: string[]) {
  if (skuIds.length === 0) {
    return new Map<string, string>()
  }

  const { rows } = await pool.query<{
    sku_id: string
    image_id: string
  }>(
    `select sku_id, image_id
     from product_images
     where sku_id = any($1::uuid[])
       and status = 'active'
       and is_primary = true`,
    [skuIds]
  )

  return new Map(
    rows.map((row) => [row.sku_id, `/api/product-images/${row.image_id}/thumb`] as const)
  )
}

function isInventoryLedgerError(error: unknown): error is InventoryLedgerError {
  return error instanceof InventoryLedgerError
}

const SKU_SELECT_SQL = `select sku_id,
  sku_code,
  name,
  spec,
  unit_price,
  category,
  category_name,
  color_name,
  variant_name,
  status,
  created_at,
  inventory_id,
  inventory_quantity
 from skus`

type SkuRow = Record<string, unknown> & {
  sku_id: string
  sku_code?: string | null
  name: string
  spec?: string | null
  unit_price?: number | string | null
  category?: string | null
  category_name?: string | null
  color_name?: string | null
  variant_name?: string | null
  status?: string | null
  created_at: string
  inventory_id?: string | null
  inventory_quantity?: number | null
}

type OrderRow = Record<string, unknown> & {
  ship_status?: string | null
  delivery_channel?: string | null
  tracking_method?: string | null
}

function normalizeShipStatus(shipStatus: unknown) {
  if (shipStatus === 'shipped_private' || shipStatus === 'shipped_uploaded') {
    return 'shipped'
  }

  return shipStatus === 'shipped' ? 'shipped' : 'pending'
}

function normalizeDeliveryChannel(row: {
  ship_status?: unknown
  delivery_channel?: unknown
  tracking_method?: unknown
}) {
  const shipStatus = row.ship_status
  if (shipStatus === 'shipped_private') {
    return 'private_chat'
  }
  if (shipStatus === 'shipped_uploaded') {
    return 'platform_upload'
  }

  const channel =
    row.delivery_channel === 'private_chat' || row.delivery_channel === 'platform_upload'
      ? row.delivery_channel
      : row.tracking_method === 'private_chat' || row.tracking_method === 'platform_upload'
        ? row.tracking_method
        : null

  return normalizeShipStatus(shipStatus) === 'shipped' ? channel : null
}

function toOrderResponseRow(row: OrderRow) {
  const deliveryChannel = normalizeDeliveryChannel(row)
  return {
    ...row,
    ship_status: normalizeShipStatus(row.ship_status),
    delivery_channel: deliveryChannel,
    tracking_method: deliveryChannel,
  }
}

function hasOwnKey<T extends string>(value: Record<string, unknown>, key: T) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function normalizeOptionalText(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized ? normalized : null
}

function parseNonNegativeInteger(value: unknown, fallback = 0) {
  if (value == null || value === '') {
    return fallback
  }

  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new InventoryLedgerError('inventory_quantity must be a non-negative integer', 400)
  }

  return parsed
}

function coerceCategoryName(body: Record<string, unknown>, existing?: SkuRow | null) {
  if (hasOwnKey(body, 'category_name')) {
    return normalizeOptionalText(body.category_name)
  }
  if (hasOwnKey(body, 'category')) {
    return normalizeOptionalText(body.category)
  }
  return normalizeOptionalText(existing?.category_name) ?? normalizeOptionalText(existing?.category)
}

function coerceVariantName(body: Record<string, unknown>, existing?: SkuRow | null) {
  if (hasOwnKey(body, 'variant_name')) {
    return normalizeOptionalText(body.variant_name)
  }
  if (hasOwnKey(body, 'spec')) {
    return normalizeOptionalText(body.spec)
  }
  return normalizeOptionalText(existing?.variant_name) ?? normalizeOptionalText(existing?.spec)
}

function coerceColorName(body: Record<string, unknown>, existing?: SkuRow | null) {
  if (hasOwnKey(body, 'color_name')) {
    return normalizeOptionalText(body.color_name)
  }
  return normalizeOptionalText(existing?.color_name)
}

function getSkuWriteFields(body: Record<string, unknown>, existing?: SkuRow | null) {
  const categoryName = coerceCategoryName(body, existing)
  const colorName = coerceColorName(body, existing)
  const variantName = coerceVariantName(body, existing)

  return {
    skuCode: normalizeOptionalText(body.sku_code) ?? normalizeOptionalText(existing?.sku_code),
    name: String(body.name ?? existing?.name ?? '').trim(),
    unitPrice: Number(body.unit_price ?? existing?.unit_price ?? 0),
    categoryName,
    colorName,
    variantName,
    spec: variantName,
    category: categoryName,
    status: String(body.status ?? existing?.status ?? 'active'),
    inventoryId: normalizeOptionalText(body.inventory_id) ?? normalizeOptionalText(existing?.inventory_id),
    inventoryQuantity: hasOwnKey(body, 'inventory_quantity')
      ? parseNonNegativeInteger(body.inventory_quantity)
      : parseNonNegativeInteger(existing?.inventory_quantity ?? 0),
  }
}

function toSkuResponseRow(row: SkuRow) {
  const categoryName = normalizeOptionalText(row.category_name) ?? normalizeOptionalText(row.category)
  const variantName = normalizeOptionalText(row.variant_name) ?? normalizeOptionalText(row.spec)
  const colorName = normalizeOptionalText(row.color_name)

  return {
    ...row,
    category_name: categoryName,
    color_name: colorName,
    variant_name: variantName,
    category: categoryName,
    spec: variantName,
    inventory_quantity: Number(row.inventory_quantity ?? 0),
  }
}
export function createApp(env: NodeJS.ProcessEnv = process.env) {
  loadProductImageConfig(env)

  const app = express()
  const ADMIN_USERNAME = env.ADMIN_USERNAME ?? 'admin'
  const ADMIN_PASSWORD = env.ADMIN_PASSWORD ?? '123456'

  app.use(cors())
  app.use(express.json({ limit: '2mb' }))
  app.use(createProductImageRouter(env))

  app.get('/api/meta', (_req, res) => {
    res.json({
      app: appMeta,
      timestamp: new Date().toISOString(),
    })
  })

  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('select 1')
      res.json({ ok: true, app: appMeta, db: 'ok' })
    } catch (err) {
      res.status(500).json({
        ok: false,
        app: appMeta,
        error: (err as Error).message,
      })
    }
  })

  app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body as {
      username?: string
      password?: string
    }

    if (!username || !password) {
      return res.status(400).json({ error: 'username/password required' })
    }

    if (username !== ADMIN_USERNAME) {
      return res.status(401).json({ error: '账号或密码错误' })
    }

    const plain = ADMIN_PASSWORD
    const hash = env.ADMIN_PASSWORD_HASH

    const ok = hash ? await bcrypt.compare(password, hash) : password === plain
    if (!ok) return res.status(401).json({ error: '账号或密码错误' })

    const payload: AuthPayload = { userId: 1, username }
    const token = signToken(payload)
    return res.json({ token, user: payload })
  })

  app.get('/api/auth/me', requireAuth, (req, res) => {
    const user = (req as typeof req & { user: AuthPayload }).user
    res.json({ user })
  })

  app.post('/api/auth/logout', requireAuth, (_req, res) => {
    res.json({ ok: true })
  })

  app.get('/api/accounts', requireAuth, async (_req, res) => {
    const { rows } = await pool.query(
      'select account_id,account_name,remark,biz_type,status,created_at from fish_accounts order by created_at desc'
    )
    res.json(rows)
  })

  app.post('/api/accounts', requireAuth, async (req, res) => {
    const { account_name, remark, biz_type, status } = req.body
    const { rows } = await pool.query(
      `insert into fish_accounts(account_name,remark,biz_type,status)
       values ($1,$2,$3,$4)
       returning account_id,account_name,remark,biz_type,status,created_at`,
      [account_name, remark ?? null, biz_type ?? 'mixed', status ?? 'active']
    )
    res.json(rows[0])
  })

  app.put('/api/accounts/:id', requireAuth, async (req, res) => {
    const { id } = req.params
    const { account_name, remark, biz_type, status } = req.body
    const { rows } = await pool.query(
      `update fish_accounts
       set account_name=$1, remark=$2, biz_type=$3, status=$4
       where account_id=$5
       returning account_id,account_name,remark,biz_type,status,created_at`,
      [account_name, remark ?? null, biz_type, status, id]
    )
    res.json(rows[0] ?? null)
  })

  app.delete('/api/accounts/:id', requireAuth, async (req, res) => {
    const { id } = req.params

    try {
      const { rows } = await pool.query<{
        account_id: string
      }>(
        `delete from fish_accounts
         where account_id = $1
         returning account_id`,
        [id]
      )

      if (!rows[0]) {
        return res.status(404).json({ error: 'account not found' })
      }

      return res.json({ ok: true, deletedAccountId: rows[0].account_id })
    } catch (error) {
      if ((error as { code?: string }).code === '23503') {
        return res.status(409).json({ error: 'account is referenced by orders' })
      }

      throw error
    }
  })

  app.get('/api/sku-attribute-suggestions', requireAuth, async (req, res) => {
    const attribute = String(req.query.attribute ?? '').trim() as SkuAttributeType
    if (!['category', 'color', 'variant'].includes(attribute)) {
      return res.status(400).json({ error: 'attribute must be one of: category, color, variant' })
    }

    const categoryName = normalizeOptionalText(req.query.category_name)
    const suggestions = await listSkuAttributeSuggestions(pool, {
      attributeType: attribute,
      scopeKey: attribute === 'category' ? null : categoryName,
      limit: Number(req.query.limit ?? 12),
    })

    return res.json({ suggestions })
  })

  app.get('/api/skus', requireAuth, async (_req, res) => {
    const { rows } = await pool.query(
      `${SKU_SELECT_SQL}
       order by created_at desc`
    )
    const primaryThumbs = await listPrimaryImageThumbUrlsForSkus(
      rows.map((row) => String(row.sku_id))
    )
    res.json(
      rows.map((row) => ({
        ...toSkuResponseRow(row as SkuRow),
        primary_image_thumb_url: primaryThumbs.get(String(row.sku_id)) ?? null,
      }))
    )
  })

  app.post('/api/skus', requireAuth, async (req, res) => {
    const body = req.body as Record<string, unknown>
    const fields = getSkuWriteFields(body)
    const client = await pool.connect()

    try {
      await client.query('begin')
      const inserted = await client.query<SkuRow>(
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
          inventory_id,
          inventory_quantity
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0)
         returning *`,
        [
          fields.skuCode,
          fields.name,
          fields.spec,
          fields.unitPrice,
          fields.category,
          fields.categoryName,
          fields.colorName,
          fields.variantName,
          fields.status,
          fields.inventoryId,
        ]
      )

      const sku = inserted.rows[0]
      if (!sku) {
        throw new Error('failed to create sku')
      }

      await setSkuInventoryQuantityTx({
        client,
        skuId: sku.sku_id,
        nextQuantity: fields.inventoryQuantity,
        reason: 'manual_adjustment',
        remark: 'sku_create',
      })

      await upsertSkuAttributeSuggestionsTx(client, {
        categoryName: fields.categoryName,
        colorName: fields.colorName,
        variantName: fields.variantName,
      })

      const finalRow = await client.query<SkuRow>(
        `${SKU_SELECT_SQL}
         where sku_id = $1
         limit 1`,
        [sku.sku_id]
      )

      await client.query('commit')
      return res.json(toSkuResponseRow(finalRow.rows[0] ?? sku))
    } catch (error) {
      await client.query('rollback').catch(() => undefined)
      if (isInventoryLedgerError(error)) {
        return res.status(error.statusCode).json({ error: error.message })
      }
      throw error
    } finally {
      client.release()
    }
  })

  app.put('/api/skus/:id', requireAuth, async (req, res) => {
    const id = String(req.params.id)
    const body = req.body as Record<string, unknown>
    const client = await pool.connect()

    try {
      await client.query('begin')
      const existing = await client.query<SkuRow>(
        `${SKU_SELECT_SQL}
         where sku_id = $1
         limit 1
         for update`,
        [id]
      )

      const currentSku = existing.rows[0]
      if (!currentSku) {
        await client.query('rollback')
        return res.status(404).json({ error: 'sku not found' })
      }

      const fields = getSkuWriteFields(body, currentSku)
      await client.query(
        `update skus
         set sku_code=$1,
             name=$2,
             spec=$3,
             unit_price=$4,
             category=$5,
             category_name=$6,
             color_name=$7,
             variant_name=$8,
             status=$9,
             inventory_id=$10
         where sku_id=$11`,
        [
          fields.skuCode,
          fields.name,
          fields.spec,
          fields.unitPrice,
          fields.category,
          fields.categoryName,
          fields.colorName,
          fields.variantName,
          fields.status,
          fields.inventoryId,
          id,
        ]
      )

      await setSkuInventoryQuantityTx({
        client,
        skuId: id,
        nextQuantity: fields.inventoryQuantity,
        reason: 'manual_adjustment',
        remark: 'sku_update',
      })

      await upsertSkuAttributeSuggestionsTx(client, {
        categoryName: fields.categoryName,
        colorName: fields.colorName,
        variantName: fields.variantName,
      })

      const finalRow = await client.query<SkuRow>(
        `${SKU_SELECT_SQL}
         where sku_id = $1
         limit 1`,
        [id]
      )

      await client.query('commit')
      return res.json(toSkuResponseRow(finalRow.rows[0] ?? currentSku))
    } catch (error) {
      await client.query('rollback').catch(() => undefined)
      if (isInventoryLedgerError(error)) {
        return res.status(error.statusCode).json({ error: error.message })
      }
      throw error
    } finally {
      client.release()
    }
  })

  app.get('/api/skus/:id', requireAuth, async (req, res) => {
    const { id } = req.params
    const skuId = String(id)
    const { rows } = await pool.query(
      `${SKU_SELECT_SQL}
       where sku_id = $1
       limit 1`,
      [skuId]
    )

    const sku = rows[0] as SkuRow | undefined
    if (!sku) {
      return res.status(404).json({ error: 'sku not found' })
    }

    const images = await productImageRepository.listActiveProductImages(skuId)
    return res.json({
      ...toSkuResponseRow(sku),
      images: images.map((image) => toProductImageSummary(image)),
    })
  })

  app.delete('/api/skus/:id', requireAuth, async (req, res) => {
    const { id } = req.params
    const skuId = String(id)
    const client = await pool.connect()
    let imageRows: ProductImageRow[] = []

    try {
      await client.query('begin')

      const existingSku = await client.query<{ sku_id: string }>(
        `select sku_id
         from skus
         where sku_id = $1
         for update`,
        [skuId]
      )

      if (existingSku.rows.length === 0) {
        await client.query('rollback')
        return res.status(404).json({ error: 'sku not found' })
      }

      imageRows = await productImageRepository.listProductImagesForSku(skuId, client)
      await client.query(`delete from skus where sku_id = $1`, [skuId])
      await client.query('commit')
    } catch (error) {
      await client.query('rollback').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }

    await Promise.all(
      imageRows.map((image) =>
        removeTrashFilePair(
          {
            originalRelpath: image.original_relpath,
            thumbRelpath: image.thumb_relpath,
          },
          env
        ).catch((error) => {
          console.error(
            `failed to remove sku image files after sku delete: sku=${skuId} image=${image.image_id}`,
            error
          )
        })
      )
    )

    return res.json({ ok: true, deletedSkuId: skuId })
  })

  app.post('/api/skus/import/preview', requireAuth, async (req, res) => {
    const rows = (req.body?.rows ?? []) as Array<Record<string, unknown>>
    if (!Array.isArray(rows)) {
      return res.status(400).json({ error: 'rows required' })
    }

    const preview = await previewSkuImport(pool, rows)
    return res.json(preview)
  })

  app.post('/api/skus/import/commit', requireAuth, async (req, res) => {
    const rows = (req.body?.rows ?? []) as Array<Record<string, unknown>>
    if (!Array.isArray(rows)) {
      return res.status(400).json({ error: 'rows required' })
    }

    try {
      const result = await commitSkuImport(pool, rows)
      return res.json(result)
    } catch (error) {
      if (isInventoryLedgerError(error)) {
        return res.status(error.statusCode).json({ error: error.message })
      }

      throw error
    }
  })

  app.get('/api/orders', requireAuth, async (req, res) => {
    const orderType = req.query.order_type as string | undefined
    if (orderType) {
      const { rows } = await pool.query(
        `select * from orders where order_type=$1 order by created_at desc`,
        [orderType]
      )
      return res.json(rows)
    }
    const { rows } = await pool.query(
      `select * from orders order by created_at desc`
    )
    return res.json(rows)
  })

  app.get('/api/orders/:id', requireAuth, async (req, res) => {
    const { id } = req.params
    const { rows } = await pool.query(
      `select *
       from orders
       where order_id = $1
       limit 1`,
      [id]
    )

    if (!rows[0]) {
      return res.status(404).json({ error: 'order not found' })
    }

    return res.json(rows[0])
  })

  app.post('/api/orders', requireAuth, async (req, res) => {
    const b = req.body
    const client = await pool.connect()

    try {
      await client.query('begin')
      await applyInventoryMovementTx({
        client,
        orderId: b.order_id,
        beforeItems: [],
        afterItems: normalizeInventoryItems(b.items),
        reason: 'order_create',
      })

      const { rows } = await client.query(
        `insert into orders(
          order_id,account_id,order_type,buyer_name,shipping_address,items,total_amount,
          ship_status,tracking_number,tracking_method,is_abnormal,abnormal_type,remark,
          settlement_status,paid_amount,shipped_at
        ) values (
          $1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
        )
        returning *`,
        [
          b.order_id,
          b.account_id,
          b.order_type,
          b.buyer_name,
          b.shipping_address,
          JSON.stringify(b.items ?? []),
          b.total_amount ?? 0,
          b.ship_status ?? 'pending',
          b.tracking_number ?? null,
          b.tracking_method ?? null,
          b.is_abnormal ?? false,
          b.abnormal_type ?? null,
          b.remark ?? null,
          b.settlement_status ?? null,
          b.paid_amount ?? 0,
          b.shipped_at ?? null,
        ]
      )

      await client.query('commit')
      return res.json(rows[0])
    } catch (error) {
      await client.query('rollback').catch(() => undefined)

      if (isInventoryLedgerError(error)) {
        return res.status(error.statusCode).json({ error: error.message })
      }

      throw error
    } finally {
      client.release()
    }
  })

  app.patch('/api/orders/:id', requireAuth, async (req, res) => {
    const { id } = req.params
    const b = req.body
    const { rows } = await pool.query(
      `update orders
       set ship_status=$1,tracking_number=$2,tracking_method=$3,is_abnormal=$4,abnormal_type=$5,remark=$6,shipped_at=$7
       where order_id=$8
       returning *`,
      [
        b.ship_status,
        b.tracking_number ?? null,
        b.tracking_method ?? null,
        b.is_abnormal ?? false,
        b.abnormal_type ?? null,
        b.remark ?? null,
        b.shipped_at ?? null,
        id,
      ]
    )
    res.json(rows[0] ?? null)
  })

  app.put('/api/orders/:id', requireAuth, async (req, res) => {
    const id = String(req.params.id)
    const b = req.body
    const client = await pool.connect()

    try {
      await client.query('begin')

      const existingOrder = await client.query<{ items: unknown }>(
        `select items
         from orders
         where order_id = $1
         for update`,
        [id]
      )

      if (!existingOrder.rows[0]) {
        await client.query('rollback')
        return res.status(404).json({ error: 'order not found' })
      }

      const beforeItems = normalizeInventoryItems(existingOrder.rows[0].items)
      const afterItems = normalizeInventoryItems(b.items)
      const inventoryState = await lockInventoryStateForOrderChangeTx(
        client,
        beforeItems,
        afterItems
      )

      await applyInventoryMovementTx({
        client,
        orderId: id,
        beforeItems,
        afterItems: [],
        inventoryState,
        reason: 'order_update_revert',
      })
      await applyInventoryMovementTx({
        client,
        orderId: id,
        beforeItems: [],
        afterItems,
        inventoryState,
        reason: 'order_update_apply',
      })

      const { rows } = await client.query(
        `update orders
         set account_id=$1,
             order_type=$2,
             buyer_name=$3,
             shipping_address=$4,
             items=$5::jsonb,
             total_amount=$6,
             ship_status=$7,
             tracking_number=$8,
             tracking_method=$9,
             is_abnormal=$10,
             abnormal_type=$11,
             remark=$12,
             settlement_status=$13,
             paid_amount=$14,
             paid_at=$15,
             paid_remark=$16,
             shipped_at=$17
         where order_id=$18
         returning *`,
        [
          b.account_id,
          b.order_type,
          b.buyer_name,
          b.shipping_address,
          JSON.stringify(b.items ?? []),
          b.total_amount ?? 0,
          b.ship_status ?? 'pending',
          b.tracking_number ?? null,
          b.tracking_method ?? null,
          b.is_abnormal ?? false,
          b.abnormal_type ?? null,
          b.remark ?? null,
          b.settlement_status ?? null,
          b.paid_amount ?? 0,
          b.paid_at ?? null,
          b.paid_remark ?? null,
          b.shipped_at ?? null,
          id,
        ]
      )

      await client.query('commit')
      return res.json(rows[0])
    } catch (error) {
      await client.query('rollback').catch(() => undefined)

      if (isInventoryLedgerError(error)) {
        return res.status(error.statusCode).json({ error: error.message })
      }

      throw error
    } finally {
      client.release()
    }
  })

  app.patch('/api/orders/:id/paid', requireAuth, async (req, res) => {
    const id = String(req.params.id)
    const b = req.body
    const { rows } = await pool.query(
      `update orders
       set paid_amount=$1,settlement_status=$2,paid_at=$3,paid_remark=$4
       where order_id=$5
       returning *`,
      [
        b.paid_amount ?? 0,
        b.settlement_status ?? null,
        b.paid_at ?? null,
        b.paid_remark ?? null,
        id,
      ]
    )
    res.json(rows[0] ?? null)
  })

  app.delete('/api/orders/:id', requireAuth, async (req, res) => {
    const id = String(req.params.id)
    const client = await pool.connect()

    try {
      await client.query('begin')

      const existingOrder = await client.query<{ order_id: string; items: unknown }>(
        `select order_id, items
         from orders
         where order_id = $1
         for update`,
        [id]
      )

      if (!existingOrder.rows[0]) {
        await client.query('rollback')
        return res.status(404).json({ error: 'order not found' })
      }

      await applyInventoryMovementTx({
        client,
        orderId: id,
        beforeItems: normalizeInventoryItems(existingOrder.rows[0].items),
        afterItems: [],
        reason: 'order_delete_revert',
      })

      await client.query(
        `delete from orders
         where order_id = $1`,
        [id]
      )

      await client.query('commit')
      return res.json({ ok: true, deletedOrderId: existingOrder.rows[0].order_id })
    } catch (error) {
      await client.query('rollback').catch(() => undefined)

      if (isInventoryLedgerError(error)) {
        return res.status(error.statusCode).json({ error: error.message })
      }

      throw error
    } finally {
      client.release()
    }
  })

  app.post('/api/orders/import/preview', requireAuth, async (req, res) => {
    const rows = (req.body?.rows ?? []) as Array<Record<string, unknown>>
    if (!Array.isArray(rows)) {
      return res.status(400).json({ error: 'rows required' })
    }

    const preview = await previewOrderImport(pool, rows)
    return res.json(preview)
  })

  app.post('/api/orders/import/commit', requireAuth, async (req, res) => {
    const rows = (req.body?.rows ?? []) as Array<Record<string, unknown>>
    if (!Array.isArray(rows)) {
      return res.status(400).json({ error: 'rows required' })
    }

    try {
      const result = await commitOrderImport(pool, rows)
      return res.json(result)
    } catch (error) {
      if (isInventoryLedgerError(error)) {
        return res.status(error.statusCode).json({ error: error.message })
      }

      throw error
    }
  })

  app.post('/api/orders/bulkUpsert', requireAuth, async (req, res) => {
    const rows = (req.body?.rows ?? []) as Array<Record<string, unknown>>
    if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows required' })

    const client = await pool.connect()
    try {
      await client.query('begin')
      // Legacy bulk upsert bypasses the inventory ledger and must stay sku-less.
      for (const r of rows) {
        await client.query(
          `insert into orders(
            order_id,account_id,order_type,buyer_name,shipping_address,items,total_amount,
            ship_status,tracking_number,tracking_method,is_abnormal,abnormal_type,remark,
            settlement_status,paid_amount
          ) values (
            $1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15
          )
          on conflict(order_id) do update set
            account_id=excluded.account_id,
            order_type=excluded.order_type,
            buyer_name=excluded.buyer_name,
            shipping_address=excluded.shipping_address,
            items=excluded.items,
            total_amount=excluded.total_amount,
            ship_status=excluded.ship_status,
            tracking_number=excluded.tracking_number,
            tracking_method=excluded.tracking_method,
            is_abnormal=excluded.is_abnormal,
            abnormal_type=excluded.abnormal_type,
            remark=excluded.remark,
            settlement_status=excluded.settlement_status,
            paid_amount=excluded.paid_amount`,
          [
            r.order_id,
            r.account_id,
            r.order_type,
            r.buyer_name,
            r.shipping_address,
            JSON.stringify(r.items ?? []),
            r.total_amount ?? 0,
            r.ship_status ?? 'pending',
            r.tracking_number ?? null,
            r.tracking_method ?? null,
            r.is_abnormal ?? false,
            r.abnormal_type ?? null,
            r.remark ?? null,
            r.settlement_status ?? null,
            r.paid_amount ?? 0,
          ]
        )
      }
      await client.query('commit')
      res.json({ ok: true, count: rows.length })
    } catch (err) {
      await client.query('rollback')
      res.status(500).json({ error: (err as Error).message })
    } finally {
      client.release()
    }
  })

  app.post('/api/push-subscriptions', requireAuth, async (req, res) => {
    const { endpoint, p256dh, auth } = req.body
    const { rows } = await pool.query(
      `insert into push_subscriptions(endpoint,p256dh,auth)
       values($1,$2,$3)
       on conflict(endpoint) do update set p256dh=excluded.p256dh, auth=excluded.auth
       returning *`,
      [endpoint, p256dh, auth]
    )
    res.json(rows[0])
  })

  return app
}
