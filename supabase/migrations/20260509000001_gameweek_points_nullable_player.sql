-- Make player_id nullable to support drop-penalty rows (which have no player)
alter table public.gameweek_points
  alter column player_id drop not null;

-- Drop the old unique constraint (required non-null player_id)
alter table public.gameweek_points
  drop constraint unique_player_team_gw;

-- Partial unique: enforce uniqueness only for real player rows
create unique index unique_player_team_gw
  on public.gameweek_points (team_id, gameweek, player_id)
  where player_id is not null;
