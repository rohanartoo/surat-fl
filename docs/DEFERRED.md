# Deferred Work

Items intentionally tabled — not urgent, but worth doing before or after the real 2026/27 season draft.

---

## Notes

- The Postgres RPC transaction work for `assign_player` and `restore_from_snapshot` (previously tracked here) is done — see `supabase/migrations/20260723000001_auction_rpc_transactions.sql`. That migration also extended the same atomic/row-locked pattern to `place-bid`, `fold`, and `undo-bid`, added a per-lot "undo last assignment" AM action, and added two hard DB constraints (`one_open_lot_per_auction`, `budget_non_negative`).
- New Postgres functions are **not** exposed through the Data API automatically on this project — "Automatically expose new tables" is off, so each new function must be enabled in Dashboard → Settings → API → Data API → **Exposed functions**. If a new `rpc_*` call 404s with `PGRST202 ... not found in the schema cache`, check that toggle before anything else.
- Local dev (`.env.local` points at the local stack on `127.0.0.1:54321`) needs `supabase migration up --local` after pulling new migrations, or RPC calls will 404 locally while working fine in production.
- The Supabase dashboard allows manual correction if something does go wrong (low-stakes private league).
