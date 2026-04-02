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

const LEGACY_PRODUCT_IMAGE_SKU_ID = '00000000-0000-0000-0000-000000000001'
const LEGACY_PRODUCT_IMAGE_STORAGE_KEY_PREFIX = 'legacy-product-image-'

const PRODUCT_IMAGE_SCHEMA_COLUMNS_SQL = `
  select column_name, is_nullable, column_default
  from information_schema.columns
  where table_schema = current_schema()
    and table_name = 'product_images'
`

const PRODUCT_IMAGE_PRIMARY_KEY_SQL = `
  select exists (
    select 1
    from pg_constraint constraint_row
    join pg_class table_row
      on table_row.oid = constraint_row.conrelid
    join pg_namespace namespace_row
      on namespace_row.oid = table_row.relnamespace
    join pg_attribute attribute_row
      on attribute_row.attrelid = table_row.oid
     and attribute_row.attnum = any (constraint_row.conkey)
    where namespace_row.nspname = current_schema()
      and table_row.relname = 'product_images'
      and constraint_row.contype = 'p'
      and attribute_row.attname = 'image_id'
  ) as has_primary_key
`

const PRODUCT_IMAGE_STORAGE_KEY_UNIQUE_SQL = `
  select exists (
    select 1
    from pg_constraint constraint_row
    join pg_class table_row
      on table_row.oid = constraint_row.conrelid
    join pg_namespace namespace_row
      on namespace_row.oid = table_row.relnamespace
    join pg_attribute attribute_row
      on attribute_row.attrelid = table_row.oid
     and attribute_row.attnum = any (constraint_row.conkey)
    where namespace_row.nspname = current_schema()
      and table_row.relname = 'product_images'
      and constraint_row.contype = 'u'
      and attribute_row.attname = 'storage_key'
  ) as has_storage_key_unique
`

