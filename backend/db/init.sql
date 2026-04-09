create table if not exists fish_accounts (
  account_id uuid primary key default gen_random_uuid(),
  account_name text not null,
  remark text,
  biz_type text not null default 'mixed',
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists skus (
  sku_id uuid primary key default gen_random_uuid(),
  sku_code text,
  name text not null,
  spec text,
  unit_price numeric(12,2) not null default 0,
  category text,
  category_name text,
  color_name text,
  variant_name text,
  status text not null default 'active',
  inventory_id text,
  inventory_quantity integer,
  created_at timestamptz not null default now()
);

create table if not exists orders (
  order_id text primary key,
  account_id uuid not null references fish_accounts(account_id) on delete restrict,
  order_type text not null,
  buyer_name text not null,
  shipping_address text not null,
  items jsonb not null default '[]'::jsonb,
  total_amount numeric(12,2) not null default 0,
  ship_status text not null default 'pending',
  delivery_channel text,
  tracking_number text,
  tracking_method text,
  is_abnormal boolean not null default false,
  abnormal_type text,
  remark text,
  settlement_status text,
  paid_amount numeric(12,2) not null default 0,
  paid_at timestamptz,
  paid_remark text,
  created_at timestamptz not null default now(),
  shipped_at timestamptz
);

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

create table if not exists push_subscriptions (
  subscription_id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index if not exists orders_created_idx on orders(created_at desc);
create index if not exists orders_status_idx on orders(ship_status);
create index if not exists orders_type_idx on orders(order_type);
create index if not exists orders_abnormal_idx on orders(is_abnormal);

create table if not exists product_images (
  image_id uuid primary key default gen_random_uuid(),
  sku_id uuid not null references skus(sku_id) on delete cascade,
  storage_key text not null unique,
  original_relpath text not null,
  thumb_relpath text not null,
  mime_type text not null,
  file_ext text not null,
  file_size bigint not null,
  width integer not null,
  height integer not null,
  sha256 text not null,
  sort_order integer not null default 1,
  is_primary boolean not null default false,
  status text not null default 'active',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- product_images index bootstrap is handled by backend/src/scripts/initDb.ts.
