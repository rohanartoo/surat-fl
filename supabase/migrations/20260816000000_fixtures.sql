-- Fixtures: synced from FPL's /fixtures/ endpoint alongside players, so the
-- My Team page can show each player's upcoming opponent when picking a
-- lineup. Team names are stored directly on the row (matching
-- players.fpl_team/fpl_team_short exactly) rather than a numeric FPL team
-- id, so joining against players is a plain string match.

create table public.fixtures (
  id           int primary key,   -- FPL fixture id
  event        int,               -- gameweek number; null if not yet scheduled
  team_h_name  text not null,
  team_a_name  text not null,
  team_h_short text not null,
  team_a_short text not null,
  kickoff_time timestamptz,
  finished     boolean not null default false
);

grant select, insert, update, delete on public.fixtures to authenticated, anon, service_role;

alter table public.fixtures enable row level security;

create policy "Anyone can read fixtures" on public.fixtures for select using (true);
create policy "Service role syncs fixtures" on public.fixtures for all to service_role using (true);
