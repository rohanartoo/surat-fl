-- handleCancel did four sequential, mostly-unchecked steps (restore snapshot
-- via RPC, delete team_drops, restore dropped players to bench, delete the
-- auction row) — a failure partway through (e.g. after team_drops is wiped
-- but before roster_entries is restored) leaves dropped players permanently
-- stuck in slot_type='dropped' with no drop record to return them via, and
-- no auction left to reference. Wrapping the whole cancel in one RPC makes
-- it atomic.

create or replace function public.rpc_cancel_auction(p_auction_id uuid)
returns void as $$
declare
  v_status text;
begin
  select status into v_status from public.auctions where id = p_auction_id for update;
  if v_status is null then
    raise exception 'Auction not found.';
  end if;
  if v_status not in ('pending', 'active') then
    raise exception 'Only pending or active auctions can be cancelled.';
  end if;

  if v_status = 'active' then
    perform public.rpc_restore_snapshot(p_auction_id);
  end if;

  -- After a cancel, teams start fresh — no staged or orphaned drops should
  -- remain pointing at a deleted auction (rpc_restore_snapshot, if it ran
  -- above, re-inserts them as 'staged'; clear those too).
  update public.roster_entries r
    set slot_type = 'bench', bench_order = null
    from public.team_drops d
    where d.auction_id = p_auction_id
      and r.player_id = d.player_id
      and r.slot_type = 'dropped';

  delete from public.team_drops where auction_id = p_auction_id;

  -- Cascades to lots, bids, log, transfer records, snapshot.
  delete from public.auctions where id = p_auction_id;
end;
$$ language plpgsql;

grant execute on function public.rpc_cancel_auction(uuid) to authenticated, anon, service_role;
