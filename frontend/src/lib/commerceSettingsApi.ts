import { apiRequest } from './apiClient'

export type CatalogSource = 'internal_db' | 'odoo'
export type InventorySource = 'internal_ledger' | 'odoo'
export type ExternalSystem = 'odoo'
export type OdooApiMode = 'json2' | 'rpc_legacy'

export type CommerceSettings = {
  catalog_source: CatalogSource
  inventory_source: InventorySource
  effective_catalog_source: CatalogSource
  effective_inventory_source: InventorySource
  catalog_adapter_ready: boolean
  inventory_adapter_ready: boolean
  external_system: ExternalSystem
  odoo_base_url: string
  odoo_database: string
  odoo_api_mode: OdooApiMode
  notes: string
  updated_at: string | null
}

export function createDefaultCommerceSettings(): CommerceSettings {
  return {
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
  }
}

export function normalizeCommerceSettingsResponse(
  input?: Partial<Omit<CommerceSettings, 'odoo_base_url' | 'odoo_database' | 'notes'>> & {
    odoo_base_url?: string | null
    odoo_database?: string | null
    notes?: string | null
  }
) {
  const base = createDefaultCommerceSettings()
  return {
    ...base,
    ...input,
    odoo_base_url: input?.odoo_base_url?.trim() ?? '',
    odoo_database: input?.odoo_database?.trim() ?? '',
    notes: input?.notes?.trim() ?? '',
    updated_at: input?.updated_at ?? null,
  } satisfies CommerceSettings
}

export function normalizeCommerceSettingsPayload(settings: CommerceSettings) {
  return {
    catalog_source: settings.catalog_source,
    inventory_source: settings.inventory_source,
    external_system: settings.external_system,
    odoo_base_url: settings.odoo_base_url.trim() || null,
    odoo_database: settings.odoo_database.trim() || null,
    odoo_api_mode: settings.odoo_api_mode,
    notes: settings.notes.trim() || null,
  }
}

export async function loadCommerceSettings() {
  const response = await apiRequest<Partial<CommerceSettings>>('/api/settings/commerce')
  return normalizeCommerceSettingsResponse(response)
}

export async function saveCommerceSettings(settings: CommerceSettings) {
  const response = await apiRequest<Partial<CommerceSettings>>('/api/settings/commerce', {
    method: 'PUT',
    body: JSON.stringify(normalizeCommerceSettingsPayload(settings)),
  })
  return normalizeCommerceSettingsResponse(response)
}
