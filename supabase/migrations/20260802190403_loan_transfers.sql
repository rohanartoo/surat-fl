-- Loan Transfers: AM/admin execute a same-position 1-for-1 player swap
-- between two teams' rosters (plus optional one-directional cash),
-- negotiated by teams outside the app. loan_transfers doubles as the
-- audit record / trade history. rpc_execute_loan_transfer follows the
-- same atomic, row-locked pattern as rpc_swap_roster_entry and
-- rpc_lock_and_credit_drops — this touches two roster rows and two team
-- budgets in one go, exactly the kind of multi-row write that corrupted
-- state in production before those functions existed.

create table public.loan_transfers (
  id uuid primary key default gen_random_uuid(),
  team_a_id uuid not null references public.teams(id),
  team_b_id uuid not null references public.teams(id),
  player_a_id integer not null references public.players(id),
  player_b_id integer not null references public.players(id),
  cash_team_id uuid references public.teams(id),
  cash_amount numeric(6,2) not null default 0,
  performed_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on public.loan_transfers to authenticated, anon, service_role;

alter table public.loan_transfers enable row level security;

create policy "Anyone can read loan transfers" on public.loan_transfers for select using (true);
create policy "AM write loan transfers" on public.loan_transfers for all to authenticated
  using (get_my_role() in ('admin', 'auction_master'));

create or replace function public.rpc_execute_loan_transfer(
  p_entry_a_id uuid, p_team_b_id uuid, p_slot_type_a text, p_bench_order_a int,
  p_entry_b_id uuid, p_team_a_id uuid, p_slot_type_b text, p_bench_order_b int,
  p_cash_team_id uuid, p_cash_amount numeric,
  p_performed_by uuid
) returns uuid as $$
declare
  v_entry_a record;
  v_entry_b record;
  v_other_team_id uuid;
  v_new_id uuid;
begin
  -- lock both team rows in a stable order to avoid deadlocks with concurrent trades
  perform 1 from public.teams where id in (p_team_a_id, p_team_b_id) order by id for update;

  select id, team_id, player_id into v_entry_a from public.roster_entries where id = p_entry_a_id for update;
  if not found or v_entry_a.team_id <> p_team_a_id then
    raise exception 'Player A roster entry not found on the expected team.';
  end if;

  select id, team_id, player_id into v_entry_b from public.roster_entries where id = p_entry_b_id for update;
  if not found or v_entry_b.team_id <> p_team_b_id then
    raise exception 'Player B roster entry not found on the expected team.';
  end if;

  update public.roster_entries
    set team_id = p_team_b_id, slot_type = p_slot_type_a, bench_order = p_bench_order_a,
        is_captain = false, is_vice_captain = false
    where id = p_entry_a_id;

  update public.roster_entries
    set team_id = p_team_a_id, slot_type = p_slot_type_b, bench_order = p_bench_order_b,
        is_captain = false, is_vice_captain = false
    where id = p_entry_b_id;

  if p_cash_amount > 0 then
    v_other_team_id := case when p_cash_team_id = p_team_a_id then p_team_b_id else p_team_a_id end;
    update public.teams set budget = budget - p_cash_amount where id = p_cash_team_id;
    update public.teams set budget = budget + p_cash_amount where id = v_other_team_id;
  end if;

  insert into public.loan_transfers
    (team_a_id, team_b_id, player_a_id, player_b_id, cash_team_id, cash_amount, performed_by)
  values
    (p_team_a_id, p_team_b_id, v_entry_a.player_id, v_entry_b.player_id, p_cash_team_id, p_cash_amount, p_performed_by)
  returning id into v_new_id;

  return v_new_id;
end;
$$ language plpgsql;

grant execute on function public.rpc_execute_loan_transfer(uuid, uuid, text, int, uuid, uuid, text, int, uuid, numeric, uuid) to authenticated, anon, service_role;
