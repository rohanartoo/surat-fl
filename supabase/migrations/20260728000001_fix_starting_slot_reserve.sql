-- rpc_assign_player's starting-vs-bench choice only checked "is the XI
-- already at 11?" and "is this position's own cap hit?" — it never reserved
-- room for positions not yet drafted. Since drafting always proceeds
-- GK -> DEF -> MID -> FWD, any team that fills DEF(5) + MID(5) on top of
-- their GK(1) before ever buying a FWD locks in exactly 11 starters with
-- zero FWD, and every FWD bought afterward is forced to the bench —
-- guaranteed to violate min_starting.FWD (1). Confirmed live: every team
-- mid-draft (Citrus FC, Cursed Scousers, Kop FC) had exactly this: 1 GK,
-- 5 DEF, 5 MID, 0 FWD in their Starting XI.
--
-- Fix: before assigning a player to 'starting', reserve enough of the 11
-- slots to guarantee the minimum requirement of every position later in
-- the draft order (GK, DEF, MID, FWD) can still be met, based on how many
-- of that minimum the team has already filled. A player only starts if
-- doing so still leaves room for that reserve.
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
  v_max_slots int;
  v_prev_base_price numeric;
  v_active uuid[];
  v_def_starters int;
  v_mid_starters int;
  v_fwd_starters int;
  v_reserve int;
begin
  select * into v_lot from public.auction_lots where id = p_lot_id for update;
  if not found then
    raise exception 'Lot not found.';
  end if;
  if v_lot.phase <> 'bidding' then
    raise exception 'Lot is not in bidding phase.';
  end if;

  select web_name, position, fpl_team, base_price into v_player_name, v_position, v_fpl_team, v_prev_base_price
    from public.players where id = v_lot.player_id;

  v_team_id := v_lot.current_bidder_id;
  v_price := v_lot.current_bid;

  -- No bid was ever placed: the sole remaining active bidder takes the player
  -- at base price. Anything other than exactly one survivor is still an error.
  if v_team_id is null or v_price is null then
    select array_agg(team_id) into v_active from public.bids
      where lot_id = p_lot_id and is_interested = true and is_folded = false;
    if v_active is null or array_length(v_active, 1) <> 1 then
      raise exception 'No bid placed yet.';
    end if;
    v_team_id := v_active[1];
    v_price := v_prev_base_price;
  end if;

  select budget, display_name into v_budget, v_team_name from public.teams where id = v_team_id for update;
  if not found then
    raise exception 'Winning team not found.';
  end if;

  v_new_budget := v_budget - v_price;
  if v_new_budget < 0 then
    raise exception 'Team cannot afford this player.';
  end if;

  if v_fpl_team is not null and v_fpl_team <> '' then
    select count(*) into v_club_count
      from public.roster_entries re join public.players p on p.id = re.player_id
      where re.team_id = v_team_id and re.slot_type in ('starting', 'bench') and p.fpl_team = v_fpl_team;
    if v_club_count >= 3 then
      raise exception 'Club cap reached: team already has 3 players from %.', v_fpl_team;
    end if;
  end if;

  select count(*) into v_starters from public.roster_entries re
    where re.team_id = v_team_id and re.slot_type = 'starting';
  select count(*) into v_starters_at_pos from public.roster_entries re
    join public.players p on p.id = re.player_id
    where re.team_id = v_team_id and re.slot_type = 'starting' and p.position = v_position;

  v_max_slots := case v_position
    when 'GK' then 1 when 'DEF' then 5 when 'MID' then 5 when 'FWD' then 3 end;

  -- Reserve starting slots for positions still to come in draft order, based
  -- on min_starting (GK 1, DEF 3, MID 2, FWD 1) minus what's already filled.
  select
    count(*) filter (where p.position = 'DEF'),
    count(*) filter (where p.position = 'MID'),
    count(*) filter (where p.position = 'FWD')
    into v_def_starters, v_mid_starters, v_fwd_starters
    from public.roster_entries re join public.players p on p.id = re.player_id
    where re.team_id = v_team_id and re.slot_type = 'starting';

  v_reserve := case v_position
    when 'GK' then greatest(0, 3 - v_def_starters) + greatest(0, 2 - v_mid_starters) + greatest(0, 1 - v_fwd_starters)
    when 'DEF' then greatest(0, 2 - v_mid_starters) + greatest(0, 1 - v_fwd_starters)
    when 'MID' then greatest(0, 1 - v_fwd_starters)
    else 0
  end;

  if v_starters >= (11 - v_reserve) or v_starters_at_pos >= v_max_slots then
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
    set phase = 'concluded', winning_team_id = v_team_id, winning_bid = v_price,
        current_bid = v_price, current_bidder_id = v_team_id, current_turn_team_id = null
    where id = p_lot_id;

  select * into v_auction from public.auctions where id = v_lot.auction_id for update;
  perform public.rpc_advance_bidder(v_lot.auction_id, v_position);

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
