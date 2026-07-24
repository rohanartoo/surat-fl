-- Dropping a player now returns its full purchase price to the dropping
-- team's budget, the moment the drop is LOCKED (auction Start; see
-- lockAndCommitDrops in src/lib/drops.ts). Before that — while a drop is
-- merely "staged", during the auction's pending phase — teams see a
-- provisional (real budget + sum of staged drops' purchase prices) figure
-- computed in the app layer, but teams.budget itself is untouched. Bidding
-- can only begin once the auction is 'active', which only happens right
-- after this lock step runs, so provisional and spendable never overlap —
-- no window exists where a team could bid with money it doesn't really have.
--
-- Replaces the JS lockAndCommitDrops body (sequential delete + update) with
-- a single atomic function: locks the relevant team rows, credits each
-- team's budget with the sum of their staged drops' purchase prices (read
-- from roster_entries.base_price before those rows are removed), deletes
-- the roster rows, then flips the drops to 'locked' — in that order, so the
-- 'staged' filter used for both the credit and the delete can never
-- accidentally include a batch from an earlier, separate lock call.

create or replace function public.rpc_lock_and_credit_drops(p_auction_id uuid)
returns table(locked int) as $$
declare
  v_locked int;
begin
  -- Serialize concurrent calls for the same auction (e.g. a double-clicked
  -- Start) against each other by locking the affected team rows up front.
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

  -- Credit each team's budget with the sum of purchase prices of their
  -- staged drops, read from roster_entries before those rows are deleted.
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
