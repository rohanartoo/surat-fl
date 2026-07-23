-- Initial auctions auto-enroll every eligible team into bidding without any
-- interest-declaration step, so a team never got to say whether they
-- actually wanted the nominated player. Other auction types (mini,
-- post_jan, post_summer) run an interest phase first, so everyone left in
-- the bidding round already opted in.
--
-- rpc_fold_bid previously treated both the same way: once folds brought the
-- active count down to 1, the turn pointer was nulled and that lone team
-- could not act further — only the auction master could assign them (a
-- 20260723000004) or return the lot to the pool. That's correct for the
-- interest-based types (already opted in, should win), but wrong for
-- initial auctions: a team that never expressed real interest was still
-- forced into either buying the player or waiting on the AM, with no way to
-- decline.
--
-- Now, in an initial auction, the sole remaining bidder keeps a normal turn
-- for as long as they have not yet placed a bid on this lot — so they can
-- still fold (declining outright) or bid (if they've changed their mind),
-- exactly like any other turn, via the existing place-bid/fold paths with
-- no special-casing needed there. The moment they do place a bid, the
-- ordinary next-bidder lookup finds no one else active and nulls the turn
-- itself, which naturally locks them in — consistent with every other
-- auction type once you're the winning bid with no one left to act.
--
-- Separately: when every active bidder folds (0 remain), the lot no longer
-- auto-concludes. It stays open with no turn, and the auction master must
-- explicitly return it to the pool (existing return-to-pool action, no new
-- UI needed) — giving them a chance to notice and react rather than the
-- player silently vanishing back into the pool the instant the last fold
-- lands. This applies uniformly; it was already unreachable for the
-- interest-based types since a team could never fold at n=1 there.

create or replace function public.rpc_fold_bid(p_lot_id uuid, p_team_id uuid)
returns table(concluded boolean, reason text, active_bidders int, next_turn_team_id uuid, pending_winner uuid) as $$
declare
  v_lot public.auction_lots%rowtype;
  v_team_name text;
  v_active uuid[];
  v_auction_order jsonb;
  v_auction_type text;
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

  select type, auction_order into v_auction_type, v_auction_order
    from public.auctions where id = v_lot.auction_id;

  update public.bids set is_folded = true where lot_id = p_lot_id and team_id = p_team_id;

  select display_name into v_team_name from public.teams where id = p_team_id;
  insert into public.auction_log (auction_id, action_type, payload)
    values (v_lot.auction_id, 'team_folded', jsonb_build_object(
      'lot_id', p_lot_id, 'team_id', p_team_id, 'team_name', coalesce(v_team_name, '')
    ));

  select array_agg(team_id) into v_active from public.bids
    where lot_id = p_lot_id and is_interested = true and is_folded = false;

  if v_active is null or array_length(v_active, 1) is null then
    -- All teams folded. Leave the lot open with no turn — the auction
    -- master must explicitly return it to the pool.
    update public.auction_lots set current_turn_team_id = null where id = p_lot_id;
    concluded := false;
    reason := 'all_folded';
    active_bidders := 0;
    next_turn_team_id := null;
    pending_winner := null;
    return next;
    return;
  end if;

  if array_length(v_active, 1) = 1 then
    if v_auction_type = 'initial' and v_lot.current_bidder_id is distinct from v_active[1] then
      -- Sole survivor, never bid on this lot: give them a real turn so they
      -- can still fold (decline) or bid, same as anyone else.
      update public.auction_lots set current_turn_team_id = v_active[1] where id = p_lot_id;
      concluded := false;
      reason := null;
      active_bidders := 1;
      next_turn_team_id := v_active[1];
      pending_winner := null;
      return next;
      return;
    end if;

    update public.auction_lots set current_turn_team_id = null where id = p_lot_id;
    concluded := false;
    reason := null;
    active_bidders := 1;
    next_turn_team_id := null;
    pending_winner := v_active[1];
    return next;
    return;
  end if;

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
