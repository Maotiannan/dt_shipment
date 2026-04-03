import test from 'node:test'
import assert from 'node:assert/strict'

import { createApp } from './createApp.js'

test('createApp wires api routes without starting the listener', () => {
  const app = createApp()
  const routes = app.router.stack
    .filter((layer: any) => layer.route)
    .map((layer: any) => layer.route.path)

  assert.ok(routes.includes('/api/meta'))
  assert.ok(routes.includes('/api/health'))
  assert.ok(routes.includes('/api/auth/login'))
  assert.ok(routes.includes('/api/accounts/:id'))
  assert.ok(routes.includes('/api/orders/:id'))
})

test('createApp fails fast when product image config is invalid', () => {
  assert.throws(
    () =>
      createApp({
        PRODUCT_IMAGE_ROOT: ' ',
        PRODUCT_IMAGE_TMP_DIR: '/data/assets/uploads/tmp',
        PRODUCT_IMAGE_ALLOWED_MIME: 'image/jpeg',
      }),
    /PRODUCT_IMAGE_ROOT/
  )
})
