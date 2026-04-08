import assert from 'node:assert/strict'
import test from 'node:test'

import { buildSkuSuggestionSettingsPath } from './settingsApi'

test('buildSkuSuggestionSettingsPath includes scoped filters when provided', () => {
  const path = buildSkuSuggestionSettingsPath({
    attribute: 'color',
    scopeKey: '上衣',
    query: '米白',
    includeDisabled: true,
    limit: 50,
  })

  assert.equal(
    path,
    '/api/settings/sku-attribute-suggestions?attribute=color&scope_key=%E4%B8%8A%E8%A1%A3&query=%E7%B1%B3%E7%99%BD&include_disabled=true&limit=50'
  )
})

test('buildSkuSuggestionSettingsPath omits empty filters', () => {
  const path = buildSkuSuggestionSettingsPath({
    attribute: 'category',
    scopeKey: '   ',
    query: '',
    includeDisabled: false,
  })

  assert.equal(path, '/api/settings/sku-attribute-suggestions?attribute=category')
})
