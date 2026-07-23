-- =============================================
-- Auction concurrency hardening
-- =============================================
-- Every auction mutation that previously did read (JS) -> validate (JS) ->
-- write (JS) as separate sequential Supabase calls is moved here into a
-- single plpgsql function per action. Each function takes a row lock
-- (`select ... for update`) on the lot/team it mutates and does all
-- validation + writes inside one transaction, so two requests racing
-- against the same lot can no longer both pass validation against the
-- same stale read.

-- =============================================
-- HELPERS
-- =============================================

-- Index of a team id within an auction_order jsonb array (array of team-id
-- strings), or -1 if not present. Mirrors indexOf() usage in the old TS code.
create or replace function public.index_of_team(p_auction_order jsonb, p_team_id uuid)
returns int as $$
declare
  n int := jsonb_array_length(p_auction_order);
  i int;
begin
  for i in 0..n - 1 loop
    if (p_auction_order ->> i)::uuid = p_team_id then
      return i;
    end if;
  end loop;
  return -1;
end;
$$ language plpgsql;

-- Mirrors getNextBidder()/getNextBidStartIndex() in src/lib/auction-engine.ts:
-- walks auction_order starting at p_start_index (wrapping once) and returns
-- the first team id present in p_eligible, or nulls if none found.
create or replace function public.next_bidder(
  p_auction_order jsonb,
  p_start_index int,
  p_eligible uuid[],
  out team_id uuid,
  out idx int
) as $$
declare
  n int := jsonb_array_length(p_auction_order);
  i int;
  cand uuid;
  cand_idx int;
begin
  team_id := null;
  idx := null;
  if n = 0 or p_eligible is null then
    return;
  end if;
  for i in 0..n - 1 loop
    cand_idx := (p_start_index + i) % n;
    cand := (p_auction_order ->> cand_idx)::uuid;
    if cand = any(p_eligible) then
      team_id := cand;
      idx := cand_idx;
      return;
    end if;
  end loop;
end;
$$ language plpgsql;

grant execute on function public.index_of_team(jsonb, uuid) to authenticated, anon, service_role;
grant execute on function public.next_bidder(jsonb, int, uuid[]) to authenticated, anon, service_role;

-- =============================================
-- PLACE-BID
-- =============================================
create or replace function public.rpc_place_bid(p_lot_id uuid, p_team_id uuid, p_amount numeric)
returns table(new_high numeric, next_turn_team_id uuid) as $$
declare
  v_lot public.auction_lots%rowtype;
  v_auction_order jsonb;
  v_budget numeric;
  v_base_price numeric;
  v_min_next numeric;
  v_increment numeric;
  v_max_allowed numeric;
  v_empty_slots int;
  v_is_folded boolean;
  v_is_interested boolean;
  v_active_after uuid[];
  v_current_index int;
  v_next_team uuid;
  v_next_idx int;
  v_team_name text;
