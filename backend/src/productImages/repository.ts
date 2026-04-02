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
