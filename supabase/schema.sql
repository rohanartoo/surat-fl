-- =============================================
-- Surat Fantasy League — Supabase Schema v2
-- FROM SCRATCH — run in Supabase SQL Editor
-- =============================================

create extension if not exists "pgcrypto";

-- =============================================
-- PROFILES (role-based auth on top of Supabase Auth)
-- =============================================
-- Username auth: Supabase email = username@surat-fl.internal (hidden from users)
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  role         text not null check (role in ('admin', 'auction_master', 'team', 'guest'))
                 default 'team',
  username     text not null unique,
  display_name text not null,
  team_id      uuid, -- populated for 'team' role; null for admin/am/guest
  created_at   timestamptz not null default now()
);

-- =============================================
-- TEAMS
-- =============================================
create table public.teams (
  id            uuid primary key default gen_random_uuid(),
  display_name  text not null,
  short_name    text not null,
  budget        numeric(6,2) not null default 100.00,  -- £100m
  color         text not null default '#10b981',
  auction_order integer, -- 1 = first to bid; set manually based on previous year standings
  created_at    timestamptz not null default now()
);

-- Now we can add the FK from profiles → teams
alter table public.profiles
  add constraint profiles_team_id_fkey
  foreign key (team_id) references public.teams(id) on delete set null;

-- =============================================
-- PLAYERS (synced from FPL API)
-- =============================================
create table public.players (
  id                  integer primary key,   -- FPL element ID
  first_name          text not null,
  second_name         text not null,
  web_name            text not null,
  position            text not null check (position in ('GK', 'DEF', 'MID', 'FWD')),
  fpl_team            text not null default '',
  fpl_team_short      text not null default '',
  selected_by_percent numeric(5,2) not null default 0,
  -- Season stats for auction console display
  total_points        integer not null default 0,
  goals_scored        integer not null default 0,
  assists             integer not null default 0,
  clean_sheets        integer not null default 0,
  bonus               integer not null default 0,
  yellow_cards        integer not null default 0,
  red_cards           integer not null default 0,
  minutes             integer not null default 0,
  -- base_price tracks the auction price history (starts at £1m, updated on win/drop)
  base_price          numeric(5,2) not null default 1.00,
  fpl_cost            numeric(5,2) not null default 0, -- stored but not displayed
  status              text not null default 'a', -- a=available, d=doubt, i=injured, s=sus, u=unavail
  news                text not null default '',
  updated_at          timestamptz not null default now()
);

-- =============================================
-- ROSTER ENTRIES
-- =============================================
create table public.roster_entries (
  id             uuid primary key default gen_random_uuid(),
  team_id        uuid not null references public.teams(id) on delete cascade,
  player_id      integer not null references public.players(id),
  slot_type      text not null check (slot_type in ('starting', 'bench', 'dropped'))
                   default 'starting',
  bench_order    integer, -- 1–4 for bench slots; null for starting/dropped
  is_captain     boolean not null default false,
  is_vice_captain boolean not null default false,
  base_price     numeric(5,2) not null, -- price this team paid (or half-price on re-entry)
  purchased_at   timestamptz not null default now(),

  -- A player can only be on one active squad at a time
  -- (dropped entries are kept for history; slot_type='dropped' means staged for next auction)
  constraint unique_active_player_per_team unique (player_id, team_id)
);

-- =============================================
-- AUCTIONS
-- =============================================
create table public.auctions (
  id                       uuid primary key default gen_random_uuid(),
  type                     text not null default 'initial'
                             check (type in ('initial', 'mini', 'post_jan')),
  status                   text not null default 'pending'
                             check (status in ('pending', 'active', 'completed')),
  gameweek                 integer,
  -- Which position category is currently being auctioned
  current_position_category text check (current_position_category in ('GK','DEF','MID','FWD')),
  -- Ordered array of team IDs for bid priority [team_id, team_id, ...]
  auction_order            jsonb not null default '[]',
  -- Index into auction_order pointing to which team has current bid priority
  current_bidder_index     integer not null default 0,
  -- Free transfers for this auction window
  free_transfers           integer not null default 2,
  created_at               timestamptz not null default now(),
  started_at               timestamptz,
  completed_at             timestamptz
);

