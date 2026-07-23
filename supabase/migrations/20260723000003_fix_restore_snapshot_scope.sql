-- Fix two pre-existing gaps in the pre-auction snapshot restore (used by
-- "Cancel auction" and the admin reset). Both only bite when players were
-- drafted into slots that were empty at snapshot time — i.e. exactly the
-- initial auction.
--
-- 1. Roster entries were only deleted for teams that appeared in the
--    snapshot's roster_entries array. In an initial auction every team
--    starts with an empty squad, so that array is empty, no team ids were
--    derived, and nothing was deleted: cancelling left every drafted player
--    on their roster while budgets were restored to £100m.
--    handleStart snapshots the whole league unscoped (all teams, all roster
--    rows), so the correct restore is a full replace, not a per-team one.
--
-- 2. Player base_price was only restored for players rostered at snapshot
--    time, because that is all handleStart records prices for. Players
--    drafted during the auction kept the winning bid as their new base
--    price after a cancel. Those are recovered here from the
--    'player_assigned' auction_log payload's prev_base_price instead
--    (earliest assignment per player, so assign -> undo -> assign cycles
--    still resolve back to the original price).

create or replace function public.rpc_restore_snapshot(p_auction_id uuid)
returns table(restored boolean) as $$
declare
  v_snapshot jsonb;
begin
  select snapshot into v_snapshot from public.auction_snapshots where auction_id = p_auction_id for update;
  if v_snapshot is null then
    restored := false;
    return next;
    return;
  end if;

  update public.teams t set budget = (elem ->> 'budget')::numeric
    from jsonb_array_elements(v_snapshot -> 'teams') as elem
    where t.id = (elem ->> 'id')::uuid;

  update public.players p set base_price = (elem ->> 'base_price')::numeric
    from jsonb_array_elements(v_snapshot -> 'players') as elem
    where p.id = (elem ->> 'id')::int;

  -- Restore prices for players drafted during this auction (not covered by
  -- the snapshot, which only holds prices for already-rostered players).
  update public.players p set base_price = a.prev_base_price
    from (
      select distinct on ((payload ->> 'player_id')::int)
        (payload ->> 'player_id')::int as player_id,
        (payload ->> 'prev_base_price')::numeric as prev_base_price
      from public.auction_log
      where auction_id = p_auction_id
        and action_type = 'player_assigned'
        and payload ? 'prev_base_price'
        and payload ->> 'prev_base_price' is not null
      order by (payload ->> 'player_id')::int, created_at asc
    ) a
    where p.id = a.player_id;

  -- Full replace: the snapshot is a whole-league capture, so anything not in
  -- it should not exist after a restore. The predicate is a no-op filter that
  -- matches every row; it is required because pg_safeupdate blocks
  -- unqualified DELETEs.
  delete from public.roster_entries where id is not null;

  insert into public.roster_entries (id, team_id, player_id, slot_type, bench_order, is_captain, is_vice_captain, base_price)
    select id, team_id, player_id, slot_type, bench_order, is_captain, is_vice_captain, base_price
    from jsonb_to_recordset(v_snapshot -> 'roster_entries') as x(
      id uuid, team_id uuid, player_id int, slot_type text,
      bench_order int, is_captain boolean, is_vice_captain boolean, base_price numeric
    );

  delete from public.team_drops where auction_id = p_auction_id;

  insert into public.team_drops (id, team_id, auction_id, player_id, drop_price, status, dropped_post_january, dropped_post_summer, penalty_gameweek)
    select id, team_id, p_auction_id, player_id, drop_price, 'staged', dropped_post_january, dropped_post_summer, penalty_gameweek
    from jsonb_to_recordset(v_snapshot -> 'team_drops') as x(
      id uuid, team_id uuid, player_id int, drop_price numeric, status text,
      dropped_post_january boolean, dropped_post_summer boolean, penalty_gameweek int
    );

  restored := true;
  return next;
end;
$$ language plpgsql;

grant execute on function public.rpc_restore_snapshot(uuid) to authenticated, anon, service_role;
