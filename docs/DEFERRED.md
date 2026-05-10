# Deferred Work

Items intentionally tabled — not urgent, but worth doing before or after the real 2026/27 season draft.

---

## Postgres RPC Transactions

**Priority:** Do before the real season draft, after dry runs confirm the need.

**Context:** Supabase's JS client doesn't support multi-statement transactions. Two operations involve multiple sequential DB writes with no atomic rollback if a write fails mid-sequence:

### 1. `assign_player` RPC
**Current code:** `autoAssign()` in `src/app/api/auction/[action]/route.ts`

Writes in sequence:
1. Insert `roster_entries` row
2. Update `teams.budget`
3. Update `players.base_price`
4. Update `auction_lots` → concluded
5. Insert `auction_log` row
6. Update `auctions.current_bidder_index`

**Partial failure consequence:** Player added to roster but budget not deducted, or lot stays open while player is already assigned — broken league state requiring manual DB fix.

**Fix:** Write a `plpgsql` function `assign_player(lot_id, team_id, price)` that wraps all writes in `BEGIN / COMMIT`. Call via `supabase.rpc("assign_player", { ... })` in `handleAssignPlayer`.

### 2. `restore_from_snapshot` RPC
**Current code:** `restoreFromSnapshot()` in `src/app/api/auction/[action]/route.ts`

Writes in sequence:
1. Update `teams.budget` for each team
2. Update `players.base_price` for each player
3. Delete + re-insert `roster_entries`
4. Delete + re-insert `team_drops`

**Partial failure consequence:** Partial restore — some teams on new rosters, others on old. The recovery tool itself is non-atomic, which is worse than the original failure.

**Fix:** Write a `plpgsql` function `restore_from_snapshot(auction_id)` that reads the snapshot JSONB and applies all restores atomically.

### Migration approach
- Write functions in a new migration file `supabase/migrations/YYYYMMDD_rpc_transactions.sql`
- Update the two route handlers to call `supabase.rpc()` instead of the current sequential writes
- Remove the now-redundant inline write sequences

---

## Notes
- Do dry runs first — if partial-write issues don't surface in practice, this is a nice-to-have
- The Supabase dashboard allows manual correction if something does go wrong (low-stakes private league)
- Recommended timing: after dry runs, before the real 2026/27 initial draft
