create extension if not exists pgcrypto;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_wallet text not null,
  mode text not null check (mode in ('swap','snipe')),
  token_target text not null,
  amount_hbar numeric not null,
  deposit_memo text not null,
  status text not null check (status in ('waiting_deposit','deposit_detected','executing','completed','failed','refunded')),
  tx_hash text,
  created_at timestamptz not null default now()
);

create unique index if not exists orders_deposit_memo_uq on public.orders(deposit_memo);
create index if not exists orders_status_idx on public.orders(status);

alter table public.orders disable row level security;
grant select on table public.orders to anon;
grant select on table public.orders to authenticated;
