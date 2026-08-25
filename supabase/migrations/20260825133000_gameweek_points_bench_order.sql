-- Bench priority (1–4) decides which substitute comes on when a starter
-- blanks — applyAutoSubs walks the bench in this order — but it was only
-- ever read from roster_entries at sync time and never recorded alongside
-- the result. Once a team reshuffles its bench for the next gameweek there
-- was no way to reconstruct why a past gameweek's auto-subs resolved the
-- way they did, which is exactly the question a manager asks when a
-- 7-minute substitute comes on ahead of one who played 90.
--
-- It also left the two team-page views unable to agree: Team Selection
-- orders the bench by priority and shows the 1–4 pip, while Gameweek
-- Performance had nothing to sort by and fell back to position order, so
-- the same four players appeared in a different order in each panel.
--
-- Nullable on purpose: rows written before this migration keep NULL, and
-- the performance view falls back to its old position ordering for those
-- gameweeks rather than inventing numbers it cannot know. GW1 2026/27 was
-- finalized before this shipped, so it is permanently in that bucket.
--
-- No grants needed — these are table-level and gameweek_points already has
-- them; only new tables require the explicit grant block.
alter table public.gameweek_points
  add column if not exists bench_order integer;

comment on column public.gameweek_points.bench_order is
  'Bench priority 1-4 as it stood when this gameweek was scored; null for starting-XI rows and for rows written before 2026-08-25.';