-- =============================================
-- AUCTION LOTS (one per player being auctioned)
-- =============================================
create table public.auction_lots (
  id                  uuid primary key default gen_random_uuid(),
  auction_id          uuid not null references public.auctions(id) on delete cascade,
  player_id           integer not null references public.players(id),
  phase               text not null default 'pending'
                        check (phase in ('pending', 'interest', 'bidding', 'concluded')),
  timer_started_at    timestamptz,
  current_bid         numeric(5,2),
  current_bidder_id   uuid references public.teams(id),
  -- Which index in auction_order the bidding round started at (for rotation)
  bid_start_team_index integer not null default 0,
  winning_team_id     uuid references public.teams(id),
  winning_bid         numeric(5,2),
  created_at          timestamptz not null default now()
);

-- =============================================
-- BIDS (interest declarations + bid amounts)
-- =============================================
create table public.bids (
  id            uuid primary key default gen_random_uuid(),
  lot_id        uuid not null references public.auction_lots(id) on delete cascade,
  team_id       uuid not null references public.teams(id),
  amount        numeric(5,2),       -- null during interest phase
  is_interested boolean not null default true, -- false = passed on this player
  is_folded     boolean not null default false, -- folded during bid round (eliminated)
  created_at    timestamptz not null default now(),

  constraint unique_bid_per_team_per_lot unique (lot_id, team_id)
);

-- =============================================
-- AUCTION LOG (for 10-move undo + live feed)
-- =============================================
create table public.auction_log (
  id          uuid primary key default gen_random_uuid(),
  auction_id  uuid not null references public.auctions(id) on delete cascade,
  action_type text not null,
  -- e.g. 'player_assigned', 'bid_placed', 'timer_reset', 'bid_corrected', 'draft_ended'
  payload     jsonb not null default '{}',
  -- For undo: store enough to fully reverse the action
  -- payload for player_assigned: { lot_id, team_id, amount, prev_base_price, prev_budget }
  created_at  timestamptz not null default now()
);

-- =============================================
-- TEAM DROPS (drop staging for each auction)
-- =============================================
create table public.team_drops (
  id                      uuid primary key default gen_random_uuid(),
  team_id                 uuid not null references public.teams(id),
  auction_id              uuid not null references public.auctions(id),
  player_id               integer not null references public.players(id),
  drop_price              numeric(5,2), -- ceil(purchase_price * 0.5); set on lock
  status                  text not null default 'staged'
                            check (status in ('staged', 'locked', 'cancelled')),
  -- Restriction flags (evaluated when drops are locked at auction start)
  dropped_post_january    boolean not null default false,
  -- The gameweek in which the -4pt penalty will be applied (set at lock time)
  penalty_gameweek        integer,
  created_at              timestamptz not null default now(),

  constraint unique_drop_per_player_per_auction unique (player_id, auction_id)
);

-- =============================================
-- TEAM DROP TRANSFER RECORDS (free transfer tracking)
-- =============================================
create table public.team_transfer_records (
  id                       uuid primary key default gen_random_uuid(),
  team_id                  uuid not null references public.teams(id),
  auction_id               uuid not null references public.auctions(id),
  free_transfers_base      integer not null default 2,
  free_transfers_carryover integer not null default 0, -- max 1 rolled over
  transfers_used           integer not null default 0,
  -- Excess = max(0, transfers_used - (free_transfers_base + free_transfers_carryover))
  excess_drops             integer not null default 0,
  points_penalty           integer not null default 0, -- -4 * excess_drops

  constraint unique_team_auction unique (team_id, auction_id)
);

-- =============================================
-- GAMEWEEK POINTS (scoring)
-- =============================================
create table public.gameweek_points (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.teams(id),
  gameweek      integer not null,
  player_id     integer not null references public.players(id),
  points        integer not null default 0,
  was_subbed_in boolean not null default false, -- true if this was an auto-sub
  created_at    timestamptz not null default now(),

  constraint unique_player_team_gw unique (team_id, gameweek, player_id)
);

-- =============================================
-- ROW LEVEL SECURITY
-- =============================================
alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.players enable row level security;
alter table public.roster_entries enable row level security;
alter table public.auctions enable row level security;
alter table public.auction_lots enable row level security;
alter table public.bids enable row level security;
alter table public.auction_log enable row level security;
alter table public.team_drops enable row level security;
alter table public.team_transfer_records enable row level security;
alter table public.gameweek_points enable row level security;

-- Helper: get the current user's role
create or replace function public.get_my_role()
returns text language sql stable security definer as $$
  select role from public.profiles where id = auth.uid()
$$;

-- Helper: get the current user's team_id
create or replace function public.get_my_team_id()
returns uuid language sql stable security definer as $$
  select team_id from public.profiles where id = auth.uid()
$$;

-- ── READ policies (all authenticated + anon guests can read everything) ──────

