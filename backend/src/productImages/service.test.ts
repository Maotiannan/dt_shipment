import assert from 'node:assert/strict'
import test from 'node:test'

import {
  cleanupDeletedProductImages,
  reorderProductImages,
  productImageServiceDb,
  softDeleteProductImage,
} from './service.js'
import { productImageFileStore } from './fileStore.js'
import { productImageRepository } from './repository.js'

type ImageRow = {
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
  deleted_at?: string | null
  created_at: string
  updated_at: string
}

function createMockClient() {
  return {
    async query() {
      return { rows: [] }
    },
    release() {
      return undefined
    },
  }
}

type MovePersistedToTrashInput = {
  imageId: string
  originalRelpath: string
  thumbRelpath: string
  deletedAt?: Date
}

type SetSortOrdersUpdates = Array<{ imageId: string; sortOrder: number }>

type MarkDeletedInput = {
  skuId: string
  imageId: string
  trashOriginalRelpath: string
  trashThumbRelpath: string
  deletedAt: Date
}

type RemoveTrashInput = {
  originalRelpath?: string
  thumbRelpath?: string
}

type RestoreFromTrashInput = {
  originalRelpath: string
  thumbRelpath: string
  trashOriginalRelpath: string
  trashThumbRelpath: string
}

function makeImageRow(
  overrides: Partial<ImageRow> & Pick<ImageRow, 'image_id' | 'sort_order' | 'is_primary'>
): ImageRow {
  return {
    image_id: overrides.image_id,
    sku_id: overrides.sku_id ?? 'sku-1',
    storage_key: overrides.storage_key ?? `product-images/${overrides.sku_id ?? 'sku-1'}/${overrides.image_id}`,
    original_relpath: overrides.original_relpath ?? `original/${overrides.sku_id ?? 'sku-1'}/${overrides.image_id}.png`,
    thumb_relpath: overrides.thumb_relpath ?? `thumb/${overrides.sku_id ?? 'sku-1'}/${overrides.image_id}.jpg`,
    mime_type: overrides.mime_type ?? 'image/png',
    file_ext: overrides.file_ext ?? '.png',
    file_size: overrides.file_size ?? 128,
    width: overrides.width ?? 100,
    height: overrides.height ?? 100,
    sha256: overrides.sha256 ?? `${overrides.image_id}-sha`,
    sort_order: overrides.sort_order,
    is_primary: overrides.is_primary,
    status: overrides.status ?? 'active',
    deleted_at: overrides.deleted_at ?? null,
    created_at: overrides.created_at ?? '2026-04-02T00:00:00.000Z',
    updated_at: overrides.updated_at ?? '2026-04-02T00:00:00.000Z',
  }
}

test('softDeleteProductImage promotes the first surviving active image when deleting the primary', async (t) => {
  const fileMoves: Array<{ imageId: string; kind: string }> = []
  const sortUpdates: Array<Array<{ imageId: string; sortOrder: number }>> = []
  const client = createMockClient()

  t.mock.method(productImageServiceDb, 'connect', async () => client)
  t.mock.method(productImageRepository, 'lockSkuForImageMutation', async () => true)
  t.mock.method(productImageRepository, 'listActiveProductImages', async () => [
    makeImageRow({ image_id: 'primary', sort_order: 1, is_primary: true }),
    makeImageRow({ image_id: 'second', sort_order: 2, is_primary: false }),
    makeImageRow({ image_id: 'third', sort_order: 3, is_primary: false }),
  ])
  t.mock.method(productImageRepository, 'getActiveProductImageById', async () =>
    makeImageRow({ image_id: 'primary', sort_order: 1, is_primary: true })
  )
  t.mock.method(productImageRepository, 'markProductImageDeleted', async () => undefined)
  t.mock.method(
    productImageRepository,
    'setProductImageSortOrders',
    async (_skuId: string, updates: SetSortOrdersUpdates) => {
      sortUpdates.push(updates)
      return undefined
    }
  )
  t.mock.method(productImageRepository, 'setProductImagePrimary', async () => undefined)
  t.mock.method(
    productImageFileStore,
    'movePersistedProductImageToTrash',
    async (input: MovePersistedToTrashInput) => {
    fileMoves.push({ imageId: input.imageId, kind: 'trash' })
    return {
      originalRelpath: 'trash/2026/04/primary.png',
      thumbRelpath: 'trash/2026/04/primary.jpg',
      originalAbsPath: '/tmp/trash/primary.png',
      thumbAbsPath: '/tmp/trash/primary.jpg',
    }
    }
  )

  const result = await softDeleteProductImage({ skuId: 'sku-1', imageId: 'primary' })

  assert.equal(result.nextPrimaryImageId, 'second')
  assert.deepEqual(fileMoves, [{ imageId: 'primary', kind: 'trash' }])
  assert.deepEqual(sortUpdates, [[
    { imageId: 'second', sortOrder: 1 },
    { imageId: 'third', sortOrder: 2 },
  ]])
})

