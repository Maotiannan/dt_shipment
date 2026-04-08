import type { PoolClient } from 'pg'

export type SkuAttributeType = 'category' | 'color' | 'variant'

type QueryClient = Pick<PoolClient, 'query'>

export type SkuAttributeSuggestion = {
  value: string
  usage_count: number
}

export type SkuAttributeInput = {
  categoryName?: string | null
  colorName?: string | null
  variantName?: string | null
  source?: string
}

type SuggestionSeed = {
  attributeType: SkuAttributeType
  scopeKey: string | null
  value: string
  source: string
}

function normalizeOptionalText(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized ? normalized : null
}

export function buildSuggestionSeeds(input: SkuAttributeInput): SuggestionSeed[] {
  const categoryName = normalizeOptionalText(input.categoryName)
  const colorName = normalizeOptionalText(input.colorName)
  const variantName = normalizeOptionalText(input.variantName)
  const source = normalizeOptionalText(input.source) ?? 'sku_form'
  const seeds: SuggestionSeed[] = []

  if (categoryName) {
    seeds.push({
      attributeType: 'category',
      scopeKey: null,
      value: categoryName,
      source,
    })
  }

  if (categoryName && colorName) {
    seeds.push({
      attributeType: 'color',
      scopeKey: categoryName,
      value: colorName,
      source,
    })
  }

  if (categoryName && variantName) {
    seeds.push({
      attributeType: 'variant',
      scopeKey: categoryName,
      value: variantName,
      source,
    })
  }

  return seeds
}

export async function upsertSkuAttributeSuggestionsTx(
  client: QueryClient,
  input: SkuAttributeInput
) {
  for (const seed of buildSuggestionSeeds(input)) {
    const updated = await client.query<{ suggestion_id: string }>(
      `update sku_attribute_suggestions
       set usage_count = usage_count + 1,
           source = $4,
           is_enabled = true,
           updated_at = now()
       where attribute_type = $1
         and coalesce(scope_key, '') = coalesce($2, '')
         and lower(value) = lower($3)
       returning suggestion_id`,
      [seed.attributeType, seed.scopeKey, seed.value, seed.source]
    )

    if (updated.rows[0]) {
      continue
    }

    await client.query(
      `insert into sku_attribute_suggestions(
        attribute_type,
        scope_key,
        value,
        usage_count,
        source,
        is_enabled
      ) values ($1, $2, $3, 1, $4, true)`,
      [seed.attributeType, seed.scopeKey, seed.value, seed.source]
    )
  }
}

export async function listSkuAttributeSuggestions(
  client: QueryClient,
  params: {
    attributeType: SkuAttributeType
    scopeKey?: string | null
    limit?: number
  }
) {
  const limit = Number.isInteger(params.limit) && (params.limit ?? 0) > 0 ? Number(params.limit) : 12
  const scopeKey = normalizeOptionalText(params.scopeKey)

  const { rows } = await client.query<SkuAttributeSuggestion>(
    `select value, usage_count
     from sku_attribute_suggestions
     where attribute_type = $1
       and is_enabled = true
       and (
         ($2::text is null and scope_key is null)
         or scope_key = $2
       )
     order by usage_count desc, lower(value) asc
     limit $3`,
    [params.attributeType, scopeKey, limit]
  )

  return rows.map((row) => ({
    value: row.value,
    usage_count: Number(row.usage_count),
  }))
}
