-- Auction log was sorted by created_at alone, but Postgres's now() returns
-- the same value for every row inserted within one statement/transaction —
-- handleOpenLot's initial-auction path inserts 'lot_opened' and
-- 'bidding_started' as a single two-row array insert, so those two rows tie
-- exactly on created_at and their relative order was left to whatever the
-- query planner happened to do, not insertion order. A bigserial gives a
-- true monotonic tiebreaker regardless of how many rows share a timestamp.
alter table public.auction_log add column if not exists seq bigserial;

-- rpc_conclude_lot_no_winner's payload only carried player_id (not
-- player_name/position), unlike every other log-writing path — the one
-- entry point actually feeding an unenriched payload through, which is why
-- the log rendered the raw player_id / no player context. Bring it in line
-- with lot_opened/player_assigned by embedding player_name and position at
-- write time, the same way those payloads already do.
create or replace function public.rpc_conclude_lot_no_winner(p_lot_id uuid, p_log_action text)
returns table(next_bidder_id uuid) as $$
declare
  v_lot public.auction_lots%rowtype;
  v_position text;
  v_player_name text;
begin
  select * into v_lot from public.auction_lots where id = p_lot_id for update;
  if not found then
    raise exception 'Lot not found.';
  end if;
  if v_lot.phase not in ('interest', 'bidding') then
    raise exception 'Lot is not open.';
  end if;

  select position, web_name into v_position, v_player_name from public.players where id = v_lot.player_id;

  update public.auction_lots
    set phase = 'concluded', current_turn_team_id = null
    where id = p_lot_id;

  next_bidder_id := public.rpc_advance_bidder(v_lot.auction_id, v_position);

  insert into public.auction_log (auction_id, action_type, payload)
    values (v_lot.auction_id, p_log_action, jsonb_build_object(
      'lot_id', p_lot_id, 'player_id', v_lot.player_id,
      'player_name', v_player_name, 'position', v_position
    ));

  return next;
end;
$$ language plpgsql;

grant execute on function public.rpc_conclude_lot_no_winner(uuid, text) to authenticated, anon, service_role;
