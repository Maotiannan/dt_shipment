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
  sort_order integer not null,
  is_primary boolean not null default false,
  status text not null default 'active',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists product_images
  add column if not exists sort_order integer not null default 1;

alter table if exists product_images
  add column if not exists is_primary boolean not null default false;

alter table if exists product_images
  add column if not exists status text not null default 'active';

alter table if exists product_images
  add column if not exists created_at timestamptz not null default now();

alter table if exists product_images
  add column if not exists updated_at timestamptz not null default now();

alter table if exists product_images
  add column if not exists deleted_at timestamptz;

-- Repair legacy product_images rows before applying uniqueness constraints.
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
create unique index if not exists product_images_active_sku_sort_uidx
  on product_images(sku_id, sort_order)
  where status = 'active';
create unique index if not exists product_images_active_primary_uidx
  on product_images(sku_id)
  where status = 'active' and is_primary;

create index if not exists product_images_status_idx
  on product_images(status, deleted_at);
