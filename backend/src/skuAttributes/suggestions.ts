import type { PoolClient } from 'pg'

export type SkuAttributeType = 'category' | 'color' | 'variant'

type QueryClient = Pick<PoolClient, 'query'>

export type SkuAttributeSuggestion = {
  value: string
  usage_count: number
}

export type SkuAttributeSuggestionRecord = {
  suggestion_id: string
  attribute_type: SkuAttributeType
  scope_key: string | null
  value: string
  usage_count: number
  source: string
  is_enabled: boolean
  created_at: string
  updated_at: string
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

export async function listSkuAttributeSuggestionRecords(
  client: QueryClient,
  params: {
    attributeType?: SkuAttributeType | null
    scopeKey?: string | null
    query?: string | null
    includeDisabled?: boolean
    limit?: number
  }
) {
  const limit = Number.isInteger(params.limit) && (params.limit ?? 0) > 0 ? Number(params.limit) : 200
  const scopeKey = normalizeOptionalText(params.scopeKey)
  const query = normalizeOptionalText(params.query)
  const attributeType = params.attributeType ?? null
  const includeDisabled = Boolean(params.includeDisabled)

  const { rows } = await client.query<SkuAttributeSuggestionRecord>(
    `select
        suggestion_id,
        attribute_type,
        scope_key,
        value,
        usage_count,
        source,
        is_enabled,
        created_at,
        updated_at
     from sku_attribute_suggestions
     where ($1::text is null or attribute_type = $1)
       and ($2::text is null or coalesce(scope_key, '') = coalesce($2, ''))
       and ($3::text is null or lower(value) like '%' || lower($3) || '%')
       and ($4::boolean = true or is_enabled = true)
     order by is_enabled desc, usage_count desc, lower(value) asc
     limit $5`,
    [attributeType, scopeKey, query, includeDisabled, limit]
  )

  return rows.map((row) => ({
    ...row,
    usage_count: Number(row.usage_count),
  }))
}

export async function upsertManualSkuAttributeSuggestionTx(
  client: QueryClient,
  input: {
    attributeType: SkuAttributeType
    scopeKey?: string | null
    value: string
    source?: string | null
  }
) {
  const value = normalizeOptionalText(input.value)
  if (!value) {
    throw new Error('suggestion value required')
  }

  const scopeKey = normalizeOptionalText(input.scopeKey)
  const source = normalizeOptionalText(input.source) ?? 'manual_settings'

  const updated = await client.query<SkuAttributeSuggestionRecord>(
    `update sku_attribute_suggestions
     set usage_count = usage_count + 1,
         source = $4,
         is_enabled = true,
         updated_at = now()
     where attribute_type = $1
       and coalesce(scope_key, '') = coalesce($2, '')
       and lower(value) = lower($3)
     returning suggestion_id, attribute_type, scope_key, value, usage_count, source, is_enabled, created_at, updated_at`,
    [input.attributeType, scopeKey, value, source]
  )

  if (updated.rows[0]) {
    return {
      ...updated.rows[0],
      usage_count: Number(updated.rows[0].usage_count),
    }
  }

  const inserted = await client.query<SkuAttributeSuggestionRecord>(
    `insert into sku_attribute_suggestions(
      attribute_type,
      scope_key,
      value,
      usage_count,
      source,
      is_enabled
    ) values ($1, $2, $3, 1, $4, true)
     returning suggestion_id, attribute_type, scope_key, value, usage_count, source, is_enabled, created_at, updated_at`,
    [input.attributeType, scopeKey, value, source]
  )

  return {
    ...inserted.rows[0],
    usage_count: Number(inserted.rows[0].usage_count),
  }
}

export async function updateSkuAttributeSuggestionTx(
  client: QueryClient,
  params: {
    suggestionId: string
    isEnabled?: boolean
    value?: string | null
    scopeKey?: string | null
    source?: string | null
  }
) {
  const fields: string[] = []
  const values: unknown[] = []
  let index = 1

  if (typeof params.isEnabled === 'boolean') {
    fields.push(`is_enabled = $${index++}`)
    values.push(params.isEnabled)
  }

  if (params.value !== undefined) {
    const value = normalizeOptionalText(params.value)
    if (!value) {
      throw new Error('suggestion value required')
    }
    fields.push(`value = $${index++}`)
    values.push(value)
  }

  if (params.scopeKey !== undefined) {
    fields.push(`scope_key = $${index++}`)
    values.push(normalizeOptionalText(params.scopeKey))
  }

  if (params.source !== undefined) {
    fields.push(`source = $${index++}`)
    values.push(normalizeOptionalText(params.source) ?? 'manual_settings')
  }

  fields.push(`updated_at = now()`)

  values.push(params.suggestionId)

  const { rows } = await client.query<SkuAttributeSuggestionRecord>(
    `update sku_attribute_suggestions
     set ${fields.join(', ')}
     where suggestion_id = $${index}
     returning suggestion_id, attribute_type, scope_key, value, usage_count, source, is_enabled, created_at, updated_at`,
    values
  )

  if (!rows[0]) {
    throw new Error('suggestion not found')
  }

  return {
    ...rows[0],
    usage_count: Number(rows[0].usage_count),
  }
}
