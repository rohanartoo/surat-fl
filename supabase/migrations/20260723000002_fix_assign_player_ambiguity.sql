-- Fix: "column reference \"slot_type\" is ambiguous" in rpc_assign_player.
--
-- The function's OUT parameter `slot_type` (from `returns table(slot_type text, ...)`)
-- collides with public.roster_entries.slot_type in two unqualified queries, so every
-- call raised 42702 before writing anything. Qualifying the column references with a
-- table alias resolves it. Behaviour is otherwise identical to 20260723000001.

create or replace function public.rpc_assign_player(p_lot_id uuid)
returns table(slot_type text, new_budget numeric, player_name text, team_name text, price numeric) as $$
declare
  v_lot public.auction_lots%rowtype;
  v_auction public.auctions%rowtype;
  v_team_id uuid;
  v_price numeric;
  v_budget numeric;
  v_team_name text;
  v_player_name text;
  v_position text;
  v_fpl_team text;
  v_club_count int;
  v_starters int;
  v_starters_at_pos int;
  v_slot_type text;
  v_bench_order int;
  v_new_budget numeric;
  v_filled_by_team jsonb;
  v_teams_with_open_slots uuid[];
  v_max_slots int;
  v_next_idx int;
  v_next_team uuid;
  v_prev_base_price numeric;
begin
  select * into v_lot from public.auction_lots where id = p_lot_id for update;
  if not found then
    raise exception 'Lot not found.';
  end if;
  if v_lot.phase <> 'bidding' then
    raise exception 'Lot is not in bidding phase.';
  end if;
  if v_lot.current_bidder_id is null or v_lot.current_bid is null then
    raise exception 'No bid placed yet.';
  end if;

  v_team_id := v_lot.current_bidder_id;
  v_price := v_lot.current_bid;

  select budget, display_name into v_budget, v_team_name from public.teams where id = v_team_id for update;
  if not found then
    raise exception 'Winning team not found.';
  end if;

  v_new_budget := v_budget - v_price;
  if v_new_budget < 0 then
    raise exception 'Team cannot afford this player.';
  end if;

  select web_name, position, fpl_team, base_price into v_player_name, v_position, v_fpl_team, v_prev_base_price
    from public.players where id = v_lot.player_id;

  if v_fpl_team is not null and v_fpl_team <> '' then
    select count(*) into v_club_count
      from public.roster_entries re join public.players p on p.id = re.player_id
      where re.team_id = v_team_id and re.slot_type in ('starting', 'bench') and p.fpl_team = v_fpl_team;
    if v_club_count >= 3 then
      raise exception 'Club cap reached: team already has 3 players from %.', v_fpl_team;
    end if;
  end if;

  -- Mirrors chooseSlotType() in src/lib/auction-engine.ts
  select count(*) into v_starters from public.roster_entries re
    where re.team_id = v_team_id and re.slot_type = 'starting';
  select count(*) into v_starters_at_pos from public.roster_entries re
    join public.players p on p.id = re.player_id
    where re.team_id = v_team_id and re.slot_type = 'starting' and p.position = v_position;

  v_max_slots := case v_position
    when 'GK' then 1 when 'DEF' then 5 when 'MID' then 5 when 'FWD' then 3 end;

  if v_starters >= 11 or v_starters_at_pos >= v_max_slots then
    v_slot_type := 'bench';
  else
    v_slot_type := 'starting';
  end if;

  v_bench_order := null;
  if v_slot_type = 'bench' then
    select min(n) into v_bench_order from unnest(array[1,2,3,4]) as n
      where n not in (
        select re.bench_order from public.roster_entries re
        where re.team_id = v_team_id and re.slot_type = 'bench' and re.bench_order is not null
      );
  end if;

  insert into public.roster_entries (team_id, player_id, slot_type, bench_order, base_price, is_captain, is_vice_captain)
    values (v_team_id, v_lot.player_id, v_slot_type, v_bench_order, v_price, false, false);

  update public.teams set budget = v_new_budget where id = v_team_id;
  update public.players set base_price = v_price where id = v_lot.player_id;
  update public.auction_lots
    set phase = 'concluded', winning_team_id = v_team_id, winning_bid = v_price, current_turn_team_id = null
    where id = p_lot_id;

  select * into v_auction from public.auctions where id = v_lot.auction_id for update;

  -- Mirrors getNextBidStartIndex() advance logic in autoAssign()
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
    values (v_lot.auction_id, 'player_assigned', jsonb_build_object(
      'lot_id', p_lot_id, 'player_id', v_lot.player_id, 'player_name', v_player_name,
      'winning_team_id', v_team_id, 'winning_team_name', coalesce(v_team_name, ''),
      'winning_bid', v_price, 'prev_budget', v_budget, 'prev_base_price', v_prev_base_price,
      'prev_bidder_index', v_auction.current_bidder_index
    ));

  slot_type := v_slot_type;
  new_budget := v_new_budget;
  player_name := v_player_name;
  team_name := v_team_name;
  price := v_price;
  return next;
end;
$$ language plpgsql;

grant execute on function public.rpc_assign_player(uuid) to authenticated, anon, service_role;