const PRODUCT_IMAGE_SKU_FOREIGN_KEY_SQL = `
  select exists (
    select 1
    from pg_constraint constraint_row
    join pg_class table_row
      on table_row.oid = constraint_row.conrelid
    join pg_namespace namespace_row
      on namespace_row.oid = table_row.relnamespace
    join pg_class foreign_table_row
      on foreign_table_row.oid = constraint_row.confrelid
    join pg_attribute table_attribute_row
      on table_attribute_row.attrelid = table_row.oid
     and table_attribute_row.attnum = any (constraint_row.conkey)
    join pg_attribute foreign_attribute_row
      on foreign_attribute_row.attrelid = foreign_table_row.oid
     and foreign_attribute_row.attnum = any (constraint_row.confkey)
    where namespace_row.nspname = current_schema()
      and table_row.relname = 'product_images'
      and constraint_row.contype = 'f'
      and table_attribute_row.attname = 'sku_id'
      and foreign_table_row.relname = 'skus'
      and foreign_attribute_row.attname = 'sku_id'
      and constraint_row.confdeltype = 'c'
  ) as has_sku_foreign_key
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
        count(distinct sort_order) as distinct_sort_count,
        count(*) filter (where canonical_rank = 1 and is_primary) as canonical_primary_count
      from (
        select
          sku_id,
          sort_order,
          is_primary,
          row_number() over (
            partition by sku_id
            order by sort_order, image_id
          ) as canonical_rank
        from product_images
        where status = 'active'
      ) ordered_active_images
      group by sku_id
    ) sku_state
    where min_sort_order <> 1
       or max_sort_order <> active_count
       or primary_count <> 1
       or distinct_sort_count <> active_count
       or canonical_primary_count <> 1
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

type ProductImageColumnMetadata = {
  column_name: string
  is_nullable: string
  column_default: string | null
}

type ProductImageSchemaDrift = {
  missingColumns: Set<string>
  missingNotNullColumns: Set<string>
  missingDefaultColumns: Set<string>
  hasPrimaryKey: boolean
  hasStorageKeyUnique: boolean
  hasSkuForeignKey: boolean
}

const REQUIRED_PRODUCT_IMAGE_COLUMN_DEFINITIONS = [
  { columnName: 'image_id', shouldBeNotNull: true, defaultTokenGroups: [['gen_random_uuid()']] },
  { columnName: 'sku_id', shouldBeNotNull: true },
  { columnName: 'storage_key', shouldBeNotNull: true },
  { columnName: 'original_relpath', shouldBeNotNull: true },
  { columnName: 'thumb_relpath', shouldBeNotNull: true },
  { columnName: 'mime_type', shouldBeNotNull: true },
  { columnName: 'file_ext', shouldBeNotNull: true },
  { columnName: 'file_size', shouldBeNotNull: true },
  { columnName: 'width', shouldBeNotNull: true },
  { columnName: 'height', shouldBeNotNull: true },
  { columnName: 'sha256', shouldBeNotNull: true },
  { columnName: 'sort_order', shouldBeNotNull: true, defaultTokenGroups: [['1']] },
  { columnName: 'is_primary', shouldBeNotNull: true, defaultTokenGroups: [['false']] },
  { columnName: 'status', shouldBeNotNull: true, defaultTokenGroups: [["'active'"]] },
  {
    columnName: 'created_at',
    shouldBeNotNull: true,
    defaultTokenGroups: [['now()'], ['CURRENT_TIMESTAMP']],
  },
  {
    columnName: 'updated_at',
    shouldBeNotNull: true,
    defaultTokenGroups: [['now()'], ['CURRENT_TIMESTAMP']],
  },
] as const

type DefaultTokenGroup = readonly string[]

type RequiredProductImageColumnDefinition = {
  columnName: string
  shouldBeNotNull: true
  defaultTokens?: readonly string[]
  defaultTokenGroups?: readonly DefaultTokenGroup[]
}

function columnDefaultMatches(
  actualDefault: string | null,
  definition: RequiredProductImageColumnDefinition
) {
  if (!actualDefault) {
    return false
  }

  if (definition.defaultTokenGroups) {
    return definition.defaultTokenGroups.some((tokenGroup) =>
      tokenGroup.every((token) => actualDefault.includes(token))
    )
  }

  if (definition.defaultTokens) {
    return definition.defaultTokens.every((token) => actualDefault.includes(token))
  }

  return true
}

async function getProductImageColumns(pool: InitDbPool) {
  const result = await pool.query(PRODUCT_IMAGE_SCHEMA_COLUMNS_SQL)
  return result.rows.map((row) => row as ProductImageColumnMetadata)
}

async function hasProductImagePrimaryKey(pool: InitDbPool) {
  const result = await pool.query(PRODUCT_IMAGE_PRIMARY_KEY_SQL)
  return getBooleanValue(result.rows[0], 'has_primary_key')
}

async function hasProductImageStorageKeyUnique(pool: InitDbPool) {
  const result = await pool.query(PRODUCT_IMAGE_STORAGE_KEY_UNIQUE_SQL)
  return getBooleanValue(result.rows[0], 'has_storage_key_unique')
}

async function hasProductImageSkuForeignKey(pool: InitDbPool) {
  const result = await pool.query(PRODUCT_IMAGE_SKU_FOREIGN_KEY_SQL)
  return getBooleanValue(result.rows[0], 'has_sku_foreign_key')
}

async function detectProductImageSchemaRepairNeed(pool: InitDbPool) {
  const columns = await getProductImageColumns(pool)
  const columnMap = new Map(columns.map((column) => [column.column_name, column]))

  const missingColumns = new Set<string>()
  const missingNotNullColumns = new Set<string>()
  const missingDefaultColumns = new Set<string>()

  for (const definition of REQUIRED_PRODUCT_IMAGE_COLUMN_DEFINITIONS) {
    const column = columnMap.get(definition.columnName)

    if (!column) {
      missingColumns.add(definition.columnName)
      continue
    }

    if (definition.shouldBeNotNull && column.is_nullable !== 'NO') {
      missingNotNullColumns.add(definition.columnName)
    }

    if (!columnDefaultMatches(column.column_default, definition)) {
      missingDefaultColumns.add(definition.columnName)
    }
  }

  return {
    missingColumns,
    missingNotNullColumns,
    missingDefaultColumns,
    hasPrimaryKey: await hasProductImagePrimaryKey(pool),
    hasStorageKeyUnique: await hasProductImageStorageKeyUnique(pool),
    hasSkuForeignKey: await hasProductImageSkuForeignKey(pool),
  } satisfies ProductImageSchemaDrift
}

function needsProductImageSchemaRepair(preflight: ProductImageSchemaDrift) {
  return (
    preflight.missingColumns.size > 0 ||
    preflight.missingNotNullColumns.size > 0 ||
    preflight.missingDefaultColumns.size > 0 ||
    !preflight.hasPrimaryKey ||
    !preflight.hasStorageKeyUnique ||
    !preflight.hasSkuForeignKey
  )
}

async function repairProductImageSchema(pool: InitDbPool, preflight: ProductImageSchemaDrift) {
  const hasMissingSkuId = preflight.missingColumns.has('sku_id') || preflight.missingNotNullColumns.has('sku_id')
  const hasMissingStorageKey =
    preflight.missingColumns.has('storage_key') || preflight.missingNotNullColumns.has('storage_key')
  const hasMissingOriginalRelpath =
    preflight.missingColumns.has('original_relpath') ||
    preflight.missingNotNullColumns.has('original_relpath')
  const hasMissingThumbRelpath =
    preflight.missingColumns.has('thumb_relpath') || preflight.missingNotNullColumns.has('thumb_relpath')
  const hasMissingMimeType =
    preflight.missingColumns.has('mime_type') || preflight.missingNotNullColumns.has('mime_type')
  const hasMissingFileExt =
    preflight.missingColumns.has('file_ext') || preflight.missingNotNullColumns.has('file_ext')
  const hasMissingFileSize =
    preflight.missingColumns.has('file_size') || preflight.missingNotNullColumns.has('file_size')
  const hasMissingWidth = preflight.missingColumns.has('width') || preflight.missingNotNullColumns.has('width')
  const hasMissingHeight =
    preflight.missingColumns.has('height') || preflight.missingNotNullColumns.has('height')
  const hasMissingSha256 =
    preflight.missingColumns.has('sha256') || preflight.missingNotNullColumns.has('sha256')
  const hasMissingSortOrder =
    preflight.missingColumns.has('sort_order') || preflight.missingNotNullColumns.has('sort_order')
  const hasMissingIsPrimary =
    preflight.missingColumns.has('is_primary') || preflight.missingNotNullColumns.has('is_primary')
  const hasMissingStatus = preflight.missingColumns.has('status') || preflight.missingNotNullColumns.has('status')
  const hasMissingCreatedAt =
    preflight.missingColumns.has('created_at') || preflight.missingNotNullColumns.has('created_at')
  const hasMissingUpdatedAt =
    preflight.missingColumns.has('updated_at') || preflight.missingNotNullColumns.has('updated_at')
  const hasMissingImageId =
    preflight.missingColumns.has('image_id') || preflight.missingNotNullColumns.has('image_id')

  if (
    hasMissingImageId ||
    hasMissingSkuId ||
    hasMissingStorageKey ||
    hasMissingOriginalRelpath ||
    hasMissingThumbRelpath ||
    hasMissingMimeType ||
    hasMissingFileExt ||
    hasMissingFileSize ||
    hasMissingWidth ||
    hasMissingHeight ||
    hasMissingSha256 ||
    hasMissingSortOrder ||
    hasMissingIsPrimary ||
    hasMissingStatus ||
    hasMissingCreatedAt ||
    hasMissingUpdatedAt
  ) {
    await pool.query(`
      insert into skus (sku_id, name, status)
      values ('${LEGACY_PRODUCT_IMAGE_SKU_ID}', 'legacy product image sku', 'active')
      on conflict (sku_id) do nothing;
    `)

    await pool.query(`
      with legacy_rows as (
        select
          ctid,
          coalesce(image_id, gen_random_uuid()) as next_image_id,
          coalesce(sku_id, '${LEGACY_PRODUCT_IMAGE_SKU_ID}') as next_sku_id,
          storage_key,
          original_relpath,
          thumb_relpath,
          mime_type,
          file_ext,
          file_size,
          width,
          height,
          sha256,
          sort_order,
          is_primary,
          status,
          created_at,
          updated_at
        from product_images
        where image_id is null
           or sku_id is null
           or storage_key is null
           or original_relpath is null
           or thumb_relpath is null
           or mime_type is null
           or file_ext is null
           or file_size is null
           or width is null
           or height is null
           or sha256 is null
           or sort_order is null
           or is_primary is null
           or status is null
           or created_at is null
           or updated_at is null
      ),
      backfilled_rows as (
        select
          ctid,
          next_image_id,
          next_sku_id,
          coalesce(storage_key, '${LEGACY_PRODUCT_IMAGE_STORAGE_KEY_PREFIX}' || next_image_id::text) as next_storage_key,
          coalesce(original_relpath, coalesce(storage_key, '${LEGACY_PRODUCT_IMAGE_STORAGE_KEY_PREFIX}' || next_image_id::text)) as next_original_relpath,
          coalesce(thumb_relpath, coalesce(storage_key, '${LEGACY_PRODUCT_IMAGE_STORAGE_KEY_PREFIX}' || next_image_id::text)) as next_thumb_relpath,
          coalesce(mime_type, 'application/octet-stream') as next_mime_type,
          coalesce(file_ext, 'bin') as next_file_ext,
          coalesce(file_size, 0) as next_file_size,
          coalesce(width, 0) as next_width,
          coalesce(height, 0) as next_height,
          coalesce(sha256, '${LEGACY_PRODUCT_IMAGE_STORAGE_KEY_PREFIX}' || next_image_id::text) as next_sha256,
          coalesce(sort_order, 1) as next_sort_order,
          coalesce(is_primary, false) as next_is_primary,
          coalesce(status, 'active') as next_status,
          coalesce(created_at, now()) as next_created_at,
          now() as next_updated_at
        from legacy_rows
      )
      update product_images as target
      set image_id = backfilled_rows.next_image_id,
          sku_id = backfilled_rows.next_sku_id,
          storage_key = backfilled_rows.next_storage_key,
          original_relpath = backfilled_rows.next_original_relpath,
          thumb_relpath = backfilled_rows.next_thumb_relpath,
          mime_type = backfilled_rows.next_mime_type,
          file_ext = backfilled_rows.next_file_ext,
          file_size = backfilled_rows.next_file_size,
          width = backfilled_rows.next_width,
          height = backfilled_rows.next_height,
          sha256 = backfilled_rows.next_sha256,
          sort_order = backfilled_rows.next_sort_order,
          is_primary = backfilled_rows.next_is_primary,
          status = backfilled_rows.next_status,
          created_at = backfilled_rows.next_created_at,
          updated_at = backfilled_rows.next_updated_at
      from backfilled_rows
      where target.ctid = backfilled_rows.ctid;
    `)
  }

  const schemaAlterStatements = [
    `alter table if exists product_images alter column image_id set default gen_random_uuid();`,
    `alter table if exists product_images alter column sort_order set default 1;`,
    `alter table if exists product_images alter column is_primary set default false;`,
    `alter table if exists product_images alter column status set default 'active';`,
    `alter table if exists product_images alter column created_at set default now();`,
    `alter table if exists product_images alter column updated_at set default now();`,
    `alter table if exists product_images alter column image_id set not null;`,
    `alter table if exists product_images alter column sku_id set not null;`,
    `alter table if exists product_images alter column storage_key set not null;`,
    `alter table if exists product_images alter column original_relpath set not null;`,
    `alter table if exists product_images alter column thumb_relpath set not null;`,
    `alter table if exists product_images alter column mime_type set not null;`,
    `alter table if exists product_images alter column file_ext set not null;`,
    `alter table if exists product_images alter column file_size set not null;`,
    `alter table if exists product_images alter column width set not null;`,
    `alter table if exists product_images alter column height set not null;`,
    `alter table if exists product_images alter column sha256 set not null;`,
    `alter table if exists product_images alter column sort_order set not null;`,
    `alter table if exists product_images alter column is_primary set not null;`,
    `alter table if exists product_images alter column status set not null;`,
    `alter table if exists product_images alter column created_at set not null;`,
    `alter table if exists product_images alter column updated_at set not null;`,
  ]

  for (const statement of schemaAlterStatements) {
    await pool.query(statement)
  }

  if (!preflight.hasPrimaryKey) {
    await pool.query(`
      alter table if exists product_images
        add constraint product_images_pkey primary key (image_id);
    `)
  }

  if (!preflight.hasStorageKeyUnique) {
    await pool.query(`
      alter table if exists product_images
        add constraint product_images_storage_key_key unique (storage_key);
    `)
  }

  if (!preflight.hasSkuForeignKey) {
    await pool.query(`
      alter table if exists product_images
        add constraint product_images_sku_id_fkey
        foreign key (sku_id)
        references skus(sku_id)
        on delete cascade;
    `)
  }
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

  const schemaRepairNeed = await detectProductImageSchemaRepairNeed(pool)

  if (needsProductImageSchemaRepair(schemaRepairNeed)) {
    await repairProductImageSchema(pool, schemaRepairNeed)
  }

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