begin
  select * into v_lot from public.auction_lots where id = p_lot_id for update;
  if not found then
    raise exception 'Lot not found.';
  end if;
  if v_lot.phase <> 'bidding' then
    raise exception 'Lot is not in bidding phase.';
  end if;
  if v_lot.current_turn_team_id is null then
    raise exception 'No active turn — waiting on the auction master.';
  end if;
  if v_lot.current_turn_team_id <> p_team_id then
    raise exception 'It is not your turn to bid.';
  end if;

  select is_folded, is_interested into v_is_folded, v_is_interested
    from public.bids where lot_id = p_lot_id and team_id = p_team_id;
  if v_is_folded is true then
    raise exception 'Your team has already folded.';
  end if;
  if v_is_interested is false then
    raise exception 'Your team passed on this player.';
  end if;

  select budget, display_name into v_budget, v_team_name from public.teams where id = p_team_id for update;
  if not found then
    raise exception 'Team not found.';
  end if;

  select base_price into v_base_price from public.players where id = v_lot.player_id;

  select 15 - count(*) into v_empty_slots from public.roster_entries
    where team_id = p_team_id and slot_type in ('starting', 'bench');

  if p_amount is null or p_amount <> floor(p_amount) then
    raise exception 'Bid must be a whole number.';
  end if;

  if v_lot.current_bid is null then
    if p_amount < v_base_price then
      raise exception 'Opening bid must be at least £%m.', v_base_price;
    end if;
  else
    v_increment := case when v_lot.current_bid >= 20 then 2 else 1 end;
    v_min_next := v_lot.current_bid + v_increment;
    if p_amount < v_min_next then
      raise exception 'Bid must be at least £%m (minimum +£%m).', v_min_next, v_increment;
    end if;
  end if;

  v_max_allowed := v_budget - (v_empty_slots - 1);
  if p_amount > v_max_allowed then
    raise exception 'Maximum bid is £%m (need £1m for each remaining slot).', v_max_allowed;
  end if;

  select array_agg(team_id) into v_active_after from public.bids
    where lot_id = p_lot_id and is_interested = true and is_folded = false and team_id <> p_team_id;

  select auction_order into v_auction_order from public.auctions where id = v_lot.auction_id;
  v_current_index := public.index_of_team(v_auction_order, p_team_id);

  select nb.team_id, nb.idx into v_next_team, v_next_idx
    from public.next_bidder(
      v_auction_order,
      (v_current_index + 1) % greatest(jsonb_array_length(v_auction_order), 1),
      coalesce(v_active_after, array[]::uuid[])
    ) nb;

  update public.auction_lots
    set current_bid = p_amount, current_bidder_id = p_team_id, current_turn_team_id = v_next_team
    where id = p_lot_id;

  insert into public.bids (lot_id, team_id, amount, is_interested, is_folded)
    values (p_lot_id, p_team_id, p_amount, true, false)
    on conflict (lot_id, team_id) do update set amount = excluded.amount, is_interested = true, is_folded = false;

  insert into public.auction_log (auction_id, action_type, payload)
    values (v_lot.auction_id, 'bid_placed', jsonb_build_object(
      'lot_id', p_lot_id, 'team_id', p_team_id, 'team_name', coalesce(v_team_name, ''),
      'amount', p_amount, 'prev_high_bid', v_lot.current_bid, 'next_turn_team_id', v_next_team
    ));

  new_high := p_amount;
  next_turn_team_id := v_next_team;
  return next;
end;
$$ language plpgsql;

grant execute on function public.rpc_place_bid(uuid, uuid, numeric) to authenticated, anon, service_role;

-- =============================================
-- FOLD
-- =============================================
create or replace function public.rpc_fold_bid(p_lot_id uuid, p_team_id uuid)
returns table(concluded boolean, reason text, active_bidders int, next_turn_team_id uuid, pending_winner uuid) as $$
declare
  v_lot public.auction_lots%rowtype;
  v_team_name text;
  v_active uuid[];
  v_auction_order jsonb;
  v_current_index int;
  v_next_team uuid;
  v_next_idx int;
