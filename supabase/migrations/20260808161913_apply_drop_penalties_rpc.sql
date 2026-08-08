-- Drop penalties used to be matched to a gameweek via auctions.gameweek,
-- which required the AM to correctly predict at auction-creation time which
-- GW number the next scoring pass would actually be for — get it wrong and
-- the penalty silently never attaches to anything. Instead, a penalty now
-- just attaches to whichever gameweek gets scored/simulated next: each
-- team_transfer_records row tracks whether it's been applied yet via
-- applied_gameweek, and rpc_apply_drop_penalties atomically claims every
-- still-pending penalty and writes it to gameweek_points for the GW being
-- processed right now. This also makes re-running a sync/simulate for the
-- same GW naturally idempotent — a penalty is only ever picked up once.

alter table public.team_transfer_records add column if not exists applied_gameweek integer;

create or replace function public.rpc_apply_drop_penalties(p_gameweek int)
returns int as $$
declare
  v_applied int;
begin
  create temporary table _pending_penalties on commit drop as
    select id, team_id, points_penalty
    from public.team_transfer_records
    where points_penalty < 0 and applied_gameweek is null
    for update;

  insert into public.gameweek_points (team_id, gameweek, player_id, points, was_subbed_in)
  select team_id, p_gameweek, null, points_penalty, false from _pending_penalties;

  update public.team_transfer_records t
    set applied_gameweek = p_gameweek
    from _pending_penalties p
    where t.id = p.id;

  select count(*) into v_applied from _pending_penalties;
  return v_applied;
end;
$$ language plpgsql;

grant execute on function public.rpc_apply_drop_penalties(int) to authenticated, anon, service_role;
