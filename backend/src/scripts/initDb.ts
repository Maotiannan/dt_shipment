import fs from 'node:fs'
import path from 'node:path'
import { pool } from '../db.js'
import { needsLegacyProductImageRepair } from './initDbHelpers.js'

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
    row_number() over (
      partition by sku_id
      order by sort_order, created_at, image_id
    ) as next_sort_order
  from product_images
  where status = 'active'
)
update product_images as target
set sort_order = normalized_active_images.next_sort_order
from normalized_active_images
where target.image_id = normalized_active_images.image_id
  and target.sort_order is distinct from normalized_active_images.next_sort_order;

with collapsed_active_primaries as (
  select
    image_id,
    row_number() over (
      partition by sku_id
      order by sort_order, created_at, image_id
    ) as primary_rank
  from product_images
  where status = 'active' and is_primary
)
update product_images as target
set is_primary = false
from collapsed_active_primaries
where target.image_id = collapsed_active_primaries.image_id
  and collapsed_active_primaries.primary_rank > 1;
`

async function main() {
  const sqlPath = path.resolve(process.cwd(), 'db/init.sql')
  const schemaSql = fs.readFileSync(sqlPath, 'utf8')

  await pool.query('create extension if not exists pgcrypto;')
  await pool.query(schemaSql)

  const legacyIndexResult = await pool.query<{ indexname: string }>(`
    select indexname
    from pg_indexes
    where schemaname = current_schema()
      and tablename = 'product_images'
      and indexname in ('product_images_sku_sort_idx', 'product_images_primary_idx')
  `)

  const legacyIndexNames = legacyIndexResult.rows.map((row) => row.indexname)
  const needsRepair = needsLegacyProductImageRepair(legacyIndexNames)

  if (needsRepair) {
    await pool.query(PRODUCT_IMAGE_REPAIR_SQL)
    await pool.query('drop index if exists product_images_sku_sort_idx;')
    await pool.query('drop index if exists product_images_primary_idx;')
  }

  await pool.query(PRODUCT_IMAGE_INDEX_SQL)

  console.log('DB initialized.')
  await pool.end()
}

main().catch(async (err) => {
  console.error(err)
  await pool.end()
  process.exit(1)
})

