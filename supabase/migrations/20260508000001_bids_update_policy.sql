-- Teams need UPDATE on their own bids to place amounts and fold during bidding.
-- The initial schema only had INSERT.
create policy "Team updates own bids" on public.bids
  for update to authenticated
  using (team_id = get_my_team_id());
