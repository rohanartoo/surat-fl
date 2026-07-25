-- handleSwap (src/app/api/team/[action]/route.ts) performed a starting <-> bench
-- swap as two separate, unchecked sequential updates. If the second update
-- ever failed (or raced with another swap on the same team) the first commit
-- alone was enough to leave the roster split wrong permanently — e.g. 12
-- players in "starting" with an orphaned empty bench slot, observed live on
-- "Cursed Scousers". This wraps both writes in one transaction with row
-- locks, so a partial failure can no longer happen.
create or replace function public.rpc_swap_roster_entry(
  p_entry_id uuid,
  p_target_slot text,
  p_bench_order int,
  p_displaced_entry_id uuid
) returns void as $$
declare
  v_entry record;
  v_displaced record;
  v_entry_new_bench_order int;
  v_displaced_new_slot text;
  v_displaced_new_bench_order int;
begin
  select id, slot_type, bench_order into v_entry
    from public.roster_entries where id = p_entry_id for update;
  if not found then
    raise exception 'Roster entry not found.';
  end if;

  if p_displaced_entry_id is not null then
    select id, slot_type, bench_order into v_displaced
      from public.roster_entries where id = p_displaced_entry_id for update;
    if not found then
      raise exception 'Displaced entry not found.';
    end if;

    v_entry_new_bench_order := case when p_target_slot = 'bench'
      then coalesce(p_bench_order, v_displaced.bench_order) else null end;
    v_displaced_new_slot := v_entry.slot_type;
    v_displaced_new_bench_order := case when v_displaced_new_slot = 'bench'
      then v_entry.bench_order else null end;

    update public.roster_entries
      set slot_type = p_target_slot, bench_order = v_entry_new_bench_order
      where id = p_entry_id;
    update public.roster_entries
      set slot_type = v_displaced_new_slot, bench_order = v_displaced_new_bench_order
      where id = p_displaced_entry_id;
  else
    update public.roster_entries
      set slot_type = p_target_slot,
          bench_order = case when p_target_slot = 'bench' then p_bench_order else null end
      where id = p_entry_id;
  end if;
end;
$$ language plpgsql;

grant execute on function public.rpc_swap_roster_entry(uuid, text, int, uuid) to authenticated, anon, service_role;
