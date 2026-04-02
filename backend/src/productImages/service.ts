import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'

import { pool } from '../db.js'
import {
  type ProductImageRow,
  productImageRepository,
} from './repository.js'
import {
  InvalidProductImageFileError,
  productImageFileStore,
} from './fileStore.js'
import { loadProductImageConfig } from './config.js'
import { nextPrimaryAfterDelete, resequenceSortOrder } from './reorder.js'

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
    throw new ProductImageServiceError(
      `unsupported image mime type: ${file.mimetype || 'unknown'}`,
      400
    )
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

async function loadActiveImagesOrThrow(
  skuId: string,
  client: Awaited<ReturnType<typeof productImageServiceDb.connect>>
) {
  const images = await productImageRepository.listActiveProductImages(skuId, client)
  if (images.length === 0) {
    throw new ProductImageServiceError('sku not found', 404)
  }

  return images
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

    if (!(await productImageRepository.lockSkuForImageMutation(params.skuId, client))) {
      throw new ProductImageServiceError('sku not found', 404)
    }

    const existingImages = await productImageRepository.listActiveProductImages(params.skuId, client)
    const nextSortOrder = existingImages.length + 1
    const insertedImages: ProductImageDto[] = []

    for (const [index, file] of files.entries()) {
      const imageId = randomUUID()
      let storedFile
      try {
        storedFile = await productImageFileStore.persistProductImage(
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

      const row = await productImageRepository.insertProductImage(
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
    await Promise.all(
      persistedPaths.map((item) => productImageFileStore.removePersistedProductImage(item))
    )
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
  const image = await productImageRepository.getActiveProductImageById(imageId)

  if (!image) {
    throw new ProductImageServiceError('product image not found', 404)
  }

  const buffer = await productImageFileStore.readStoredProductImage(
    kind === 'thumb' ? image.thumb_relpath : image.original_relpath,
    env
  )

  return {
    buffer,
    contentType: kind === 'thumb' ? 'image/jpeg' : image.mime_type,
  }
}

export async function markProductImagePrimary(
  params: { skuId: string; imageId: string },
  env: NodeJS.ProcessEnv = process.env
) {
  let client: Awaited<ReturnType<typeof productImageServiceDb.connect>> | null = null

  try {
    client = await productImageServiceDb.connect()
    await client.query('begin')

    if (!(await productImageRepository.lockSkuForImageMutation(params.skuId, client))) {
      throw new ProductImageServiceError('sku not found', 404)
    }

    const activeImages = await loadActiveImagesOrThrow(params.skuId, client)
    const target = activeImages.find((row) => row.image_id === params.imageId)
    if (!target) {
      throw new ProductImageServiceError('product image not found', 404)
    }

    await productImageRepository.setProductImagePrimary(params.skuId, params.imageId, client)
    await client.query('commit')

    const images = resequenceSortOrder(
      activeImages.map((row) => ({
        image_id: row.image_id,
        sort_order: row.image_id === params.imageId ? row.sort_order : row.sort_order,
        is_primary: row.image_id === params.imageId,
      }))
    ).map((item) => {
      const row = activeImages.find((candidate) => candidate.image_id === item.image_id)!
      return toProductImageDto({
        ...row,
        sort_order: item.sort_order,
        is_primary: item.image_id === params.imageId,
      })
    })

    return { images }
  } catch (error) {
    await client?.query('rollback').catch(() => undefined)
    throw error
  } finally {
    client?.release()
  }
}

export async function reorderProductImages(
  params: { skuId: string; imageIds: string[] },
  env: NodeJS.ProcessEnv = process.env
) {
  if (!Array.isArray(params.imageIds) || params.imageIds.length === 0) {
    throw new ProductImageServiceError('imageIds are required', 400)
  }

  const requestedIds = params.imageIds.map((value) => String(value))
  const uniqueIds = new Set(requestedIds)
  if (uniqueIds.size !== requestedIds.length) {
    throw new ProductImageServiceError('imageIds must not contain duplicates', 400)
  }

  let client: Awaited<ReturnType<typeof productImageServiceDb.connect>> | null = null

  try {
    client = await productImageServiceDb.connect()
    await client.query('begin')

    if (!(await productImageRepository.lockSkuForImageMutation(params.skuId, client))) {
      throw new ProductImageServiceError('sku not found', 404)
    }

    const activeImages = await loadActiveImagesOrThrow(params.skuId, client)
    if (activeImages.length !== requestedIds.length) {
      throw new ProductImageServiceError('imageIds must include every active image', 400)
    }

    const byId = new Map(activeImages.map((row) => [row.image_id, row] as const))
    const ordered = requestedIds.map((imageId, index) => {
      const row = byId.get(imageId)
      if (!row) {
        throw new ProductImageServiceError(`unknown image id: ${imageId}`, 400)
      }
      return {
        image_id: row.image_id,
        sort_order: index + 1,
        is_primary: row.is_primary,
      }
    })

    const normalized = resequenceSortOrder(ordered)
    await productImageRepository.setProductImageSortOrders(
      params.skuId,
      normalized.map((item) => ({
        imageId: item.image_id,
        sortOrder: item.sort_order,
      })),
      client
    )
    await client.query('commit')

    return {
      images: normalized.map((item) => {
        const row = byId.get(item.image_id)!
        return toProductImageDto({
          ...row,
          sort_order: item.sort_order,
          is_primary: row.is_primary,
        })
      }),
    }
  } catch (error) {
    await client?.query('rollback').catch(() => undefined)
    throw error
  } finally {
    client?.release()
  }
}

export async function softDeleteProductImage(
  params: { skuId: string; imageId: string },
  env: NodeJS.ProcessEnv = process.env
) {
  let client: Awaited<ReturnType<typeof productImageServiceDb.connect>> | null = null
  let targetImage: ProductImageRow | null = null
  let remainingImages: ProductImageRow[] = []
  let restoreParams:
    | {
        originalRelpath: string
        thumbRelpath: string
        trashOriginalRelpath: string
        trashThumbRelpath: string
      }
    | null = null

  try {
    client = await productImageServiceDb.connect()
    await client.query('begin')

    if (!(await productImageRepository.lockSkuForImageMutation(params.skuId, client))) {
      throw new ProductImageServiceError('sku not found', 404)
    }

    const activeImages = await loadActiveImagesOrThrow(params.skuId, client)
    const target = activeImages.find((row) => row.image_id === params.imageId)
    if (!target) {
      throw new ProductImageServiceError('product image not found', 404)
    }
    targetImage = target
    remainingImages = activeImages.filter((row) => row.image_id !== params.imageId)

    const deletedAt = new Date()
    const moved = await productImageFileStore.movePersistedProductImageToTrash(
      {
        imageId: target.image_id,
        originalRelpath: target.original_relpath,
        thumbRelpath: target.thumb_relpath,
        deletedAt,
      },
      env
    )
    restoreParams = {
      originalRelpath: target.original_relpath,
      thumbRelpath: target.thumb_relpath,
      trashOriginalRelpath: moved.originalRelpath,
      trashThumbRelpath: moved.thumbRelpath,
    }

    await productImageRepository.markProductImageDeleted(
      {
        skuId: params.skuId,
        imageId: params.imageId,
        trashOriginalRelpath: moved.originalRelpath,
        trashThumbRelpath: moved.thumbRelpath,
        deletedAt,
      },
      client
    )

    const normalizedRemaining = resequenceSortOrder(
      remainingImages.map((row) => ({
        image_id: row.image_id,
        sort_order: Number(row.sort_order),
        is_primary: row.is_primary,
      }))
    )

    if (normalizedRemaining.length > 0) {
      await productImageRepository.setProductImageSortOrders(
        params.skuId,
        normalizedRemaining.map((item) => ({
          imageId: item.image_id,
          sortOrder: item.sort_order,
        })),
        client
      )
    }

    const nextPrimary =
      normalizedRemaining.find((row) => row.is_primary) ?? nextPrimaryAfterDelete(normalizedRemaining)

    if (nextPrimary) {
      await productImageRepository.setProductImagePrimary(params.skuId, nextPrimary.image_id, client)
    }

    await client.query('commit')
    return {
      ok: true,
      nextPrimaryImageId: nextPrimary?.image_id ?? null,
    }
  } catch (error) {
    await client?.query('rollback').catch(() => undefined)
    if (restoreParams) {
      try {
        await productImageFileStore.restorePersistedProductImageFromTrash(restoreParams, env)
      } catch (restoreError) {
        const details = [
          `sku=${params.skuId}`,
          `image=${targetImage?.image_id ?? params.imageId}`,
          `original=${restoreParams.originalRelpath}`,
          `thumb=${restoreParams.thumbRelpath}`,
          `trashOriginal=${restoreParams.trashOriginalRelpath}`,
          `trashThumb=${restoreParams.trashThumbRelpath}`,
        ].join(' ')
        throw new ProductImageServiceError(
          `product image delete rollback could not restore files (${details}): ${
            restoreError instanceof Error ? restoreError.message : String(restoreError)
          }`,
          500
        )
      }
    }
    throw error
  } finally {
    client?.release()
  }
}

export async function cleanupDeletedProductImages(
  options: {
    env?: NodeJS.ProcessEnv
    now?: Date
    trashRetentionDays?: number
  } = {}
) {
  const env = options.env ?? process.env
  const config = loadProductImageConfig(env)
  const now = options.now ?? new Date()
  const trashRetentionDays = options.trashRetentionDays ?? config.trashRetentionDays
  const cutoff = new Date(now.getTime() - trashRetentionDays * 24 * 60 * 60 * 1000)
  const deletedRows = await productImageRepository.listDeletedProductImages()
  const expiredRows = deletedRows.filter((row) => {
    if (!row.deleted_at) return false
    const deletedAt = new Date(row.deleted_at)
    return Number.isFinite(deletedAt.getTime()) && deletedAt < cutoff
  })

  for (const row of expiredRows) {
    await productImageFileStore.removeTrashFilePair(
      {
        originalRelpath: row.original_relpath,
        thumbRelpath: row.thumb_relpath,
      },
      env
    )
  }

  return {
    deletedFileCount: expiredRows.length * 2,
    imageCount: expiredRows.length,
  }
}

export {
  productImageRepository,
  productImageFileStore,
}
