-- Marks a gameweek's scoring as final (auto-subs and captain->VC fallback
-- resolved). Read by src/lib/lineup-lock.ts: a gameweek whose deadline has
-- passed stays locked until it has a row here, and syncGameweekPoints
-- refuses to rebuild a finalized gameweek's roster from current
-- roster_entries — only points/stat_breakdown may still move (FPL bonus
-- corrections), never who was on the pitch that week.

create table public.gameweek_scoring_status (
  gameweek     int primary key check (gameweek between 1 and 38),
  finalized_at timestamptz not null default now(),
  finalized_by text not null default 'cron'
);

grant select, insert, update, delete on public.gameweek_scoring_status to authenticated, anon, service_role;

alter table public.gameweek_scoring_status enable row level security;

create policy "Anyone can read scoring status" on public.gameweek_scoring_status for select using (true);
create policy "Service role writes scoring status" on public.gameweek_scoring_status for all to service_role using (true) with check (true);
