import test from 'node:test'
import assert from 'node:assert/strict'
import { loadProductImageConfig } from './config.js'

test('loads product image config from env-like input', () => {
  const config = loadProductImageConfig({
    PRODUCT_IMAGE_ROOT: '/data/assets/products',
    PRODUCT_IMAGE_TMP_DIR: '/data/assets/uploads/tmp',
    PRODUCT_IMAGE_MAX_FILES: '12',
    PRODUCT_IMAGE_MAX_FILE_MB: '10',
    PRODUCT_IMAGE_ALLOWED_MIME: 'image/jpeg,image/png,image/webp',
    PRODUCT_IMAGE_THUMB_WIDTH: '480',
    PRODUCT_IMAGE_TRASH_RETENTION_DAYS: '30',
  })

  assert.equal(config.rootDir, '/data/assets/products')
  assert.equal(config.tmpDir, '/data/assets/uploads/tmp')
  assert.equal(config.maxFiles, 12)
  assert.equal(config.maxFileBytes, 10 * 1024 * 1024)
  assert.deepEqual(config.allowedMimeTypes, ['image/jpeg', 'image/png', 'image/webp'])
  assert.equal(config.thumbWidth, 480)
  assert.equal(config.trashRetentionDays, 30)
})

test('loads product image config defaults when env is empty', () => {
  const config = loadProductImageConfig({})

  assert.equal(config.rootDir, '/data/assets/products')
  assert.equal(config.tmpDir, '/data/assets/uploads/tmp')
  assert.equal(config.maxFiles, 12)
  assert.equal(config.maxFileBytes, 10 * 1024 * 1024)
  assert.deepEqual(config.allowedMimeTypes, ['image/jpeg', 'image/png', 'image/webp'])
  assert.equal(config.thumbWidth, 480)
  assert.equal(config.trashRetentionDays, 30)
})

test('rejects invalid numeric product image env values', () => {
  assert.throws(
    () =>
      loadProductImageConfig({
        PRODUCT_IMAGE_MAX_FILES: 'abc',
      }),
    /PRODUCT_IMAGE_MAX_FILES/
  )
})

test('rejects blank product image path values and empty mime allow-lists', () => {
  assert.throws(
    () =>
      loadProductImageConfig({
        PRODUCT_IMAGE_ROOT: '   ',
      }),
    /PRODUCT_IMAGE_ROOT/
  )

  assert.throws(
    () =>
      loadProductImageConfig({
        PRODUCT_IMAGE_TMP_DIR: '',
      }),
    /PRODUCT_IMAGE_TMP_DIR/
  )

  assert.throws(
    () =>
      loadProductImageConfig({
        PRODUCT_IMAGE_ALLOWED_MIME: ' , ',
      }),
    /PRODUCT_IMAGE_ALLOWED_MIME/
  )
})