create policy "Anyone can read profiles"     on public.profiles         for select using (true);
create policy "Anyone can read teams"        on public.teams            for select using (true);
create policy "Anyone can read players"      on public.players          for select using (true);
create policy "Anyone can read roster"       on public.roster_entries   for select using (true);
create policy "Anyone can read auctions"     on public.auctions         for select using (true);
create policy "Anyone can read lots"         on public.auction_lots     for select using (true);
create policy "Anyone can read bids"         on public.bids             for select using (true);
create policy "Anyone can read log"          on public.auction_log      for select using (true);
create policy "Anyone can read drops"        on public.team_drops       for select using (true);
create policy "Anyone can read transfers"    on public.team_transfer_records for select using (true);
create policy "Anyone can read gw points"   on public.gameweek_points  for select using (true);

-- ── WRITE policies ────────────────────────────────────────────────────────────

-- Admin: full write on everything
create policy "Admin full write profiles"    on public.profiles    for all to authenticated using (get_my_role() = 'admin');
create policy "Admin full write teams"       on public.teams       for all to authenticated using (get_my_role() = 'admin');
create policy "Admin full write players"     on public.players     for all to authenticated using (get_my_role() = 'admin');
create policy "Admin full write roster"      on public.roster_entries for all to authenticated using (get_my_role() = 'admin');
create policy "Admin full write auctions"    on public.auctions    for all to authenticated using (get_my_role() = 'admin');
create policy "Admin full write lots"        on public.auction_lots for all to authenticated using (get_my_role() = 'admin');
create policy "Admin full write bids"        on public.bids        for all to authenticated using (get_my_role() = 'admin');
create policy "Admin full write log"         on public.auction_log for all to authenticated using (get_my_role() = 'admin');
create policy "Admin full write drops"       on public.team_drops  for all to authenticated using (get_my_role() = 'admin');
create policy "Admin full write transfers"   on public.team_transfer_records for all to authenticated using (get_my_role() = 'admin');
create policy "Admin full write gw points"   on public.gameweek_points for all to authenticated using (get_my_role() = 'admin');

-- Auction Master: write on auction-related tables (admin already covered above)
create policy "AM write auctions"     on public.auctions       for all to authenticated using (get_my_role() in ('admin','auction_master'));
create policy "AM write lots"         on public.auction_lots   for all to authenticated using (get_my_role() in ('admin','auction_master'));
create policy "AM write log"          on public.auction_log    for all to authenticated using (get_my_role() in ('admin','auction_master'));
create policy "AM write drops lock"   on public.team_drops     for update to authenticated using (get_my_role() in ('admin','auction_master'));
create policy "AM write transfers"    on public.team_transfer_records for all to authenticated using (get_my_role() in ('admin','auction_master'));
create policy "AM write gw points"    on public.gameweek_points for all to authenticated using (get_my_role() in ('admin','auction_master'));

-- Teams: write own bids + own roster entries + own drops
create policy "Team writes own bids" on public.bids
  for insert to authenticated
  with check (team_id = get_my_team_id());

create policy "Team writes own roster" on public.roster_entries
  for all to authenticated
  using (team_id = get_my_team_id());

create policy "Team stages own drops" on public.team_drops
  for insert to authenticated
  with check (team_id = get_my_team_id() and status = 'staged');

create policy "Team updates own staged drops" on public.team_drops
  for update to authenticated
  using (team_id = get_my_team_id() and status = 'staged');

-- Service role: sync players from FPL API
create policy "Service role syncs players" on public.players
  for all to service_role using (true);

-- Profiles: users can update their own password/display_name
create policy "User updates own profile" on public.profiles
  for update to authenticated
  using (id = auth.uid());

-- =============================================
-- REALTIME
-- =============================================
alter publication supabase_realtime add table public.auction_lots;
alter publication supabase_realtime add table public.bids;
alter publication supabase_realtime add table public.auction_log;
alter publication supabase_realtime add table public.teams;
alter publication supabase_realtime add table public.roster_entries;

-- =============================================
-- SEED: 7 teams
-- Update display_name, short_name, color, auction_order after creation
-- =============================================
insert into public.teams (display_name, short_name, color, auction_order) values
  ('Team 1 FC', 'T1', '#10b981', 1),
  ('Team 2 FC', 'T2', '#3b82f6', 2),
  ('Team 3 FC', 'T3', '#f59e0b', 3),
  ('Team 4 FC', 'T4', '#ef4444', 4),
  ('Team 5 FC', 'T5', '#8b5cf6', 5),
  ('Team 6 FC', 'T6', '#ec4899', 6),
  ('Team 7 FC', 'T7', '#06b6d4', 7);
