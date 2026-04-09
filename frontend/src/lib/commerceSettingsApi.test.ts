import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createDefaultCommerceSettings,
  normalizeCommerceSettingsPayload,
} from './commerceSettingsApi'

test('createDefaultCommerceSettings uses internal sources by default', () => {
  assert.deepEqual(createDefaultCommerceSettings(), {
    catalog_source: 'internal_db',
    inventory_source: 'internal_ledger',
    external_system: 'odoo',
    odoo_base_url: '',
    odoo_database: '',
    odoo_api_mode: 'json2',
    notes: '',
    updated_at: null,
  })
})

test('normalizeCommerceSettingsPayload trims blank odoo fields to null', () => {
  const payload = normalizeCommerceSettingsPayload({
    catalog_source: 'odoo',
    inventory_source: 'odoo',
    external_system: 'odoo',
    odoo_base_url: ' https://erp.example.com ',
    odoo_database: '   ',
    odoo_api_mode: 'rpc_legacy',
    notes: ' future source ',
    updated_at: null,
  })

  assert.deepEqual(payload, {
    catalog_source: 'odoo',
    inventory_source: 'odoo',
    external_system: 'odoo',
    odoo_base_url: 'https://erp.example.com',
    odoo_database: null,
    odoo_api_mode: 'rpc_legacy',
    notes: 'future source',
  })
})