test('reorderProductImages keeps a single image stable at the boundary', async (t) => {
  const client = createMockClient()

  t.mock.method(productImageServiceDb, 'connect', async () => client)
  t.mock.method(productImageRepository, 'lockSkuForImageMutation', async () => true)
  t.mock.method(productImageRepository, 'listActiveProductImages', async () => [
    makeImageRow({ image_id: 'only', sort_order: 1, is_primary: true }),
  ])
  t.mock.method(productImageRepository, 'setProductImageSortOrders', async () => undefined)

  const result = await reorderProductImages({
    skuId: 'sku-1',
    imageIds: ['only'],
  })

  assert.deepEqual(
    result.images.map((image) => [image.image_id, image.sort_order, image.is_primary]),
    [['only', 1, true]]
  )
})

test('reorderProductImages resequences sort_order without losing the primary image', async (t) => {
  const updateCalls: Array<Array<{ imageId: string; sortOrder: number }>> = []
  const client = createMockClient()

  t.mock.method(productImageServiceDb, 'connect', async () => client)
  t.mock.method(productImageRepository, 'lockSkuForImageMutation', async () => true)
  t.mock.method(productImageRepository, 'listActiveProductImages', async () => [
    makeImageRow({ image_id: 'a', sort_order: 1, is_primary: true }),
    makeImageRow({ image_id: 'b', sort_order: 2, is_primary: false }),
    makeImageRow({ image_id: 'c', sort_order: 3, is_primary: false }),
  ])
  t.mock.method(
    productImageRepository,
    'setProductImageSortOrders',
    async (_skuId: string, updates: SetSortOrdersUpdates) => {
    updateCalls.push(updates)
    return undefined
    }
  )

  const result = await reorderProductImages({
    skuId: 'sku-1',
    imageIds: ['c', 'a', 'b'],
  })

  assert.deepEqual(
    result.images.map((image) => [image.image_id, image.sort_order, image.is_primary]),
    [
      ['c', 1, false],
      ['a', 2, true],
      ['b', 3, false],
    ]
  )
  assert.deepEqual(updateCalls, [[
    { imageId: 'c', sortOrder: 1 },
    { imageId: 'a', sortOrder: 2 },
    { imageId: 'b', sortOrder: 3 },
  ]])
})

test('softDeleteProductImage moves files to trash and marks the row deleted', async (t) => {
  const deletedPayloads: MarkDeletedInput[] = []
  const client = createMockClient()

  t.mock.method(productImageServiceDb, 'connect', async () => client)
  t.mock.method(productImageRepository, 'lockSkuForImageMutation', async () => true)
  t.mock.method(productImageRepository, 'listActiveProductImages', async () => [
    makeImageRow({ image_id: 'a', sort_order: 1, is_primary: true }),
    makeImageRow({ image_id: 'b', sort_order: 2, is_primary: false }),
  ])
  t.mock.method(productImageRepository, 'getActiveProductImageById', async () =>
    makeImageRow({ image_id: 'a', sort_order: 1, is_primary: true })
  )
  t.mock.method(productImageFileStore, 'movePersistedProductImageToTrash', async () => ({
    originalRelpath: 'trash/2026/04/a.png',
    thumbRelpath: 'trash/2026/04/a.jpg',
    originalAbsPath: '/tmp/trash/a.png',
    thumbAbsPath: '/tmp/trash/a.jpg',
  }))
  t.mock.method(productImageRepository, 'markProductImageDeleted', async (payload: MarkDeletedInput) => {
    deletedPayloads.push(payload)
    return undefined
  })
  t.mock.method(productImageRepository, 'setProductImagePrimary', async () => undefined)

  const result = await softDeleteProductImage({ skuId: 'sku-1', imageId: 'a' })

  assert.equal(result.ok, true)
  assert.equal(result.nextPrimaryImageId, 'b')
  const deleted = deletedPayloads[0]
  assert.ok(deleted, 'expected deleted payload')
  assert.equal(deleted.skuId, 'sku-1')
  assert.equal(deleted.imageId, 'a')
  assert.match(deleted.trashOriginalRelpath, /trash\/\d{4}\/\d{2}\/a\.png/)
  assert.match(deleted.trashThumbRelpath, /trash\/\d{4}\/\d{2}\/a\.jpg/)
  assert.ok(deleted.deletedAt instanceof Date)
})

