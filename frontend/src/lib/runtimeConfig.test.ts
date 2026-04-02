import assert from 'node:assert/strict'
import test from 'node:test'

import { buildAppMeta, resolveApiBase } from './runtimeConfig.js'

test('resolveApiBase defaults to same-origin root so existing /api paths stay intact', () => {
  assert.equal(resolveApiBase(undefined), '')
})

test('resolveApiBase trims explicit api base trailing slash', () => {
  assert.equal(resolveApiBase('https://api.example.com/'), 'https://api.example.com')
})

test('buildAppMeta exposes a frontend-safe version label', () => {
  assert.deepEqual(buildAppMeta('发货管家', '1.2.3'), {
    name: '发货管家',
    version: '1.2.3',
    versionLabel: 'v1.2.3',
  })
})
