import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

import { loadProductImageConfig } from './config.js'

export type PersistedProductImageFile = {
  originalRelpath: string
  thumbRelpath: string
  originalAbsPath: string
  thumbAbsPath: string
  mimeType: string
  fileExt: string
  fileSize: number
  width: number
  height: number
  sha256: string
}

export class InvalidProductImageFileError extends Error {
  constructor(message = 'uploaded file is not a valid image') {
    super(message)
  }
}

export const productImageFileIo = {
  readFile: fs.readFile.bind(fs),
  writeFile: fs.writeFile.bind(fs),
  mkdir: fs.mkdir.bind(fs),
  rename: fs.rename.bind(fs),
  rm: fs.rm.bind(fs),
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function fileExtensionFromMime(mimeType: string) {
  if (mimeType === 'image/png') return '.png'
  if (mimeType === 'image/webp') return '.webp'
  return '.jpg'
}

function outputFormatForMetadata(metadata: sharp.Metadata) {
  if (metadata.hasAlpha) {
    return {
      mimeType: 'image/webp',
      fileExt: '.webp',
    } as const
  }

  return {
    mimeType: 'image/jpeg',
    fileExt: '.jpg',
  } as const
}

function resolveWithinRoot(rootDir: string, relpath: string) {
  const absolutePath = path.resolve(rootDir, relpath)
  const normalizedRoot = `${path.resolve(rootDir)}${path.sep}`
  if (!absolutePath.startsWith(normalizedRoot)) {
    throw new Error('product image path escaped configured root')
  }
  return absolutePath
}

export async function persistProductImage(
  params: {
    skuId: string
    imageId: string
    sourcePath: string
    originalFilename: string
    mimeType: string
  },
  env: NodeJS.ProcessEnv = process.env
): Promise<PersistedProductImageFile> {
  const config = loadProductImageConfig(env)
  const fileBuffer = await productImageFileIo.readFile(params.sourcePath)
  let metadata: sharp.Metadata
  let optimizedOriginalBuffer: Buffer
  let thumbBuffer: Buffer
  let mimeType = params.mimeType
  let fileExt = path.extname(params.originalFilename).toLowerCase() || fileExtensionFromMime(params.mimeType)

  try {
    const image = sharp(fileBuffer).rotate()
    metadata = await image.metadata()
    const format = outputFormatForMetadata(metadata)
    mimeType = format.mimeType
    fileExt = format.fileExt

    let originalPipeline = sharp(fileBuffer).rotate()
    if ((metadata.width ?? 0) > config.originalMaxWidth) {
      originalPipeline = originalPipeline.resize({
        width: config.originalMaxWidth,
        withoutEnlargement: true,
      })
    }

    optimizedOriginalBuffer =
      format.mimeType === 'image/webp'
        ? await originalPipeline.webp({ quality: config.originalWebpQuality }).toBuffer()
        : await originalPipeline.jpeg({ quality: config.originalJpegQuality, mozjpeg: true }).toBuffer()

    metadata = await sharp(optimizedOriginalBuffer).metadata()
    thumbBuffer = await sharp(optimizedOriginalBuffer)
      .resize({ width: config.thumbWidth, withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer()
  } catch {
    throw new InvalidProductImageFileError()
  }

  const originalRelpath = path.posix.join('original', params.skuId, `${params.imageId}${fileExt}`)
  const thumbRelpath = path.posix.join('thumb', params.skuId, `${params.imageId}.jpg`)
  const originalAbsPath = resolveWithinRoot(config.rootDir, originalRelpath)
  const thumbAbsPath = resolveWithinRoot(config.rootDir, thumbRelpath)

  await productImageFileIo.mkdir(path.dirname(originalAbsPath), { recursive: true })
  await productImageFileIo.mkdir(path.dirname(thumbAbsPath), { recursive: true })

  try {
    await Promise.all([
      productImageFileIo.writeFile(originalAbsPath, optimizedOriginalBuffer),
      productImageFileIo.writeFile(thumbAbsPath, thumbBuffer),
    ])
  } catch (error) {
    await removePersistedProductImage({ originalAbsPath, thumbAbsPath }).catch(() => undefined)
    throw error
  }

  return {
    originalRelpath,
    thumbRelpath,
    originalAbsPath,
    thumbAbsPath,
    mimeType,
    fileExt,
    fileSize: optimizedOriginalBuffer.byteLength,
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    sha256: crypto.createHash('sha256').update(optimizedOriginalBuffer).digest('hex'),
  }
}

export async function readStoredProductImage(
  relpath: string,
  env: NodeJS.ProcessEnv = process.env
) {
  const config = loadProductImageConfig(env)
  const absolutePath = resolveWithinRoot(config.rootDir, relpath)
  return productImageFileIo.readFile(absolutePath)
}

export async function removePersistedProductImage(paths: {
  originalAbsPath?: string
  thumbAbsPath?: string
}) {
  await Promise.all([
    paths.originalAbsPath ? productImageFileIo.rm(paths.originalAbsPath, { force: true }) : Promise.resolve(),
    paths.thumbAbsPath ? productImageFileIo.rm(paths.thumbAbsPath, { force: true }) : Promise.resolve(),
  ])
}

export async function movePersistedProductImageToTrash(
  params: {
    imageId: string
    originalRelpath: string
    thumbRelpath: string
    deletedAt?: Date
  },
  env: NodeJS.ProcessEnv = process.env
) {
  const config = loadProductImageConfig(env)
  const deletedAt = params.deletedAt ?? new Date()
  const year = String(deletedAt.getUTCFullYear())
  const month = String(deletedAt.getUTCMonth() + 1).padStart(2, '0')
  const fileExt = path.extname(params.originalRelpath) || '.jpg'
  const originalAbsPath = resolveWithinRoot(config.rootDir, params.originalRelpath)
  const thumbAbsPath = resolveWithinRoot(config.rootDir, params.thumbRelpath)
  const trashOriginalRelpath = path.posix.join('trash', year, month, `${params.imageId}${fileExt}`)
  const trashThumbRelpath = path.posix.join('trash', year, month, `${params.imageId}.jpg`)
  const trashOriginalAbsPath = resolveWithinRoot(config.rootDir, trashOriginalRelpath)
  const trashThumbAbsPath = resolveWithinRoot(config.rootDir, trashThumbRelpath)
  const movedPairs: Array<{ from: string; to: string }> = []

  await productImageFileIo.mkdir(path.dirname(trashOriginalAbsPath), { recursive: true })
  await productImageFileIo.mkdir(path.dirname(trashThumbAbsPath), { recursive: true })

  try {
    try {
      await productImageFileIo.rename(originalAbsPath, trashOriginalAbsPath)
      movedPairs.push({ from: trashOriginalAbsPath, to: originalAbsPath })
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error
      }
    }

    try {
      await productImageFileIo.rename(thumbAbsPath, trashThumbAbsPath)
      movedPairs.push({ from: trashThumbAbsPath, to: thumbAbsPath })
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error
      }
    }
  } catch (error) {
    for (const pair of movedPairs.reverse()) {
      await productImageFileIo.rename(pair.from, pair.to).catch(() => undefined)
    }
    throw error
  }

  return {
    originalRelpath: trashOriginalRelpath,
    thumbRelpath: trashThumbRelpath,
    originalAbsPath: trashOriginalAbsPath,
    thumbAbsPath: trashThumbAbsPath,
  }
}

export async function removeTrashFilePair(paths: {
  originalRelpath?: string
  thumbRelpath?: string
}, env: NodeJS.ProcessEnv = process.env) {
  const config = loadProductImageConfig(env)
  await Promise.all([
    paths.originalRelpath
      ? productImageFileIo.rm(resolveWithinRoot(config.rootDir, paths.originalRelpath), { force: true })
      : Promise.resolve(),
    paths.thumbRelpath
      ? productImageFileIo.rm(resolveWithinRoot(config.rootDir, paths.thumbRelpath), { force: true })
    : Promise.resolve(),
  ])
}

export async function restorePersistedProductImageFromTrash(
  params: {
    originalRelpath: string
    thumbRelpath: string
    trashOriginalRelpath: string
    trashThumbRelpath: string
  },
  env: NodeJS.ProcessEnv = process.env
) {
  const config = loadProductImageConfig(env)
  const originalAbsPath = resolveWithinRoot(config.rootDir, params.originalRelpath)
  const thumbAbsPath = resolveWithinRoot(config.rootDir, params.thumbRelpath)
  const trashOriginalAbsPath = resolveWithinRoot(config.rootDir, params.trashOriginalRelpath)
  const trashThumbAbsPath = resolveWithinRoot(config.rootDir, params.trashThumbRelpath)
  const movedPairs: Array<{ from: string; to: string }> = []

  await productImageFileIo.mkdir(path.dirname(originalAbsPath), { recursive: true })
  await productImageFileIo.mkdir(path.dirname(thumbAbsPath), { recursive: true })

  try {
    await productImageFileIo.rename(trashOriginalAbsPath, originalAbsPath)
    movedPairs.push({ from: originalAbsPath, to: trashOriginalAbsPath })

    await productImageFileIo.rename(trashThumbAbsPath, thumbAbsPath)
    movedPairs.push({ from: thumbAbsPath, to: trashThumbAbsPath })
  } catch (error) {
    for (const pair of movedPairs.reverse()) {
      await productImageFileIo.rename(pair.from, pair.to).catch(() => undefined)
    }
    throw error
  }
}

export const productImageFileStore = {
  persistProductImage,
  readStoredProductImage,
  removePersistedProductImage,
  movePersistedProductImageToTrash,
  removeTrashFilePair,
  restorePersistedProductImageFromTrash,
}
