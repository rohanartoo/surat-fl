-- Track whose turn it is to bid within a bidding round.
-- Null during interest phase; set to first eligible team when bidding starts;
-- advances after each bid or fold.
alter table public.auction_lots
  add column current_turn_team_id uuid references public.teams(id);
