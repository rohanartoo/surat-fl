-- Dropped players' base price is supposed to halve (calcDropPrice, already
-- computed and stored as team_drops.drop_price at drop time) once the drop
-- locks in, so they re-enter the pool cheaper. rpc_lock_and_credit_drops
-- credited the team's budget and deleted the roster row, but never wrote
-- that halved price back to players.base_price — so a re-nominated player
-- kept showing their last purchase price as the opening bid instead of the
-- drop price. Add that update, keyed off the same 'staged' team_drops rows
-- already being locked in this function.
create or replace function public.rpc_lock_and_credit_drops(p_auction_id uuid)
returns table(locked int) as $$
declare
  v_locked int;
begin
  perform 1 from public.teams
    where id in (
      select team_id from public.team_drops
      where auction_id = p_auction_id and status = 'staged'
    )
    for update;

  select count(*) into v_locked from public.team_drops
    where auction_id = p_auction_id and status = 'staged';

  if v_locked = 0 then
    locked := 0;
    return next;
    return;
  end if;

  update public.teams t
    set budget = t.budget + sub.total
    from (
      select re.team_id, sum(re.base_price) as total
      from public.team_drops td
      join public.roster_entries re
        on re.team_id = td.team_id and re.player_id = td.player_id and re.slot_type = 'dropped'
      where td.auction_id = p_auction_id and td.status = 'staged'
      group by re.team_id
    ) sub
    where t.id = sub.team_id;

  -- Reset each dropped player's base price to the pre-computed drop price
  -- (half the purchase price, rounded up) so they re-enter the pool cheaper.
  update public.players p
    set base_price = td.drop_price
    from public.team_drops td
    where td.auction_id = p_auction_id and td.status = 'staged'
      and p.id = td.player_id;

  delete from public.roster_entries re
    using public.team_drops td
    where td.auction_id = p_auction_id and td.status = 'staged'
      and re.team_id = td.team_id and re.player_id = td.player_id and re.slot_type = 'dropped';

  update public.team_drops
    set status = 'locked'
    where auction_id = p_auction_id and status = 'staged';

  locked := v_locked;
  return next;
end;
$$ language plpgsql;

grant execute on function public.rpc_lock_and_credit_drops(uuid) to authenticated, anon, service_role;
