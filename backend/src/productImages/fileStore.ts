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
  fileExt: string
  fileSize: number
  width: number
  height: number
  sha256: string
}

function fileExtensionFromMime(mimeType: string) {
  if (mimeType === 'image/png') return '.png'
  if (mimeType === 'image/webp') return '.webp'
  return '.jpg'
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
  const ext = path.extname(params.originalFilename).toLowerCase() || fileExtensionFromMime(params.mimeType)
  const originalRelpath = path.posix.join('original', params.skuId, `${params.imageId}${ext}`)
  const thumbRelpath = path.posix.join('thumb', params.skuId, `${params.imageId}.jpg`)
  const originalAbsPath = resolveWithinRoot(config.rootDir, originalRelpath)
  const thumbAbsPath = resolveWithinRoot(config.rootDir, thumbRelpath)
  const fileBuffer = await fs.readFile(params.sourcePath)

  await fs.mkdir(path.dirname(originalAbsPath), { recursive: true })
  await fs.mkdir(path.dirname(thumbAbsPath), { recursive: true })
  await fs.writeFile(originalAbsPath, fileBuffer)

  const originalImage = sharp(fileBuffer)
  const metadata = await originalImage.metadata()
  await originalImage
    .resize({ width: config.thumbWidth, withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toFile(thumbAbsPath)

  return {
    originalRelpath,
    thumbRelpath,
    originalAbsPath,
    thumbAbsPath,
    fileExt: ext,
    fileSize: fileBuffer.byteLength,
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    sha256: crypto.createHash('sha256').update(fileBuffer).digest('hex'),
  }
}

export async function readStoredProductImage(
  relpath: string,
  env: NodeJS.ProcessEnv = process.env
) {
  const config = loadProductImageConfig(env)
  const absolutePath = resolveWithinRoot(config.rootDir, relpath)
  return fs.readFile(absolutePath)
}

export async function removePersistedProductImage(paths: {
  originalAbsPath?: string
  thumbAbsPath?: string
}) {
  await Promise.all([
    paths.originalAbsPath ? fs.rm(paths.originalAbsPath, { force: true }) : Promise.resolve(),
    paths.thumbAbsPath ? fs.rm(paths.thumbAbsPath, { force: true }) : Promise.resolve(),
  ])
}
