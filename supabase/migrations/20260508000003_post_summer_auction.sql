-- Add post_summer auction type and dropped_post_summer flag on team_drops

-- 1. Relax the check constraint on auctions.type to include post_summer
alter table public.auctions
  drop constraint if exists auctions_type_check;

alter table public.auctions
  add constraint auctions_type_check
  check (type in ('initial', 'mini', 'post_jan', 'post_summer'));

-- 2. Add dropped_post_summer flag to team_drops (mirrors dropped_post_january)
alter table public.team_drops
  add column if not exists dropped_post_summer boolean not null default false;
