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
})
