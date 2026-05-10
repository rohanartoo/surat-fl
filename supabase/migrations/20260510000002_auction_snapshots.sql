-- Stores a pre-auction snapshot so the AM can roll back to the exact state
-- before the auction started (rosters, budgets, base prices, staged drops).
create table public.auction_snapshots (
  id           uuid primary key default gen_random_uuid(),
  auction_id   uuid not null references public.auctions(id) on delete cascade,
  snapshot     jsonb not null,
  created_at   timestamptz not null default now(),
  constraint unique_auction_snapshot unique (auction_id)
);

alter table public.auction_snapshots enable row level security;

create policy "Admin full access snapshots" on public.auction_snapshots
  for all to authenticated using (get_my_role() = 'admin');

create policy "AM read snapshots" on public.auction_snapshots
  for select to authenticated using (get_my_role() in ('admin', 'auction_master'));