begin
  select * into v_lot from public.auction_lots where id = p_lot_id for update;
  if not found then
    raise exception 'Lot not found.';
  end if;
  if v_lot.phase <> 'bidding' then
    raise exception 'Lot is not in bidding phase.';
  end if;
  if v_lot.current_turn_team_id is null then
    raise exception 'No active turn — waiting on the auction master.';
  end if;
  if v_lot.current_turn_team_id <> p_team_id then
    raise exception 'It is not your turn.';
  end if;

  update public.bids set is_folded = true where lot_id = p_lot_id and team_id = p_team_id;

  select display_name into v_team_name from public.teams where id = p_team_id;
  insert into public.auction_log (auction_id, action_type, payload)
    values (v_lot.auction_id, 'team_folded', jsonb_build_object(
      'lot_id', p_lot_id, 'team_id', p_team_id, 'team_name', coalesce(v_team_name, '')
    ));

  select array_agg(team_id) into v_active from public.bids
    where lot_id = p_lot_id and is_interested = true and is_folded = false;

  if v_active is null or array_length(v_active, 1) is null then
    update public.auction_lots set phase = 'concluded', current_turn_team_id = null where id = p_lot_id;
    concluded := true;
    reason := 'all_folded';
    active_bidders := 0;
    next_turn_team_id := null;
    pending_winner := null;
    return next;
    return;
  end if;

  if array_length(v_active, 1) = 1 then
    update public.auction_lots set current_turn_team_id = null where id = p_lot_id;
    concluded := false;
    reason := null;
    active_bidders := 1;
    next_turn_team_id := null;
    pending_winner := v_active[1];
    return next;
    return;
  end if;

  select auction_order into v_auction_order from public.auctions where id = v_lot.auction_id;
  v_current_index := public.index_of_team(v_auction_order, p_team_id);

  select nb.team_id, nb.idx into v_next_team, v_next_idx
    from public.next_bidder(
      v_auction_order,
      (v_current_index + 1) % greatest(jsonb_array_length(v_auction_order), 1),
      v_active
    ) nb;

  update public.auction_lots set current_turn_team_id = v_next_team where id = p_lot_id;
  concluded := false;
  reason := null;
  active_bidders := array_length(v_active, 1);
  next_turn_team_id := v_next_team;
  pending_winner := null;
  return next;
end;
$$ language plpgsql;

grant execute on function public.rpc_fold_bid(uuid, uuid) to authenticated, anon, service_role;

-- =============================================
-- UNDO-BID
-- =============================================
create or replace function public.rpc_undo_bid(p_lot_id uuid, p_team_id uuid)
returns table(restored_bid numeric) as $$
declare
  v_lot public.auction_lots%rowtype;
  v_prev_amount numeric;
  v_prev_bidder uuid;
  v_undone_amount numeric;
  v_team_name text;
begin
  select * into v_lot from public.auction_lots where id = p_lot_id for update;
  if not found then
    raise exception 'Lot not found.';
  end if;
  if v_lot.phase <> 'bidding' then
    raise exception 'Lot is not in bidding phase.';
  end if;
  if v_lot.current_bidder_id is distinct from p_team_id then
    raise exception 'You can only undo your own bid while it is still the highest.';
  end if;
  if v_lot.current_turn_team_id = p_team_id then
    raise exception 'Cannot undo — the next team has already placed a bid.';
  end if;

  select team_id, amount into v_prev_bidder, v_prev_amount from public.bids
    where lot_id = p_lot_id and team_id <> p_team_id and amount is not null
    order by amount desc limit 1;

  v_undone_amount := v_lot.current_bid;

  update public.auction_lots
    set current_bid = v_prev_amount, current_bidder_id = v_prev_bidder, current_turn_team_id = p_team_id
    where id = p_lot_id;

  update public.bids set amount = null where lot_id = p_lot_id and team_id = p_team_id;

  select display_name into v_team_name from public.teams where id = p_team_id;
  insert into public.auction_log (auction_id, action_type, payload)
    values (v_lot.auction_id, 'bid_undone', jsonb_build_object(
      'lot_id', p_lot_id, 'team_id', p_team_id, 'team_name', coalesce(v_team_name, ''),
      'undone_amount', v_undone_amount
    ));

  restored_bid := v_prev_amount;
  return next;
end;
$$ language plpgsql;

grant execute on function public.rpc_undo_bid(uuid, uuid) to authenticated, anon, service_role;

-- =============================================
-- ASSIGN-PLAYER
-- =============================================
-- Team id and price are derived from the locked lot row itself (current_bidder_id /
-- current_bid), not taken as caller-supplied parameters — the caller only nominates
-- which lot to conclude, closing off any client/server mismatch.
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
  select count(*) into v_starters from public.roster_entries
    where team_id = v_team_id and slot_type = 'starting';
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
        select bench_order from public.roster_entries
        where team_id = v_team_id and slot_type = 'bench' and bench_order is not null
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

