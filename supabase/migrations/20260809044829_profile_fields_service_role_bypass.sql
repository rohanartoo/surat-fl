-- protect_profile_fields blocked EVERY role/team_id change, including from
-- the service-role client — which is exactly what every admin-gated API
-- route uses. The trigger's actual purpose (stop a normal authenticated user
-- from updating their own role/team_id, bypassing the removed permissive
-- policy) doesn't need to — and shouldn't — also block the service role,
-- since service-role access already implies the change came from a
-- server-side route that has already checked requireRole("admin"). Without
-- this, any future admin-driven role/team reassignment feature would fail
-- immediately, even from the service client.

create or replace function public.protect_profile_fields()
returns trigger as $$
begin
  if auth.role() = 'service_role' then
    return NEW;
  end if;
  if NEW.role is distinct from OLD.role then
    raise exception 'You cannot change your own role.';
  end if;
  if NEW.team_id is distinct from OLD.team_id then
    raise exception 'You cannot change your own team assignment.';
  end if;
  return NEW;
end;
$$ language plpgsql;
