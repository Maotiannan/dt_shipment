import { needsLegacyProductImageRepair, needsProductImageRepair } from './initDbHelpers.js'

export type InitDbPool = {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>
  connect?: () => Promise<{
    query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>
    release(): void
  }>
  end(): Promise<void>
}

const PRODUCT_IMAGE_ACTIVE_SKU_SORT_INDEX_SQL = `
create unique index if not exists product_images_active_sku_sort_uidx
  on product_images(sku_id, sort_order)
  where status = 'active';
`

const PRODUCT_IMAGE_ACTIVE_PRIMARY_INDEX_SQL = `
create unique index if not exists product_images_active_primary_uidx
  on product_images(sku_id)
  where status = 'active' and is_primary;
`

const PRODUCT_IMAGE_STATUS_INDEX_SQL = `
create index if not exists product_images_status_idx
  on product_images(status, deleted_at);
`

const PRODUCT_IMAGE_CANONICAL_INDEX_SPECS = [
  {
    indexName: 'product_images_active_sku_sort_uidx',
    isUnique: true,
    keyColumns: ['sku_id', 'sort_order'],
    predicateSql: "(status = 'active'::text)",
  },
  {
    indexName: 'product_images_active_primary_uidx',
    isUnique: true,
    keyColumns: ['sku_id'],
    predicateSql: "((status = 'active'::text) and is_primary)",
  },
  {
    indexName: 'product_images_status_idx',
    isUnique: false,
    keyColumns: ['status', 'deleted_at'],
    predicateSql: null,
  },
] as const

const LEGACY_PRODUCT_IMAGE_SKU_ID = '00000000-0000-0000-0000-000000000001'
const LEGACY_PRODUCT_IMAGE_STORAGE_KEY_PREFIX = 'legacy-product-image-'

const PRODUCT_IMAGE_SCHEMA_COLUMNS_SQL = `
  select column_name, is_nullable, column_default
  from information_schema.columns
  where table_schema = current_schema()
    and table_name = 'product_images'
`

const COMMERCE_FOUNDATION_SKU_COLUMNS_SQL = `
  select column_name
  from information_schema.columns
  where table_schema = current_schema()
    and table_name = 'skus'
`

const COMMERCE_FOUNDATION_ORDER_COLUMNS_SQL = `
  select column_name
  from information_schema.columns
  where table_schema = current_schema()
    and table_name = 'orders'
`

const COMMERCE_FOUNDATION_TABLES_SQL = `
  select table_name
  from information_schema.tables
  where table_schema = current_schema()
    and table_name in ('inventory_movements', 'sku_attribute_suggestions', 'app_settings')
`

const COMMERCE_FOUNDATION_SCHEMA_STRUCTURE_REPAIR_SQL = `
alter table if exists skus add column if not exists category_name text;
alter table if exists skus add column if not exists color_name text;
alter table if exists skus add column if not exists variant_name text;
alter table if exists orders add column if not exists delivery_channel text;

create table if not exists inventory_movements (
  movement_id uuid primary key default gen_random_uuid(),
  sku_id uuid not null,
  order_id text,
  delta_quantity integer not null,
  reason text not null,
  remark text,
  created_at timestamptz not null default now()
);

create table if not exists sku_attribute_suggestions (
  suggestion_id uuid primary key default gen_random_uuid(),
  attribute_type text not null,
  scope_key text,
  value text not null,
  usage_count integer not null default 1,
  source text not null,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app_settings (
  setting_key text primary key,
  setting_value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
`

const COMMERCE_FOUNDATION_SKU_BACKFILL_SQL = `
update skus
set category_name = coalesce(category_name, category),
    variant_name = coalesce(variant_name, spec)
where category_name is null or variant_name is null;
`

