-- Removes the in-app chat entirely — the league asked for it to go.
--
-- Dropping the tables is sufficient on its own: their RLS policies, grants,
-- indexes, foreign keys and supabase_realtime publication membership are all
-- owned by the tables and go with them. Nothing else references either table
-- (the last reader, the 30-day purge in /api/scoring/cron, is removed in the
-- same change).
--
-- The four earlier *_chat*.sql migrations are deliberately left in place:
-- they are applied history, and deleting them would break a from-scratch
-- replay of the migration chain.

drop table if exists public.chat_messages;
drop table if exists public.chat_kicks;
