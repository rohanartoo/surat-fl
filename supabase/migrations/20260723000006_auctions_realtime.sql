-- The auctions table was never added to the supabase_realtime publication
-- (20260508000000_initial_schema.sql added auction_lots, bids, auction_log,
-- teams, and roster_entries, but not auctions itself). AuctionProvider
-- subscribes to postgres_changes on "auctions" specifically to catch
-- current_position_category advancing, but that UPDATE never fired a
-- realtime event, so team screens kept showing the old position's player
-- pool until something else happened to touch a table that IS published —
-- in practice, the auction master opening the next lot (which inserts into
-- auction_lots), by which point the position had already visibly moved on.

alter publication supabase_realtime add table public.auctions;
