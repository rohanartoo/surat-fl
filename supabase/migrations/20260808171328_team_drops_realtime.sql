-- team_drops was never added to the supabase_realtime publication, so
-- staging/un-staging a drop (insert/delete on team_drops) never broadcast to
-- other clients. StagedDropsPanel showed a stale snapshot from its one-time
-- fetch until the page was manually refreshed.

alter publication supabase_realtime add table public.team_drops;
