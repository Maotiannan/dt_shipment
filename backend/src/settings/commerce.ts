import type { Pool, PoolClient } from 'pg'

import { readAppSetting, upsertAppSetting } from './appSettings.js'

type CommerceQueryClient = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>

export type CatalogSource = 'internal_db' | 'odoo'
export type InventorySource = 'internal_ledger' | 'odoo'
export type ExternalSystem = 'odoo'
export type OdooApiMode = 'json2' | 'rpc_legacy'

export type CommerceSettings = {
  catalog_source: CatalogSource
  inventory_source: InventorySource
  external_system: ExternalSystem
  odoo_base_url: string | null
  odoo_database: string | null
  odoo_api_mode: OdooApiMode
  notes: string | null
  updated_at: string | null
}

export type CommerceSettingsView = CommerceSettings & {
  effective_catalog_source: CatalogSource
  effective_inventory_source: InventorySource
  catalog_adapter_ready: boolean
  inventory_adapter_ready: boolean
}

const SETTING_KEY = 'commerce_settings'

export const DEFAULT_COMMERCE_SETTINGS: CommerceSettings = {
  catalog_source: 'internal_db',
  inventory_source: 'internal_ledger',
  external_system: 'odoo',
  odoo_base_url: null,
  odoo_database: null,
  odoo_api_mode: 'json2',
  notes: null,
  updated_at: null,
}

function normalizeOptionalText(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized ? normalized : null
}

export function normalizeCommerceSettingsInput(
  input: unknown,
  base: CommerceSettings = DEFAULT_COMMERCE_SETTINGS
) {
  const body = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}

  const catalogSource = body.catalog_source ?? base.catalog_source
  if (catalogSource !== 'internal_db' && catalogSource !== 'odoo') {
    throw new Error('catalog_source must be one of: internal_db, odoo')
  }

  const inventorySource = body.inventory_source ?? base.inventory_source
  if (inventorySource !== 'internal_ledger' && inventorySource !== 'odoo') {
    throw new Error('inventory_source must be one of: internal_ledger, odoo')
  }

  const externalSystem = body.external_system ?? base.external_system
  if (externalSystem !== 'odoo') {
    throw new Error('external_system must be: odoo')
  }

  const odooApiMode = body.odoo_api_mode ?? base.odoo_api_mode
  if (odooApiMode !== 'json2' && odooApiMode !== 'rpc_legacy') {
    throw new Error('odoo_api_mode must be one of: json2, rpc_legacy')
  }

  return {
    ...base,
    catalog_source: catalogSource,
    inventory_source: inventorySource,
    external_system: externalSystem,
    odoo_base_url: normalizeOptionalText(body.odoo_base_url ?? base.odoo_base_url),
    odoo_database: normalizeOptionalText(body.odoo_database ?? base.odoo_database),
    odoo_api_mode: odooApiMode,
    notes: normalizeOptionalText(body.notes ?? base.notes),
  } satisfies CommerceSettings
}

export async function getCommerceSettings(client: CommerceQueryClient) {
  const row = await readAppSetting<Omit<CommerceSettings, 'updated_at'>>(client, SETTING_KEY)
  if (!row) {
    return DEFAULT_COMMERCE_SETTINGS
  }

  return {
    ...normalizeCommerceSettingsInput(row.setting_value, DEFAULT_COMMERCE_SETTINGS),
    updated_at: row.updated_at,
  } satisfies CommerceSettings
}

export function toCommerceSettingsView(settings: CommerceSettings): CommerceSettingsView {
  const catalogAdapterReady = settings.catalog_source === 'internal_db'
  const inventoryAdapterReady = settings.inventory_source === 'internal_ledger'

  return {
    ...settings,
    effective_catalog_source: catalogAdapterReady ? settings.catalog_source : 'internal_db',
    effective_inventory_source: inventoryAdapterReady ? settings.inventory_source : 'internal_ledger',
    catalog_adapter_ready: catalogAdapterReady,
    inventory_adapter_ready: inventoryAdapterReady,
  }
}

export async function saveCommerceSettings(
  client: CommerceQueryClient,
  input: unknown
) {
  const current = await getCommerceSettings(client)
  const next = normalizeCommerceSettingsInput(input, current)
  const saved = await upsertAppSetting(client, SETTING_KEY, {
    catalog_source: next.catalog_source,
    inventory_source: next.inventory_source,
    external_system: next.external_system,
    odoo_base_url: next.odoo_base_url,
    odoo_database: next.odoo_database,
    odoo_api_mode: next.odoo_api_mode,
    notes: next.notes,
  })

  return {
    ...next,
    updated_at: saved?.updated_at ?? current.updated_at ?? null,
  } satisfies CommerceSettings
}
