import { needsLegacyProductImageRepair, needsProductImageRepair } from './initDbHelpers.js'

export type InitDbPool = {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>
  end(): Promise<void>
}

const PRODUCT_IMAGE_INDEX_SQL = `
create unique index if not exists product_images_active_sku_sort_uidx
  on product_images(sku_id, sort_order)
  where status = 'active';

create unique index if not exists product_images_active_primary_uidx
  on product_images(sku_id)
  where status = 'active' and is_primary;

create index if not exists product_images_status_idx
  on product_images(status, deleted_at);
`

const PRODUCT_IMAGE_REPAIR_SQL = `
with normalized_active_images as (
  select
    image_id,
    sku_id,
    row_number() over (
      partition by sku_id
      order by sort_order, image_id
    ) as next_sort_order
  from product_images
  where status = 'active'
)
update product_images as target
set sort_order = normalized_active_images.next_sort_order
  , updated_at = now()
from normalized_active_images
where target.image_id = normalized_active_images.image_id
  and target.sort_order is distinct from normalized_active_images.next_sort_order;

with canonical_active_images as (
  select
    image_id,
    sku_id,
    row_number() over (
      partition by sku_id
      order by sort_order, image_id
    ) as canonical_rank
  from product_images
  where status = 'active'
)
update product_images as target
set is_primary = canonical_active_images.canonical_rank = 1
  , updated_at = now()
from canonical_active_images
where target.image_id = canonical_active_images.image_id
  and target.is_primary is distinct from (canonical_active_images.canonical_rank = 1);
`

const LEGACY_PRODUCT_IMAGE_INDEX_SQL = `
  select indexname
  from pg_indexes
  where schemaname = current_schema()
    and tablename = 'product_images'
    and indexname in ('product_images_sku_sort_idx', 'product_images_primary_idx')
`

const CURRENT_PRODUCT_IMAGE_INDEX_SQL = `
  select indexname
  from pg_indexes
  where schemaname = current_schema()
    and tablename = 'product_images'
    and indexname in (
      'product_images_active_sku_sort_uidx',
      'product_images_active_primary_uidx'
    )
`

const PRODUCT_IMAGE_ROW_EXISTS_SQL = `
  select exists (
    select 1
    from product_images
    limit 1
  ) as has_rows
`

const PRODUCT_IMAGE_CANONICAL_DRIFT_SQL = `
  select exists (
    select 1
    from (
      select
        sku_id,
        count(*) as active_count,
        min(sort_order) as min_sort_order,
        max(sort_order) as max_sort_order,
        count(*) filter (where is_primary) as primary_count,
        count(distinct sort_order) as distinct_sort_count
      from product_images
      where status = 'active'
      group by sku_id
    ) sku_state
    where min_sort_order <> 1
       or max_sort_order <> active_count
       or primary_count <> 1
       or distinct_sort_count <> active_count
  ) as has_duplicates
`

export function getProductImageBootstrapSql() {
  return PRODUCT_IMAGE_INDEX_SQL
}

export function getProductImageRepairSql() {
  return PRODUCT_IMAGE_REPAIR_SQL
}

function getBooleanValue(row: Record<string, unknown> | undefined, key: string) {
  return row ? Boolean(row[key]) : false
}

async function listIndexNames(pool: InitDbPool, sql: string) {
  const result = await pool.query(sql)
  return result.rows.map((row) => String(row.indexname))
}

async function hasAnyProductImageRows(pool: InitDbPool) {
  const result = await pool.query(PRODUCT_IMAGE_ROW_EXISTS_SQL)
  return getBooleanValue(result.rows[0], 'has_rows')
}

async function hasCanonicalProductImageDrift(pool: InitDbPool) {
  const result = await pool.query(PRODUCT_IMAGE_CANONICAL_DRIFT_SQL)
  return getBooleanValue(result.rows[0], 'has_duplicates')
}

async function detectProductImageRepairNeed(pool: InitDbPool) {
  const legacyIndexNames = await listIndexNames(pool, LEGACY_PRODUCT_IMAGE_INDEX_SQL)
  const currentIndexNames = await listIndexNames(pool, CURRENT_PRODUCT_IMAGE_INDEX_SQL)

  const hasLegacyIndexes = needsLegacyProductImageRepair(legacyIndexNames)
  const hasCurrentIndexes =
    currentIndexNames.includes('product_images_active_sku_sort_uidx') &&
    currentIndexNames.includes('product_images_active_primary_uidx')

  if (hasLegacyIndexes) {
    return { hasLegacyIndexes, hasCurrentIndexes, needsRepair: true }
  }

  if (hasCurrentIndexes) {
    const hasRows = await hasAnyProductImageRows(pool)

    if (!hasRows) {
      return { hasLegacyIndexes, hasCurrentIndexes, needsRepair: false }
    }

    const hasCanonicalDrift = await hasCanonicalProductImageDrift(pool)

    return {
      hasLegacyIndexes,
      hasCurrentIndexes,
      needsRepair: hasCanonicalDrift,
    }
  }

  const hasRows = await hasAnyProductImageRows(pool)

  if (!hasRows) {
    return { hasLegacyIndexes, hasCurrentIndexes, needsRepair: false }
  }

  const hasCanonicalDrift = await hasCanonicalProductImageDrift(pool)

  return {
    hasLegacyIndexes,
    hasCurrentIndexes,
    needsRepair: needsProductImageRepair({
      hasLegacyIndexes,
      hasActiveRows: hasRows,
      hasCanonicalDrift,
    }),
  }
}

export async function runInitDb(pool: InitDbPool, schemaSql: string) {
  await pool.query('create extension if not exists pgcrypto;')
  await pool.query(schemaSql)

  const repairNeed = await detectProductImageRepairNeed(pool)

  if (repairNeed.needsRepair) {
    await pool.query(PRODUCT_IMAGE_REPAIR_SQL)
    if (repairNeed.hasLegacyIndexes) {
      await pool.query('drop index if exists product_images_sku_sort_idx;')
      await pool.query('drop index if exists product_images_primary_idx;')
    }
  }

  await pool.query(PRODUCT_IMAGE_INDEX_SQL)
}
