-- Close direct database writes for team accounts.
--
-- Every change a team makes (lineup swaps, captaincy, drops, interest, bids,
-- team name) goes through a server API route that enforces the league rules
-- and writes with the service role. These policies were never used by the
-- app, but let a signed-in team write straight from the browser with its own
-- session — e.g. raise its own teams.budget (the "display_name" policy is
-- row-level, so it covered every column), add any player to its roster past
-- the lineup deadline, or insert itself as interested in a player it may not
-- re-draft. Auction master and admin write policies are deliberately kept.

drop policy if exists "Team writes own bids"          on public.bids;
drop policy if exists "Team updates own bids"         on public.bids;
drop policy if exists "Team writes own roster"        on public.roster_entries;
drop policy if exists "Team stages own drops"         on public.team_drops;
drop policy if exists "Team updates own staged drops" on public.team_drops;
drop policy if exists "Team updates own display_name" on public.teams;

-- rpc_* functions are only ever called by server routes (service role), but
-- Supabase's default privileges grant EXECUTE to PUBLIC, anon and
-- authenticated. They are SECURITY INVOKER, so they were already bound by the
-- policies above — revoke anyway so browser calls fail outright rather than
-- depending on RLS. Looped over pg_proc so every overload is covered even if
-- a signature has drifted between environments.
do $$
declare
  fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'rpc\_%'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
