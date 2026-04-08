import { apiRequest } from './apiClient'

export type SkuSuggestionSettingAttribute = 'category' | 'color' | 'variant'

export type SkuSuggestionSettingRecord = {
  suggestion_id: string
  attribute_type: SkuSuggestionSettingAttribute
  scope_key: string | null
  value: string
  usage_count: number
  source: string
  is_enabled: boolean
  created_at: string
  updated_at: string
}

type SettingsListResponse = {
  suggestions?: SkuSuggestionSettingRecord[]
}

export function buildSkuSuggestionSettingsPath(params: {
  attribute?: SkuSuggestionSettingAttribute | null
  scopeKey?: string | null
  query?: string | null
  includeDisabled?: boolean
  limit?: number
}) {
  const search = new URLSearchParams()

  if (params.attribute) {
    search.set('attribute', params.attribute)
  }

  const normalizedScopeKey = params.scopeKey?.trim()
  if (normalizedScopeKey) {
    search.set('scope_key', normalizedScopeKey)
  }

  const normalizedQuery = params.query?.trim()
  if (normalizedQuery) {
    search.set('query', normalizedQuery)
  }

  if (params.includeDisabled) {
    search.set('include_disabled', 'true')
  }

  if (typeof params.limit === 'number' && Number.isInteger(params.limit) && params.limit > 0) {
    search.set('limit', String(params.limit))
  }

  const queryString = search.toString()
  return queryString
    ? `/api/settings/sku-attribute-suggestions?${queryString}`
    : '/api/settings/sku-attribute-suggestions'
}

export async function listSkuSuggestionSettings(params: {
  attribute?: SkuSuggestionSettingAttribute | null
  scopeKey?: string | null
  query?: string | null
  includeDisabled?: boolean
  limit?: number
}) {
  const response = await apiRequest<SettingsListResponse>(buildSkuSuggestionSettingsPath(params))
  return response.suggestions ?? []
}

export async function createSkuSuggestionSetting(input: {
  attributeType: SkuSuggestionSettingAttribute
  scopeKey?: string | null
  value: string
  source?: string | null
}) {
  return apiRequest<SkuSuggestionSettingRecord>('/api/settings/sku-attribute-suggestions', {
    method: 'POST',
    body: JSON.stringify({
      attribute_type: input.attributeType,
      scope_key: input.scopeKey?.trim() ? input.scopeKey.trim() : null,
      value: input.value,
      source: input.source ?? 'manual_settings',
    }),
  })
}

export async function updateSkuSuggestionSetting(
  suggestionId: string,
  patch: {
    isEnabled?: boolean
    value?: string | null
    scopeKey?: string | null
    source?: string | null
  }
) {
  return apiRequest<SkuSuggestionSettingRecord>(
    `/api/settings/sku-attribute-suggestions/${suggestionId}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        is_enabled: patch.isEnabled,
        value: patch.value,
        scope_key: patch.scopeKey?.trim() ? patch.scopeKey.trim() : patch.scopeKey ?? undefined,
        source: patch.source,
      }),
    }
  )
}
