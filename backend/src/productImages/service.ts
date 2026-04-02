import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'

import { pool } from '../db.js'
import {
  type ProductImageRow,
  getActiveProductImageById,
  insertProductImage,
  lockSkuForImageMutation,
  listActiveProductImages,
} from './repository.js'
import {
  InvalidProductImageFileError,
  persistProductImage,
  readStoredProductImage,
  removePersistedProductImage,
} from './fileStore.js'
import { loadProductImageConfig } from './config.js'

export type ProductImageDto = {
  image_id: string
  sort_order: number
  is_primary: boolean
  mime_type: string
  file_size: number
  width: number
  height: number
  thumb_url: string
  original_url: string
}

type ProductImageKind = 'thumb' | 'original'

export class ProductImageServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message)
  }
}

export const productImageServiceDb = {
  connect: () => pool.connect(),
}

function toProductImageDto(row: ProductImageRow): ProductImageDto {
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

function ensureValidUploadFile(
  file: Express.Multer.File,
  env: NodeJS.ProcessEnv
) {
  const config = loadProductImageConfig(env)

  if (!file.mimetype || !config.allowedMimeTypes.includes(file.mimetype)) {
    throw new ProductImageServiceError(`unsupported image mime type: ${file.mimetype || 'unknown'}`, 400)
  }

  if (!file.size || file.size <= 0) {
    throw new ProductImageServiceError('uploaded file must not be empty', 400)
  }

  if (file.size > config.maxFileBytes) {
    throw new ProductImageServiceError('uploaded file exceeds configured size limit', 400)
  }
}

async function cleanupTempFiles(files: Express.Multer.File[]) {
  await Promise.all(
    files.map((file) => fs.rm(file.path, { force: true }).catch(() => undefined))
  )
}

export async function uploadProductImages(
  params: {
    skuId: string
    files: Express.Multer.File[]
  },
  env: NodeJS.ProcessEnv = process.env
) {
  const config = loadProductImageConfig(env)
  const files = params.files ?? []

  if (files.length === 0) {
    throw new ProductImageServiceError('at least one image file is required', 400)
  }

  if (files.length > config.maxFiles) {
    throw new ProductImageServiceError(`too many files; max is ${config.maxFiles}`, 400)
  }

  for (const file of files) {
    ensureValidUploadFile(file, env)
  }

  let client: Awaited<ReturnType<typeof productImageServiceDb.connect>> | null = null
  const persistedPaths: Array<{ originalAbsPath: string; thumbAbsPath: string }> = []

  try {
    client = await productImageServiceDb.connect()
    await client.query('begin')

    if (!(await lockSkuForImageMutation(params.skuId, client))) {
      throw new ProductImageServiceError('sku not found', 404)
    }

    const existingImages = await listActiveProductImages(params.skuId, client)
    const nextSortOrder = existingImages.length + 1
    const insertedImages: ProductImageDto[] = []

    for (const [index, file] of files.entries()) {
      const imageId = randomUUID()
      let storedFile
      try {
        storedFile = await persistProductImage(
          {
            skuId: params.skuId,
            imageId,
            sourcePath: file.path,
            originalFilename: file.originalname,
            mimeType: file.mimetype,
          },
          env
        )
      } catch (error) {
        if (error instanceof InvalidProductImageFileError) {
          throw new ProductImageServiceError(error.message, 400)
        }
        throw error
      }

      persistedPaths.push({
        originalAbsPath: storedFile.originalAbsPath,
        thumbAbsPath: storedFile.thumbAbsPath,
      })

      const row = await insertProductImage(
        {
          imageId,
          skuId: params.skuId,
          storageKey: pathJoinStorageKey(params.skuId, imageId),
          originalRelpath: storedFile.originalRelpath,
          thumbRelpath: storedFile.thumbRelpath,
          mimeType: file.mimetype,
          fileExt: storedFile.fileExt,
          fileSize: storedFile.fileSize,
          width: storedFile.width,
          height: storedFile.height,
          sha256: storedFile.sha256,
          sortOrder: nextSortOrder + index,
          isPrimary: existingImages.length === 0 && index === 0,
        },
        client
      )

      insertedImages.push(toProductImageDto(row))
    }

    await client.query('commit')
    return insertedImages
  } catch (error) {
    await client?.query('rollback').catch(() => undefined)
    await Promise.all(persistedPaths.map((item) => removePersistedProductImage(item)))
    throw error
  } finally {
    client?.release()
    await cleanupTempFiles(files)
  }
}

function pathJoinStorageKey(skuId: string, imageId: string) {
  return `product-images/${skuId}/${imageId}`
}

export async function readProductImageBinary(
  imageId: string,
  kind: ProductImageKind,
  env: NodeJS.ProcessEnv = process.env
) {
  const image = await getActiveProductImageById(imageId)

  if (!image) {
    throw new ProductImageServiceError('product image not found', 404)
  }

  const buffer = await readStoredProductImage(
    kind === 'thumb' ? image.thumb_relpath : image.original_relpath,
    env
  )

  return {
    buffer,
    contentType: kind === 'thumb' ? 'image/jpeg' : image.mime_type,
  }
}
