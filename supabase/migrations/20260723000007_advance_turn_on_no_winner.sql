-- The turn pointer (auctions.current_bidder_index — who starts the NEXT
-- nomination) only ever advanced inside rpc_assign_player, i.e. only when a
-- player was actually won. Closing a lot with no winner (return-to-pool, or
-- zero interest declared) left the pointer untouched, so the same team kept
-- opening every no-winner round indefinitely while a won lot correctly
-- rotated forward — reported as: two teams fold on a nominated player, the
-- lot is returned to the pool, and the very same team that went first
-- starts the next nomination too, instead of the rotation continuing.
--
-- Every lot conclusion — won or not — should advance the pointer to the
-- next eligible team (skipping anyone already full at the current
-- position), so turn order is a strict continuous round-robin across every
-- nomination regardless of outcome. This introduces rpc_conclude_lot_no_
-- winner, used by both no-winner paths (return-to-pool and zero-interest),
-- mirroring the exact advance logic rpc_assign_player already uses.

create or replace function public.rpc_conclude_lot_no_winner(p_lot_id uuid, p_log_action text)
returns table(next_bidder_id uuid) as $$
declare
  v_lot public.auction_lots%rowtype;
  v_auction public.auctions%rowtype;
  v_position text;
  v_filled_by_team jsonb;
  v_teams_with_open_slots uuid[];
  v_max_slots int;
  v_next_idx int;
  v_next_team uuid;
begin
  select * into v_lot from public.auction_lots where id = p_lot_id for update;
  if not found then
    raise exception 'Lot not found.';
  end if;
  if v_lot.phase not in ('interest', 'bidding') then
    raise exception 'Lot is not open.';
  end if;

  select position into v_position from public.players where id = v_lot.player_id;

  update public.auction_lots
    set phase = 'concluded', current_turn_team_id = null
    where id = p_lot_id;

  select * into v_auction from public.auctions where id = v_lot.auction_id for update;

  -- Mirrors the advance logic in rpc_assign_player
  select jsonb_object_agg(re.team_id, cnt) into v_filled_by_team
    from (
      select re.team_id, count(*) cnt
      from public.roster_entries re join public.players p on p.id = re.player_id
      where re.slot_type in ('starting', 'bench') and p.position = v_position
      group by re.team_id
    ) re;

  v_max_slots := case v_position
    when 'GK' then 2 when 'DEF' then 5 when 'MID' then 5 when 'FWD' then 3 end;

  select array_agg(t.team_id::uuid) into v_teams_with_open_slots
    from jsonb_array_elements_text(v_auction.auction_order) as t(team_id)
    where coalesce((v_filled_by_team ->> t.team_id)::int, 0) < v_max_slots;

  select nb.team_id, nb.idx into v_next_team, v_next_idx
    from public.next_bidder(
      v_auction.auction_order,
      (v_auction.current_bidder_index + 1) % greatest(jsonb_array_length(v_auction.auction_order), 1),
      coalesce(v_teams_with_open_slots, array[]::uuid[])
    ) nb;

  update public.auctions
    set current_bidder_index = coalesce(v_next_idx, v_auction.current_bidder_index)
    where id = v_lot.auction_id;

  insert into public.auction_log (auction_id, action_type, payload)
    values (v_lot.auction_id, p_log_action, jsonb_build_object(
      'lot_id', p_lot_id, 'player_id', v_lot.player_id
    ));

  next_bidder_id := v_next_team;
  return next;
end;
$$ language plpgsql;

grant execute on function public.rpc_conclude_lot_no_winner(uuid, text) to authenticated, anon, service_role;
