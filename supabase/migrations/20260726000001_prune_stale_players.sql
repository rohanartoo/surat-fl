-- /api/fpl/sync has only ever upserted players by FPL element id, never
-- removing rows that drop out of FPL's live feed. FPL reissues new element
-- ids for players fairly often (confirmed live: ~100 pairs of rows with
-- identical web_name/fpl_team/position but two different ids, one from an
-- older sync). The stale twin of an already-drafted player has no roster
-- entry under its own id, so it silently reappears as "available" in the
-- nomination pool, allowing the same real player to be drafted twice. The
-- same missing-prune bug is why long-gone clubs (relegated teams, teams
-- from past seasons) never disappear from the player pool either.
--
-- Deletes any player row not present in the latest FPL sync AND not
-- referenced anywhere (roster history, auction lots, drops, gameweek
-- points) — never touches a player who has ever actually been part of the
-- league's history.
create or replace function public.rpc_prune_stale_players(p_current_ids int[])
returns table(pruned int) as $$
declare
  v_pruned int;
begin
  delete from public.players p
  where not (p.id = any(p_current_ids))
    and not exists (select 1 from public.roster_entries re where re.player_id = p.id)
    and not exists (select 1 from public.auction_lots al where al.player_id = p.id)
    and not exists (select 1 from public.team_drops td where td.player_id = p.id)
    and not exists (select 1 from public.gameweek_points gp where gp.player_id = p.id);
  get diagnostics v_pruned = row_count;
  pruned := v_pruned;
  return next;
end;
$$ language plpgsql;

grant execute on function public.rpc_prune_stale_players(int[]) to authenticated, anon, service_role;
