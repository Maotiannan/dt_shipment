import { pool } from '../db.js'

export type ProductImageDb = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: T[] }>
}

export type ProductImageRow = {
  image_id: string
  sku_id: string
  storage_key: string
  original_relpath: string
  thumb_relpath: string
  mime_type: string
  file_ext: string
  file_size: string | number
  width: number
  height: number
  sha256: string
  sort_order: number
  is_primary: boolean
  status: string
  deleted_at: string | null
  created_at: string
  updated_at: string
}

function getDb(db?: ProductImageDb) {
  return db ?? pool
}

export async function skuExists(skuId: string, db?: ProductImageDb) {
  const executor = getDb(db)
  const { rows } = await executor.query<{ sku_id: string }>(
    `select sku_id
     from skus
     where sku_id = $1
     limit 1`,
    [skuId]
  )
  return rows.length > 0
}

export async function lockSkuForImageMutation(skuId: string, db?: ProductImageDb) {
  const executor = getDb(db)
  const { rows } = await executor.query<{ sku_id: string }>(
    `select sku_id
     from skus
     where sku_id = $1
     for update`,
    [skuId]
  )
  return rows.length > 0
}

export async function listActiveProductImages(skuId: string, db?: ProductImageDb) {
  const executor = getDb(db)
  const { rows } = await executor.query<ProductImageRow>(
    `select
       image_id,
       sku_id,
       storage_key,
       original_relpath,
       thumb_relpath,
       mime_type,
       file_ext,
       file_size,
       width,
       height,
       sha256,
       sort_order,
       is_primary,
       status,
       deleted_at::text,
       created_at::text,
       updated_at::text
     from product_images
     where sku_id = $1
       and status = 'active'
     order by sort_order asc, image_id asc`,
    [skuId]
  )
  return rows
}

export async function insertProductImage(
  input: {
    imageId: string
    skuId: string
    storageKey: string
    originalRelpath: string
    thumbRelpath: string
    mimeType: string
    fileExt: string
    fileSize: number
    width: number
    height: number
    sha256: string
    sortOrder: number
    isPrimary: boolean
  },
  db?: ProductImageDb
) {
  const executor = getDb(db)
  const { rows } = await executor.query<ProductImageRow>(
    `insert into product_images(
       image_id,
       sku_id,
       storage_key,
       original_relpath,
       thumb_relpath,
       mime_type,
       file_ext,
       file_size,
       width,
       height,
       sha256,
       sort_order,
       is_primary
     ) values (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
     )
     returning
       image_id,
       sku_id,
       storage_key,
       original_relpath,
       thumb_relpath,
       mime_type,
       file_ext,
       file_size,
       width,
       height,
       sha256,
       sort_order,
       is_primary,
       status,
       deleted_at::text,
       created_at::text,
       updated_at::text`,
    [
      input.imageId,
      input.skuId,
      input.storageKey,
      input.originalRelpath,
      input.thumbRelpath,
      input.mimeType,
      input.fileExt,
      input.fileSize,
      input.width,
      input.height,
      input.sha256,
      input.sortOrder,
      input.isPrimary,
    ]
  )
  return rows[0]
}

export async function getActiveProductImageById(imageId: string, db?: ProductImageDb) {
  const executor = getDb(db)
  const { rows } = await executor.query<ProductImageRow>(
    `select
       image_id,
       sku_id,
       storage_key,
       original_relpath,
       thumb_relpath,
       mime_type,
       file_ext,
       file_size,
       width,
       height,
       sha256,
       sort_order,
       is_primary,
       status,
       deleted_at::text,
       created_at::text,
       updated_at::text
     from product_images
     where image_id = $1
       and status = 'active'
     limit 1`,
    [imageId]
  )
  return rows[0] ?? null
}

export async function getProductImageById(imageId: string, db?: ProductImageDb) {
  const executor = getDb(db)
  const { rows } = await executor.query<ProductImageRow>(
    `select
       image_id,
       sku_id,
       storage_key,
       original_relpath,
       thumb_relpath,
       mime_type,
       file_ext,
       file_size,
       width,
       height,
       sha256,
       sort_order,
       is_primary,
       status,
       deleted_at::text,
       created_at::text,
       updated_at::text
     from product_images
     where image_id = $1
     limit 1`,
    [imageId]
  )
  return rows[0] ?? null
}

