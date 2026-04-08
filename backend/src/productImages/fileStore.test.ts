import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import sharp from 'sharp'

import {
  movePersistedProductImageToTrash,
  persistProductImage,
  productImageFileIo,
  restorePersistedProductImageFromTrash,
} from './fileStore.js'

test('movePersistedProductImageToTrash tolerates missing original files when the thumb still exists', async (t) => {
  const renameCalls: Array<{ from: string; to: string }> = []
  let renameCount = 0

  t.mock.method(productImageFileIo, 'mkdir', async () => undefined)
  t.mock.method(productImageFileIo, 'rename', async (from: string, to: string) => {
    renameCalls.push({ from, to })
    renameCount += 1

    if (renameCount === 1) {
      const error = new Error('missing original file') as Error & { code?: string }
      error.code = 'ENOENT'
      throw error
    }
  })

  const moved = await movePersistedProductImageToTrash(
    {
      imageId: 'a',
      originalRelpath: 'original/sku-1/a.png',
      thumbRelpath: 'thumb/sku-1/a.jpg',
      deletedAt: new Date('2026-04-03T00:00:00.000Z'),
    },
    {
      PRODUCT_IMAGE_ROOT: '/tmp/product-images',
    }
  )

  assert.deepEqual(moved, {
    originalRelpath: 'trash/2026/04/a.png',
    thumbRelpath: 'trash/2026/04/a.jpg',
    originalAbsPath: '/tmp/product-images/trash/2026/04/a.png',
    thumbAbsPath: '/tmp/product-images/trash/2026/04/a.jpg',
  })
  assert.deepEqual(renameCalls, [
    {
      from: '/tmp/product-images/original/sku-1/a.png',
      to: '/tmp/product-images/trash/2026/04/a.png',
    },
    {
      from: '/tmp/product-images/thumb/sku-1/a.jpg',
      to: '/tmp/product-images/trash/2026/04/a.jpg',
    },
  ])
})

test('restorePersistedProductImageFromTrash rolls back partial restore when thumb rename fails', async (t) => {
  const renameCalls: Array<{ from: string; to: string }> = []
  let renameCount = 0

  t.mock.method(productImageFileIo, 'mkdir', async () => undefined)
  t.mock.method(productImageFileIo, 'rename', async (from: string, to: string) => {
    renameCalls.push({ from, to })
    renameCount += 1

    if (renameCount === 2) {
      throw new Error('thumb restore failed')
    }
  })

  await assert.rejects(
    () =>
      restorePersistedProductImageFromTrash(
        {
          originalRelpath: 'original/sku-1/a.png',
          thumbRelpath: 'thumb/sku-1/a.jpg',
          trashOriginalRelpath: 'trash/2026/04/a.png',
          trashThumbRelpath: 'trash/2026/04/a.jpg',
        },
        {
          PRODUCT_IMAGE_ROOT: '/tmp/product-images',
        }
      ),
    /thumb restore failed/
  )

  assert.deepEqual(renameCalls, [
    {
      from: '/tmp/product-images/trash/2026/04/a.png',
      to: '/tmp/product-images/original/sku-1/a.png',
    },
    {
      from: '/tmp/product-images/trash/2026/04/a.jpg',
      to: '/tmp/product-images/thumb/sku-1/a.jpg',
    },
    {
      from: '/tmp/product-images/original/sku-1/a.png',
      to: '/tmp/product-images/trash/2026/04/a.png',
    },
  ])
})

test('persistProductImage optimizes original dimensions before storing the original asset', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'dt-shipment-file-store-root-'))
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'dt-shipment-file-store-upload-'))
  const sourcePath = path.join(uploadDir, 'source.jpg')

  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true })
    await rm(uploadDir, { recursive: true, force: true })
  })

  const sourceBuffer = await sharp({
    create: {
      width: 600,
      height: 400,
      channels: 3,
      background: '#ffcc00',
    },
  })
    .jpeg({ quality: 100 })
    .toBuffer()

  await writeFile(sourcePath, sourceBuffer)

  const stored = await persistProductImage(
    {
      skuId: '11111111-1111-1111-1111-111111111111',
      imageId: '22222222-2222-2222-2222-222222222222',
      sourcePath,
      originalFilename: 'cover.jpg',
      mimeType: 'image/jpeg',
    },
    {
      PRODUCT_IMAGE_ROOT: rootDir,
      PRODUCT_IMAGE_TMP_DIR: uploadDir,
      PRODUCT_IMAGE_ALLOWED_MIME: 'image/jpeg',
      PRODUCT_IMAGE_THUMB_WIDTH: '80',
      PRODUCT_IMAGE_ORIGINAL_MAX_WIDTH: '120',
      PRODUCT_IMAGE_ORIGINAL_JPEG_QUALITY: '72',
    }
  )

  const originalBuffer = await readFile(stored.originalAbsPath)
  const metadata = await sharp(originalBuffer).metadata()

  assert.equal(stored.fileExt, '.jpg')
  assert.equal(stored.mimeType, 'image/jpeg')
  assert.equal(metadata.width, 120)
  assert.equal(stored.width, 120)
  assert.equal(stored.height, 80)
  assert.ok(stored.fileSize < sourceBuffer.byteLength)
})