const COMMERCE_FOUNDATION_SKU_BACKFILL_NEED_SQL = `
  select exists (
    select 1
    from skus
    where (category is not null and category_name is null)
       or (spec is not null and variant_name is null)
  ) as needs_backfill
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
     and constraint_row.conkey[1] = attribute_row.attnum
    where namespace_row.nspname = current_schema()
      and table_row.relname = 'product_images'
      and constraint_row.contype = 'p'
      and array_length(constraint_row.conkey, 1) = 1
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
     and constraint_row.conkey[1] = attribute_row.attnum
    where namespace_row.nspname = current_schema()
      and table_row.relname = 'product_images'
      and constraint_row.contype = 'u'
      and array_length(constraint_row.conkey, 1) = 1
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
     and constraint_row.conkey[1] = table_attribute_row.attnum
    join pg_attribute foreign_attribute_row
      on foreign_attribute_row.attrelid = foreign_table_row.oid
     and constraint_row.confkey[1] = foreign_attribute_row.attnum
    where namespace_row.nspname = current_schema()
      and table_row.relname = 'product_images'
      and constraint_row.contype = 'f'
      and array_length(constraint_row.conkey, 1) = 1
      and array_length(constraint_row.confkey, 1) = 1
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
set is_primary = false
  , updated_at = now()
where target.status = 'active'
  and target.is_primary;

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
set is_primary = true
  , updated_at = now()
from canonical_active_images
where target.image_id = canonical_active_images.image_id
  and canonical_active_images.canonical_rank = 1
  and target.is_primary is distinct from true;
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

const PRODUCT_IMAGE_INDEX_STATE_SQL = `
  select
    index_row.relname as indexname,
    access_method.amname as access_method,
    index_info.indisunique as is_unique,
    index_info.indnkeyatts as key_att_count,
    index_info.indnatts as total_att_count,
    index_info.indexprs is not null as has_expressions,
    coalesce(index_row.reloptions, '{}'::text[]) as reloptions,
    pg_get_expr(index_info.indpred, index_info.indrelid) as predicate_sql,
    coalesce(
      array(
        select pg_get_indexdef(index_row.oid, key_ordinality, false)
        from generate_series(1, index_info.indnkeyatts) as key_ordinality
        order by key_ordinality
      ),
      '{}'::text[]
    ) as key_columns
  from pg_indexes
  join pg_class table_row
    on table_row.relname = tablename
  join pg_namespace namespace_row
    on namespace_row.oid = table_row.relnamespace
   and namespace_row.nspname = schemaname
  join pg_class index_row
    on index_row.relname = indexname
   and index_row.relnamespace = namespace_row.oid
  join pg_index index_info
    on index_info.indexrelid = index_row.oid
   and index_info.indrelid = table_row.oid
  join pg_am access_method
    on access_method.oid = index_row.relam
  where schemaname = current_schema()
    and tablename = 'product_images'
    and indexname in (
      'product_images_active_sku_sort_uidx',
      'product_images_active_primary_uidx',
      'product_images_status_idx'
    )
`

const PRODUCT_IMAGE_ROW_EXISTS_SQL = `
  select exists (
    select 1
    from product_images
    limit 1
  ) as has_rows
`

const PRODUCT_IMAGE_DUPLICATE_IMAGE_ID_SQL = `
  select exists (
    select 1
    from (
      select image_id
      from product_images
      where image_id is not null
      group by image_id
      having count(*) > 1
    ) duplicate_image_ids
  ) as has_duplicate_image_ids
`

const PRODUCT_IMAGE_DUPLICATE_STORAGE_KEY_SQL = `
  select exists (
    select 1
    from (
      select storage_key
      from product_images
      where storage_key is not null
      group by storage_key
      having count(*) > 1
    ) duplicate_storage_keys
  ) as has_duplicate_storage_keys
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
  return [
    PRODUCT_IMAGE_ACTIVE_SKU_SORT_INDEX_SQL,
    PRODUCT_IMAGE_ACTIVE_PRIMARY_INDEX_SQL,
    PRODUCT_IMAGE_STATUS_INDEX_SQL,
  ].join('\n')
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

type ProductImageKeyConflicts = {
  hasDuplicateImageIds: boolean
  hasDuplicateStorageKeys: boolean
}

type ProductImageIndexState = {
  indexname: string
  access_method: string
  is_unique: boolean
  key_att_count: number
  total_att_count: number
  has_expressions: boolean
  reloptions: string[]
  predicate_sql: string | null
  key_columns: string[]
}

const PRODUCT_IMAGE_NOT_NULL_COLUMNS = [
  'image_id',
  'sku_id',
  'storage_key',
  'original_relpath',
  'thumb_relpath',
  'mime_type',
  'file_ext',
  'file_size',
  'width',
  'height',
  'sha256',
  'sort_order',
  'is_primary',
  'status',
  'created_at',
  'updated_at',
] as const

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
  { columnName: 'deleted_at', shouldBeNotNull: false },
] as const