-- =============================================
-- RESTORE-FROM-SNAPSHOT
-- =============================================
create or replace function public.rpc_restore_snapshot(p_auction_id uuid)
returns table(restored boolean) as $$
declare
  v_snapshot jsonb;
  v_team_ids uuid[];
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

  select array_agg(distinct (elem ->> 'team_id')::uuid) into v_team_ids
    from jsonb_array_elements(v_snapshot -> 'roster_entries') as elem;

  if v_team_ids is not null then
    delete from public.roster_entries where team_id = any(v_team_ids);
  end if;

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

-- =============================================
-- UNDO-LAST-ASSIGNMENT
-- =============================================
-- Reverses the single most recently concluded lot for an auction (budget,
-- roster, base_price, auction pointer), reopening it to 'bidding'. Only
-- valid while no newer lot has been opened since — otherwise the AM should
-- use the full snapshot rollback instead.
create or replace function public.rpc_undo_last_assignment(p_auction_id uuid)
returns table(player_name text, team_name text) as $$
declare
  v_auction public.auctions%rowtype;
  v_lot public.auction_lots%rowtype;
  v_payload jsonb;
  v_newer_lots int;
  v_player_name text;
  v_team_name text;
begin
  select * into v_auction from public.auctions where id = p_auction_id for update;
  if not found then
    raise exception 'Auction not found.';
  end if;

  select * into v_lot from public.auction_lots
    where auction_id = p_auction_id and phase = 'concluded' and winning_team_id is not null
    order by created_at desc limit 1 for update;
  if not found then
    raise exception 'No completed assignment to undo.';
  end if;

  select count(*) into v_newer_lots from public.auction_lots
    where auction_id = p_auction_id and created_at > v_lot.created_at;
  if v_newer_lots > 0 then
    raise exception 'A newer lot has already been opened — this assignment can no longer be undone.';
  end if;

  select payload into v_payload from public.auction_log
    where auction_id = p_auction_id and action_type = 'player_assigned'
      and (payload ->> 'lot_id')::uuid = v_lot.id
    order by created_at desc limit 1;
  if v_payload is null then
    raise exception 'No assignment record found for this lot.';
  end if;

  delete from public.roster_entries where team_id = v_lot.winning_team_id and player_id = v_lot.player_id;

  update public.teams set budget = budget + v_lot.winning_bid where id = v_lot.winning_team_id;
  update public.players set base_price = (v_payload ->> 'prev_base_price')::numeric where id = v_lot.player_id;

  -- current_bid/current_bidder_id are deliberately left intact: this returns the lot to
  -- the exact "sole bidder standing, awaiting AM" state that existed right before assign
  -- was clicked, so the AM can re-assign, return-to-pool, or the winning team can still
  -- undo-bid to unwind further back into the bidding history.
  update public.auction_lots
    set phase = 'bidding', winning_team_id = null, winning_bid = null, current_turn_team_id = null
    where id = v_lot.id;

  update public.auctions
    set current_bidder_index = (v_payload ->> 'prev_bidder_index')::int
    where id = p_auction_id;

  v_player_name := v_payload ->> 'player_name';
  v_team_name := v_payload ->> 'winning_team_name';

  insert into public.auction_log (auction_id, action_type, payload)
    values (p_auction_id, 'assignment_undone', jsonb_build_object(
      'lot_id', v_lot.id, 'player_id', v_lot.player_id, 'player_name', v_player_name,
      'team_id', v_lot.winning_team_id, 'team_name', v_team_name, 'reversed_amount', v_lot.winning_bid
    ));

  player_name := v_player_name;
  team_name := v_team_name;
  return next;
end;
$$ language plpgsql;

grant execute on function public.rpc_undo_last_assignment(uuid) to authenticated, anon, service_role;

-- =============================================
-- HARD CONSTRAINTS (defense-in-depth)
-- =============================================

-- Only one open lot per auction — a DB-level guarantee, not just the
-- application's check-then-insert in handleOpenLot.
create unique index if not exists one_open_lot_per_auction
  on public.auction_lots (auction_id)
  where phase in ('interest', 'bidding');

-- No sequence of writes, racy or otherwise, can push a team's budget negative.
alter table public.teams
  add constraint budget_non_negative check (budget >= 0);
