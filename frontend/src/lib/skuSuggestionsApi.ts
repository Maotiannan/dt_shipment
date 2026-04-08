import { apiRequest } from './apiClient'

export type SkuSuggestionAttribute = 'category' | 'color' | 'variant'

type SkuSuggestionsResponse = {
  suggestions?: Array<{
    value: string
    usage_count?: number
  }>
}

export async function loadSkuAttributeSuggestions(params: {
  attribute: SkuSuggestionAttribute
  categoryName?: string | null
  limit?: number
}) {
  const search = new URLSearchParams()
  search.set('attribute', params.attribute)
  if (params.categoryName?.trim()) {
    search.set('category_name', params.categoryName.trim())
  }
  if (typeof params.limit === 'number' && Number.isInteger(params.limit) && params.limit > 0) {
    search.set('limit', String(params.limit))
  }

  const response = await apiRequest<SkuSuggestionsResponse>(
    `/api/sku-attribute-suggestions?${search.toString()}`
  )

  return (response.suggestions ?? []).map((item) => item.value)
}
