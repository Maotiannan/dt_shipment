import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createDefaultCommerceSettings,
  normalizeCommerceSettingsPayload,
  normalizeCommerceSettingsResponse,
} from './commerceSettingsApi'

test('createDefaultCommerceSettings uses internal sources by default', () => {
  assert.deepEqual(createDefaultCommerceSettings(), {
    catalog_source: 'internal_db',
    inventory_source: 'internal_ledger',
    effective_catalog_source: 'internal_db',
    effective_inventory_source: 'internal_ledger',
    catalog_adapter_ready: true,
    inventory_adapter_ready: true,
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
    effective_catalog_source: 'internal_db',
    effective_inventory_source: 'internal_ledger',
    catalog_adapter_ready: false,
    inventory_adapter_ready: false,
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

test('normalizeCommerceSettingsResponse keeps requested and effective source state', () => {
  const response = normalizeCommerceSettingsResponse({
    catalog_source: 'odoo',
    inventory_source: 'odoo',
    effective_catalog_source: 'internal_db',
    effective_inventory_source: 'internal_ledger',
    catalog_adapter_ready: false,
    inventory_adapter_ready: false,
    external_system: 'odoo',
    odoo_base_url: ' https://erp.example.com ',
    odoo_database: null,
    odoo_api_mode: 'rpc_legacy',
    notes: ' pending adapter ',
    updated_at: '2026-04-10T08:00:00.000Z',
  })

  assert.equal(response.catalog_source, 'odoo')
  assert.equal(response.inventory_source, 'odoo')
  assert.equal(response.effective_catalog_source, 'internal_db')
  assert.equal(response.effective_inventory_source, 'internal_ledger')
  assert.equal(response.catalog_adapter_ready, false)
  assert.equal(response.inventory_adapter_ready, false)
  assert.equal(response.odoo_base_url, 'https://erp.example.com')
  assert.equal(response.notes, 'pending adapter')
})