type DefaultTokenGroup = readonly string[]

type RequiredProductImageColumnDefinition = {
  columnName: string
  shouldBeNotNull: boolean
  defaultTokens?: readonly string[]
  defaultTokenGroups?: readonly DefaultTokenGroup[]
}

function columnDefaultMatches(
  actualDefault: string | null,
  definition: RequiredProductImageColumnDefinition
) {
  if (!definition.defaultTokens && !definition.defaultTokenGroups) {
    return true
  }

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

type CommerceFoundationSchemaState = {
  missingSkuColumns: Set<string>
  missingOrderColumns: Set<string>
  missingTables: Set<string>
  hasCategorySourceColumn: boolean
  hasSpecSourceColumn: boolean
}

async function getColumnNames(pool: InitDbPool, sql: string) {
  const result = await pool.query(sql)
  return new Set(result.rows.map((row) => String(row.column_name)))
}

async function getTableNames(pool: InitDbPool, sql: string) {
  const result = await pool.query(sql)
  return new Set(result.rows.map((row) => String(row.table_name)))
}

async function detectCommerceFoundationSchemaRepairNeed(pool: InitDbPool) {
  const skuColumns = await getColumnNames(pool, COMMERCE_FOUNDATION_SKU_COLUMNS_SQL)
  const orderColumns = await getColumnNames(pool, COMMERCE_FOUNDATION_ORDER_COLUMNS_SQL)
  const tableNames = await getTableNames(pool, COMMERCE_FOUNDATION_TABLES_SQL)
  const hasCategorySourceColumn = skuColumns.has('category')
  const hasSpecSourceColumn = skuColumns.has('spec')

  const missingSkuColumns = new Set(
    ['category_name', 'color_name', 'variant_name'].filter((columnName) => !skuColumns.has(columnName))
  )
  const missingOrderColumns = new Set(
    ['delivery_channel'].filter((columnName) => !orderColumns.has(columnName))
  )
  const missingTables = new Set(
    ['inventory_movements', 'sku_attribute_suggestions'].filter((tableName) => !tableNames.has(tableName))
  )

  return {
    missingSkuColumns,
    missingOrderColumns,
    missingTables,
    hasCategorySourceColumn,
    hasSpecSourceColumn,
  } satisfies CommerceFoundationSchemaState
}

async function needsCommerceFoundationSkuBackfill(pool: InitDbPool) {
  const result = await pool.query(COMMERCE_FOUNDATION_SKU_BACKFILL_NEED_SQL)
  return getBooleanValue(result.rows[0], 'needs_backfill')
}

function needsCommerceFoundationSchemaRepair(preflight: CommerceFoundationSchemaState) {
  return (
    preflight.missingSkuColumns.size > 0 ||
    preflight.missingOrderColumns.size > 0 ||
    preflight.missingTables.size > 0
  )
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

async function hasProductImageKeyConflicts(pool: InitDbPool) {
  const columns = await getProductImageColumns(pool)
  const columnNames = new Set(columns.map((column) => column.column_name))

  const conflicts: ProductImageKeyConflicts = {
    hasDuplicateImageIds: false,
    hasDuplicateStorageKeys: false,
  }

  if (columnNames.has('image_id')) {
    const result = await pool.query(PRODUCT_IMAGE_DUPLICATE_IMAGE_ID_SQL)
    conflicts.hasDuplicateImageIds = Boolean(result.rows[0]?.has_duplicate_image_ids)
  }

  if (columnNames.has('storage_key')) {
    const result = await pool.query(PRODUCT_IMAGE_DUPLICATE_STORAGE_KEY_SQL)
    conflicts.hasDuplicateStorageKeys = Boolean(result.rows[0]?.has_duplicate_storage_keys)
  }

  return conflicts
}

function normalizeSqlFragment(sql: string | null) {
  return sql ? sql.replace(/\s+/g, ' ').trim().toLowerCase() : null
}

async function getProductImageIndexStates(pool: InitDbPool) {
  const result = await pool.query(PRODUCT_IMAGE_INDEX_STATE_SQL)
  return result.rows.map((row) => ({
    indexname: String(row.indexname),
    access_method: String(row.access_method),
    is_unique: Boolean(row.is_unique),
    key_att_count: Number(row.key_att_count),
    total_att_count: Number(row.total_att_count),
    has_expressions: Boolean(row.has_expressions),
    reloptions: Array.isArray(row.reloptions)
      ? row.reloptions.map((item) => String(item))
      : [],
    predicate_sql: row.predicate_sql === null ? null : String(row.predicate_sql),
    key_columns: Array.isArray(row.key_columns)
      ? row.key_columns.map((item) => String(item))
      : [],
  })) as ProductImageIndexState[]
}

function hasCanonicalIndexShape(indexState: ProductImageIndexState | undefined) {
  if (!indexState) {
    return false
  }

  const spec = PRODUCT_IMAGE_CANONICAL_INDEX_SPECS.find(
    (candidate) => candidate.indexName === indexState.indexname
  )

  if (!spec) {
    return false
  }

  return (
    indexState.access_method === 'btree' &&
    indexState.is_unique === spec.isUnique &&
    indexState.key_att_count === spec.keyColumns.length &&
    indexState.total_att_count === spec.keyColumns.length &&
    indexState.has_expressions === false &&
    indexState.reloptions.length === 0 &&
    indexState.key_columns.length === spec.keyColumns.length &&
    indexState.key_columns.every((columnName, index) => columnName === spec.keyColumns[index]) &&
    normalizeSqlFragment(indexState.predicate_sql) === normalizeSqlFragment(spec.predicateSql)
  )
}

async function hasCanonicalProductImageIndexes(pool: InitDbPool) {
  const states = await getProductImageIndexStates(pool)
  const stateMap = new Map(states.map((state) => [state.indexname, state]))

  return PRODUCT_IMAGE_CANONICAL_INDEX_SPECS.every((spec) =>
    hasCanonicalIndexShape(stateMap.get(spec.indexName))
  )
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
      if (definition.shouldBeNotNull) {
        missingNotNullColumns.add(definition.columnName)
      }
      if ('defaultTokens' in definition || 'defaultTokenGroups' in definition) {
        missingDefaultColumns.add(definition.columnName)
      }
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
  const columnsRequiringNotNull = new Set(
    PRODUCT_IMAGE_NOT_NULL_COLUMNS.filter(
      (columnName) =>
        preflight.missingNotNullColumns.has(columnName) || preflight.missingColumns.has(columnName)
    )
  )

  const addColumnStatements = []

  if (preflight.missingColumns.has('image_id')) {
    addColumnStatements.push(`
      alter table if exists product_images
        add column if not exists image_id uuid not null default gen_random_uuid();
    `)
  }

  if (preflight.missingColumns.has('sku_id')) {
    addColumnStatements.push(`
      alter table if exists product_images
        add column if not exists sku_id uuid;
    `)
  }

  if (preflight.missingColumns.has('storage_key')) {
    addColumnStatements.push(`
      alter table if exists product_images
        add column if not exists storage_key text;
    `)
  }

  if (preflight.missingColumns.has('original_relpath')) {
    addColumnStatements.push(`
      alter table if exists product_images
        add column if not exists original_relpath text;
    `)
  }

  if (preflight.missingColumns.has('thumb_relpath')) {
    addColumnStatements.push(`
      alter table if exists product_images
        add column if not exists thumb_relpath text;
    `)
  }

  if (preflight.missingColumns.has('mime_type')) {
    addColumnStatements.push(`
      alter table if exists product_images
        add column if not exists mime_type text;
    `)
  }

  if (preflight.missingColumns.has('file_ext')) {
    addColumnStatements.push(`
      alter table if exists product_images
        add column if not exists file_ext text;
    `)
  }

  if (preflight.missingColumns.has('file_size')) {
    addColumnStatements.push(`
      alter table if exists product_images
        add column if not exists file_size bigint;
    `)
  }

  if (preflight.missingColumns.has('width')) {
    addColumnStatements.push(`
      alter table if exists product_images
        add column if not exists width integer;
    `)
  }

  if (preflight.missingColumns.has('height')) {
    addColumnStatements.push(`
      alter table if exists product_images
        add column if not exists height integer;
    `)
  }

  if (preflight.missingColumns.has('sha256')) {
    addColumnStatements.push(`
      alter table if exists product_images
        add column if not exists sha256 text;
    `)
  }

  if (preflight.missingColumns.has('sort_order')) {
    addColumnStatements.push(`
      alter table if exists product_images
        add column if not exists sort_order integer not null default 1;
    `)
  }

  if (preflight.missingColumns.has('is_primary')) {
    addColumnStatements.push(`
      alter table if exists product_images
        add column if not exists is_primary boolean not null default false;
    `)
  }

  if (preflight.missingColumns.has('status')) {
    addColumnStatements.push(`
      alter table if exists product_images
        add column if not exists status text not null default 'active';
    `)
  }

  if (preflight.missingColumns.has('created_at')) {
    addColumnStatements.push(`
      alter table if exists product_images
        add column if not exists created_at timestamptz not null default now();
    `)
  }

  if (preflight.missingColumns.has('updated_at')) {
    addColumnStatements.push(`
      alter table if exists product_images
        add column if not exists updated_at timestamptz not null default now();
    `)
  }

  if (preflight.missingColumns.has('deleted_at')) {
    addColumnStatements.push(`
      alter table if exists product_images
        add column if not exists deleted_at timestamptz;
    `)
  }

  for (const statement of addColumnStatements) {
    await pool.query(statement)
  }

  if (
    preflight.missingColumns.size > 0 ||
    preflight.missingNotNullColumns.size > 0 ||
    preflight.missingDefaultColumns.size > 0
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

  if (preflight.missingDefaultColumns.has('image_id')) {
    await pool.query(`alter table if exists product_images alter column image_id set default gen_random_uuid();`)
  }

  if (preflight.missingDefaultColumns.has('sort_order')) {
    await pool.query(`alter table if exists product_images alter column sort_order set default 1;`)
  }

  if (preflight.missingDefaultColumns.has('is_primary')) {
    await pool.query(`alter table if exists product_images alter column is_primary set default false;`)
  }

  if (preflight.missingDefaultColumns.has('status')) {
    await pool.query(`alter table if exists product_images alter column status set default 'active';`)
  }

  if (preflight.missingDefaultColumns.has('created_at')) {
    await pool.query(`alter table if exists product_images alter column created_at set default now();`)
  }

  if (preflight.missingDefaultColumns.has('updated_at')) {
    await pool.query(`alter table if exists product_images alter column updated_at set default now();`)
  }

  if (columnsRequiringNotNull.has('image_id')) {
    await pool.query(`alter table if exists product_images alter column image_id set not null;`)
  }

  if (columnsRequiringNotNull.has('sku_id')) {
    await pool.query(`alter table if exists product_images alter column sku_id set not null;`)
  }

  if (columnsRequiringNotNull.has('storage_key')) {
    await pool.query(`alter table if exists product_images alter column storage_key set not null;`)
  }

  if (columnsRequiringNotNull.has('original_relpath')) {
    await pool.query(`alter table if exists product_images alter column original_relpath set not null;`)
  }

  if (columnsRequiringNotNull.has('thumb_relpath')) {
    await pool.query(`alter table if exists product_images alter column thumb_relpath set not null;`)
  }

  if (columnsRequiringNotNull.has('mime_type')) {
    await pool.query(`alter table if exists product_images alter column mime_type set not null;`)
  }

  if (columnsRequiringNotNull.has('file_ext')) {
    await pool.query(`alter table if exists product_images alter column file_ext set not null;`)
  }

  if (columnsRequiringNotNull.has('file_size')) {
    await pool.query(`alter table if exists product_images alter column file_size set not null;`)
  }

  if (columnsRequiringNotNull.has('width')) {
    await pool.query(`alter table if exists product_images alter column width set not null;`)
  }

  if (columnsRequiringNotNull.has('height')) {
    await pool.query(`alter table if exists product_images alter column height set not null;`)
  }

  if (columnsRequiringNotNull.has('sha256')) {
    await pool.query(`alter table if exists product_images alter column sha256 set not null;`)
  }

  if (columnsRequiringNotNull.has('sort_order')) {
    await pool.query(`alter table if exists product_images alter column sort_order set not null;`)
  }

  if (columnsRequiringNotNull.has('is_primary')) {
    await pool.query(`alter table if exists product_images alter column is_primary set not null;`)
  }

  if (columnsRequiringNotNull.has('status')) {
    await pool.query(`alter table if exists product_images alter column status set not null;`)
  }

  if (columnsRequiringNotNull.has('created_at')) {
    await pool.query(`alter table if exists product_images alter column created_at set not null;`)
  }

  if (columnsRequiringNotNull.has('updated_at')) {
    await pool.query(`alter table if exists product_images alter column updated_at set not null;`)
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

async function dropNonCanonicalProductImageIndexes(pool: InitDbPool) {
  const states = await getProductImageIndexStates(pool)

  for (const state of states) {
    if (hasCanonicalIndexShape(state)) {
      continue
    }

    await pool.query(`drop index if exists ${state.indexname};`)
  }
}

async function repairProductImageIndexes(pool: InitDbPool) {
  const states = await getProductImageIndexStates(pool)
  const stateMap = new Map(states.map((state) => [state.indexname, state]))

  for (const spec of PRODUCT_IMAGE_CANONICAL_INDEX_SPECS) {
    if (hasCanonicalIndexShape(stateMap.get(spec.indexName))) {
      continue
    }

    if (spec.indexName === 'product_images_active_sku_sort_uidx') {
      await pool.query(PRODUCT_IMAGE_ACTIVE_SKU_SORT_INDEX_SQL)
      continue
    }

    if (spec.indexName === 'product_images_active_primary_uidx') {
      await pool.query(PRODUCT_IMAGE_ACTIVE_PRIMARY_INDEX_SQL)
      continue
    }

    await pool.query(PRODUCT_IMAGE_STATUS_INDEX_SQL)
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
  const runner = async (client: InitDbPool) => {
    const keyConflicts = await hasProductImageKeyConflicts(client)

    if (keyConflicts.hasDuplicateImageIds || keyConflicts.hasDuplicateStorageKeys) {
      throw new Error(
        'product_images contains duplicate image_id or storage_key values; cannot safely converge schema'
      )
    }

    // Keep full bootstrap semantics intact. The no-op guarantee is limited to
    // product_images convergence and repair, which is the part we can safely
    // make definition-aware without masking future schema additions.
    await client.query('create extension if not exists pgcrypto;')
    await client.query(schemaSql)

    const commerceFoundationSchemaRepairNeed = await detectCommerceFoundationSchemaRepairNeed(client)

    if (needsCommerceFoundationSchemaRepair(commerceFoundationSchemaRepairNeed)) {
      await client.query(COMMERCE_FOUNDATION_SCHEMA_STRUCTURE_REPAIR_SQL)
    }

    if (
      commerceFoundationSchemaRepairNeed.hasCategorySourceColumn &&
      commerceFoundationSchemaRepairNeed.hasSpecSourceColumn
    ) {
      if (await needsCommerceFoundationSkuBackfill(client)) {
        await client.query(COMMERCE_FOUNDATION_SKU_BACKFILL_SQL)
      }
    }

    await dropNonCanonicalProductImageIndexes(client)

    const schemaRepairNeed = await detectProductImageSchemaRepairNeed(client)

    if (needsProductImageSchemaRepair(schemaRepairNeed)) {
      await repairProductImageSchema(client, schemaRepairNeed)
    }

    const repairNeed = await detectProductImageRepairNeed(client)

    if (repairNeed.needsRepair) {
      await client.query(PRODUCT_IMAGE_REPAIR_SQL)
      if (repairNeed.hasLegacyIndexes) {
        await client.query('drop index if exists product_images_sku_sort_idx;')
        await client.query('drop index if exists product_images_primary_idx;')
      }
    }

    await repairProductImageIndexes(client)
  }

  const connect = pool.connect

  if (typeof connect !== 'function') {
    await runner(pool)
    return
  }

  const client = await connect.call(pool)

  try {
    await client.query('begin')
    await runner({
      query: (sql: string) => client.query(sql),
      end: async () => undefined,
    })
    await client.query('commit')
  } catch (err) {
    await client.query('rollback').catch(() => undefined)
    throw err
  } finally {
    client.release()
  }
}
