-- Supports the "My Team" per-gameweek performance view: a stat breakdown per
-- player per GW (goals/assists/bonus/cards/etc — FPL's live API already
-- returns this, it was just being discarded), a per-GW captain snapshot
-- (roster_entries.is_captain has no history, so captain doubling can't be
-- reconstructed after the fact without one), and which starter an auto-sub
-- replaced (previously only the incoming player's row existed at all).
alter table public.gameweek_points
  add column if not exists stat_breakdown jsonb,
  add column if not exists is_captain boolean not null default false,
  add column if not exists subbed_out_player_id integer references public.players(id);
