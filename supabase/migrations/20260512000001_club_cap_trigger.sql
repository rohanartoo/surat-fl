-- Enforces a maximum of 3 players from the same FPL club per team.
-- Fires before any insert into roster_entries (slot_type starting or bench).

create or replace function public.check_club_cap()
returns trigger as $$
declare
  club_name text;
  club_count integer;
begin
  select fpl_team into club_name from public.players where id = NEW.player_id;

  if NEW.slot_type in ('starting', 'bench') then
    select count(*) into club_count
    from public.roster_entries re
    join public.players p on p.id = re.player_id
    where re.team_id = NEW.team_id
      and re.slot_type in ('starting', 'bench')
      and p.fpl_team = club_name;

    if club_count >= 3 then
      raise exception 'Club cap exceeded: team already has 3 players from %', club_name;
    end if;
  end if;

  return NEW;
end;
$$ language plpgsql;

drop trigger if exists enforce_club_cap on public.roster_entries;
create trigger enforce_club_cap
  before insert on public.roster_entries
  for each row execute function public.check_club_cap();

grant execute on function public.check_club_cap() to authenticated, anon, service_role;
