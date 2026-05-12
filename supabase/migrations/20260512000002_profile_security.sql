-- Removes the overly permissive profiles UPDATE policy that allowed any
-- authenticated user to update any column on their own profile row, including
-- role and team_id. All profile mutations go through server-side API routes
-- using the service-role client, so this policy is unnecessary.
drop policy if exists "User updates own profile" on public.profiles;

-- Backstop trigger: blocks any UPDATE that attempts to change role or team_id,
-- regardless of how the request reaches the database.
create or replace function public.protect_profile_fields()
returns trigger as $$
begin
  if NEW.role is distinct from OLD.role then
    raise exception 'You cannot change your own role.';
  end if;
  if NEW.team_id is distinct from OLD.team_id then
    raise exception 'You cannot change your own team assignment.';
  end if;
  return NEW;
end;
$$ language plpgsql;

create trigger enforce_profile_security
  before update on public.profiles
  for each row execute function public.protect_profile_fields();

grant execute on function public.protect_profile_fields() to authenticated, anon, service_role;