export async function listDeletedProductImages(db?: ProductImageDb) {
  const executor = getDb(db)
  const { rows } = await executor.query<ProductImageRow>(
    `select
       image_id,
       sku_id,
       storage_key,
       original_relpath,
       thumb_relpath,
       mime_type,
       file_ext,
       file_size,
       width,
       height,
       sha256,
       sort_order,
       is_primary,
       status,
       deleted_at::text,
       created_at::text,
       updated_at::text
     from product_images
     where status = 'deleted'
     order by deleted_at asc nulls last, image_id asc`
  )
  return rows
}

export async function listProductImagesForSku(skuId: string, db?: ProductImageDb) {
  const executor = getDb(db)
  const { rows } = await executor.query<ProductImageRow>(
    `select
       image_id,
       sku_id,
       storage_key,
       original_relpath,
       thumb_relpath,
       mime_type,
       file_ext,
       file_size,
       width,
       height,
       sha256,
       sort_order,
       is_primary,
       status,
       deleted_at::text,
       created_at::text,
       updated_at::text
     from product_images
     where sku_id = $1
     order by
       case when status = 'active' then 0 else 1 end asc,
       sort_order asc,
       image_id asc`,
    [skuId]
  )
  return rows
}

export async function listExpiredDeletedImages(retentionDays: number, db?: ProductImageDb) {
  const executor = getDb(db)
  const { rows } = await executor.query<ProductImageRow>(
    `select
       image_id,
       sku_id,
       storage_key,
       original_relpath,
       thumb_relpath,
       mime_type,
       file_ext,
       file_size,
       width,
       height,
       sha256,
       sort_order,
       is_primary,
       status,
       deleted_at::text,
       created_at::text,
       updated_at::text
     from product_images
     where status = 'deleted'
       and deleted_at is not null
       and deleted_at < now() - ($1 * interval '1 day')
     order by deleted_at asc, image_id asc`,
    [retentionDays]
  )
  return rows
}

export async function setProductImagePrimary(
  skuId: string,
  imageId: string,
  db?: ProductImageDb
) {
  const executor = getDb(db)
  await executor.query(
    `update product_images
     set is_primary = (image_id = $2),
         updated_at = now()
     where sku_id = $1
       and status = 'active'`,
    [skuId, imageId]
  )
}

export async function setProductImageSortOrders(
  skuId: string,
  updates: Array<{ imageId: string; sortOrder: number }>,
  db?: ProductImageDb
) {
  if (updates.length === 0) return

  const executor = getDb(db)
  const params: unknown[] = [skuId]
  const valuesSql = updates
    .map((update, index) => {
      params.push(update.imageId, update.sortOrder)
      const imageIdParam = index * 2 + 2
      const sortOrderParam = index * 2 + 3
      return `($${imageIdParam}::uuid, $${sortOrderParam}::integer)`
    })
    .join(', ')

  await executor.query(
    `update product_images as p
     set sort_order = -v.sort_order,
         updated_at = now()
     from (values ${valuesSql}) as v(image_id, sort_order)
     where p.sku_id = $1
       and p.status = 'active'
       and p.image_id = v.image_id`,
    params
  )

  await executor.query(
    `update product_images as p
     set sort_order = v.sort_order,
         updated_at = now()
     from (values ${valuesSql}) as v(image_id, sort_order)
     where p.sku_id = $1
       and p.status = 'active'
       and p.image_id = v.image_id`,
    params
  )
}

export async function markProductImageDeleted(
  input: {
    skuId: string
    imageId: string
    trashOriginalRelpath: string
    trashThumbRelpath: string
    deletedAt: Date
  },
  db?: ProductImageDb
) {
  const executor = getDb(db)
  const { rows } = await executor.query<ProductImageRow>(
    `update product_images
     set status = 'deleted',
         deleted_at = $3,
         is_primary = false,
         original_relpath = $4,
         thumb_relpath = $5,
         updated_at = now()
     where sku_id = $1
       and image_id = $2
       and status = 'active'
     returning
       image_id,
       sku_id,
       storage_key,
       original_relpath,
       thumb_relpath,
       mime_type,
       file_ext,
       file_size,
       width,
       height,
       sha256,
       sort_order,
       is_primary,
       status,
       deleted_at::text,
       created_at::text,
       updated_at::text`,
    [
      input.skuId,
      input.imageId,
      input.deletedAt.toISOString(),
      input.trashOriginalRelpath,
      input.trashThumbRelpath,
    ]
  )
  return rows[0] ?? null
}

export const productImageRepository = {
  skuExists,
  lockSkuForImageMutation,
  listActiveProductImages,
  insertProductImage,
  getActiveProductImageById,
  getProductImageById,
  listDeletedProductImages,
  listProductImagesForSku,
  listExpiredDeletedImages,
  setProductImagePrimary,
  setProductImageSortOrders,
  markProductImageDeleted,
}
