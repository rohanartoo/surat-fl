-- Teams can update their own display_name.
-- Admin already has full write access via the "Admin full write teams" policy.
create policy "Team updates own display_name" on public.teams
  for update to authenticated
  using   (id = get_my_team_id())
  with check (id = get_my_team_id());
