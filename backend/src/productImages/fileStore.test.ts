import assert from 'node:assert/strict'
import test from 'node:test'

import {
  movePersistedProductImageToTrash,
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
