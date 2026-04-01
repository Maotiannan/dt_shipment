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

