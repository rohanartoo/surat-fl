# Deferred Work

Items intentionally tabled — not urgent, but worth doing before or after the real 2026/27 season draft.

---

## Notes

- Postgres RPC transaction work for `place-bid`, `fold`, `undo-bid`, `assign_player`, `restore_from_snapshot`, plus a new per-lot "undo last assignment" AM action, is written — see `supabase/migrations/20260723000001_auction_rpc_transactions.sql`. The migration is applied and its two hard DB constraints (`one_open_lot_per_auction`, `budget_non_negative`) are live and protecting the app today. **The route handlers still use the old sequential-JS logic, not these RPCs** — the project's Data API stopped exposing any newly-created Postgres function (confirmed via a throwaway test function, ruled out as RPC-specific; survived NOTIFY reload, dashboard re-toggle, and two full project restarts). Once that's resolved (Supabase support ticket needed), swap `src/app/api/auction/[action]/route.ts` back to calling the `rpc_*` functions — the ready-to-restore version is saved at `docs/deferred-rpc-route.ts.txt` (this was never committed, so it only exists as that file). It also needs the "Undo last assignment" AM button restored in `AuctionMasterControls.tsx`/`AuctionLog.tsx`, which was reverted alongside it — see that .txt file's header comment for what to re-add.
- The Supabase dashboard allows manual correction if something does go wrong (low-stakes private league).