test('cleanupDeletedProductImages only removes trash files outside the retention window', async (t) => {
  const removed: string[] = []

  t.mock.method(productImageRepository, 'listDeletedProductImages', async () => [
    makeImageRow({
      image_id: 'expired',
      sort_order: 1,
      is_primary: false,
      status: 'deleted',
      original_relpath: 'trash/2026/02/expired.png',
      thumb_relpath: 'trash/2026/02/expired.jpg',
      deleted_at: '2026-02-01T00:00:00.000Z',
    }),
    makeImageRow({
      image_id: 'fresh',
      sort_order: 2,
      is_primary: false,
      status: 'deleted',
      original_relpath: 'trash/2026/03/fresh.png',
      thumb_relpath: 'trash/2026/03/fresh.jpg',
      deleted_at: '2026-03-31T23:59:59.000Z',
    }),
  ])
  t.mock.method(productImageFileStore, 'removeTrashFilePair', async (paths: RemoveTrashInput) => {
    if (!paths.originalRelpath) {
      throw new Error('expected originalRelpath')
    }
    removed.push(paths.originalRelpath)
  })

  const result = await cleanupDeletedProductImages({
    trashRetentionDays: 30,
    now: new Date('2026-04-02T00:00:00.000Z'),
  })

  assert.equal(result.imageCount, 1)
  assert.equal(result.deletedFileCount, 2)
  assert.deepEqual(removed, ['trash/2026/02/expired.png'])
})

test('softDeleteProductImage restores files when the database update fails after moving to trash', async (t) => {
  const restored: RestoreFromTrashInput[] = []
  const client = createMockClient()

  t.mock.method(productImageServiceDb, 'connect', async () => client)
  t.mock.method(productImageRepository, 'lockSkuForImageMutation', async () => true)
  t.mock.method(productImageRepository, 'listActiveProductImages', async () => [
    makeImageRow({ image_id: 'a', sort_order: 1, is_primary: true }),
  ])
  t.mock.method(productImageFileStore, 'movePersistedProductImageToTrash', async () => ({
    originalRelpath: 'trash/2026/04/a.png',
    thumbRelpath: 'trash/2026/04/a.jpg',
    originalAbsPath: '/tmp/trash/a.png',
    thumbAbsPath: '/tmp/trash/a.jpg',
  }))
  t.mock.method(productImageRepository, 'markProductImageDeleted', async () => {
    throw new Error('db write failed')
  })
  t.mock.method(
    productImageFileStore,
    'restorePersistedProductImageFromTrash',
    async (payload: RestoreFromTrashInput) => {
      restored.push(payload)
    }
  )

  await assert.rejects(
    () => softDeleteProductImage({ skuId: 'sku-1', imageId: 'a' }),
    /db write failed/
  )

  assert.deepEqual(restored, [
    {
      originalRelpath: 'original/sku-1/a.png',
      thumbRelpath: 'thumb/sku-1/a.jpg',
      trashOriginalRelpath: 'trash/2026/04/a.png',
      trashThumbRelpath: 'trash/2026/04/a.jpg',
    },
  ])
})

test('softDeleteProductImage surfaces restore failures after rollback', async (t) => {
  const client = createMockClient()

  t.mock.method(productImageServiceDb, 'connect', async () => client)
  t.mock.method(productImageRepository, 'lockSkuForImageMutation', async () => true)
  t.mock.method(productImageRepository, 'listActiveProductImages', async () => [
    makeImageRow({ image_id: 'a', sort_order: 1, is_primary: true }),
  ])
  t.mock.method(productImageFileStore, 'movePersistedProductImageToTrash', async () => ({
    originalRelpath: 'trash/2026/04/a.png',
    thumbRelpath: 'trash/2026/04/a.jpg',
    originalAbsPath: '/tmp/trash/a.png',
    thumbAbsPath: '/tmp/trash/a.jpg',
  }))
  t.mock.method(productImageRepository, 'markProductImageDeleted', async () => {
    throw new Error('db write failed')
  })
  t.mock.method(productImageFileStore, 'restorePersistedProductImageFromTrash', async () => {
    throw new Error('restore failed')
  })

  await assert.rejects(
    () => softDeleteProductImage({ skuId: 'sku-1', imageId: 'a' }),
    /rollback could not restore files/
  )
})
