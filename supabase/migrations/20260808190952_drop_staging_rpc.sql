-- handleMarkDrop / handleReturnFromDrop each did a two-row write (roster_entries
-- + team_drops) as sequential, unchecked .update()/.insert()/.delete() calls.
-- If the second call failed — e.g. the insert hitting
-- unique_drop_per_player_per_auction because another team already staged
-- that exact player this auction, after a trade — the player was left
-- stranded in slot_type='dropped' with no team_drops row: un-droppable
-- (handleReturnFromDrop finds nothing to return), never credited by
-- rpc_lock_and_credit_drops (which only looks at team_drops), and invisible
-- in every roster view forever. Wrapping each pair in a single RPC makes the
-- two writes succeed or fail together.

create or replace function public.rpc_mark_drop(
  p_entry_id uuid,
  p_drop_price numeric,
  p_auction_id uuid,
  p_dropped_post_january boolean
) returns void as $$
declare
  v_team_id uuid;
  v_player_id int;
begin
  select team_id, player_id into v_team_id, v_player_id
    from public.roster_entries where id = p_entry_id for update;
  if not found then
    raise exception 'Roster entry not found.';
  end if;

  update public.roster_entries
    set slot_type = 'dropped', bench_order = null, is_captain = false, is_vice_captain = false
    where id = p_entry_id;

  insert into public.team_drops (team_id, player_id, auction_id, drop_price, status, dropped_post_january, dropped_post_summer)
    values (v_team_id, v_player_id, p_auction_id, p_drop_price, 'staged', p_dropped_post_january, false);
end;
$$ language plpgsql;

create or replace function public.rpc_return_from_drop(
  p_entry_id uuid,
  p_drop_id uuid,
  p_target_slot text,
  p_bench_order int
) returns void as $$
declare
  v_updated_id uuid;
  v_deleted_id uuid;
begin
  update public.roster_entries
    set slot_type = p_target_slot,
        bench_order = case when p_target_slot = 'bench' then p_bench_order else null end
    where id = p_entry_id
    returning id into v_updated_id;
  if v_updated_id is null then
    raise exception 'Roster entry not found.';
  end if;

  delete from public.team_drops where id = p_drop_id and status = 'staged'
    returning id into v_deleted_id;
  if v_deleted_id is null then
    raise exception 'No staged drop found for this player.';
  end if;
end;
$$ language plpgsql;

grant execute on function public.rpc_mark_drop(uuid, numeric, uuid, boolean) to authenticated, anon, service_role;
grant execute on function public.rpc_return_from_drop(uuid, uuid, text, int) to authenticated, anon, service_role;
