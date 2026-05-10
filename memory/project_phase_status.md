---
name: Surat FL — Phase Build Status
description: Which phases of the INITIAL_IMPLEMENTATION.md plan are complete, what's in progress, and what's next
type: project
---

**Why:** Building the Surat Fantasy League platform incrementally per INITIAL_IMPLEMENTATION.md plan.
**How to apply:** Use to orient new conversations — know which phases are done and what cleanup/work is pending before starting new phase work.

**Last updated:** 2026-05-08

## Phase Completion

Phase 1 (Foundation — schema, auth, roles, FPL sync, dashboard): **Complete**
Phase 2 (Team Pages — roster display, position fill counts): **Complete**
Phase 3 (Auction MVP — positional bidding, interest timer, assign players): **Complete**
Phase 4 (Full Auction Polish — circular bid order, 10-move undo, end-draft validation): **Complete**
Phase 5 (Team Management — drag-drop XI/bench, captain, drop staging): **Complete**

## Current Work: Pre-Phase 6 Code Review & Cleanup

A codebase review was conducted before Phase 6. Status of fixes:

### Must Fix (Phase 6 blockers)

- [x] Consolidate `ROLE_LEVEL` — moved to `role-utils.ts` (exported), imported by `roles.ts`
- [x] Remove duplicate bid calc functions — deleted `calcMinBid`/`calcMaxBid` from `utils.ts` (unused)
- [x] `calcDropPrice()` centralised — updated in `utils.ts` with `Math.max(1,…)` guard; team route now imports it
- [x] Wire up `isSoloWin()` in auction route — solo win detected in `handleStartBidding`, skips bidding round
- [x] Move `assertOwnership()` to `roles.ts` — team route now imports from roles
- [x] Fix budget % bar bug in dashboard — `budgetPct = team.budget` (correct: budget is already on 0–100 scale)
- [x] Move `filledSlotsByTeam` into `AuctionContext` — computed in `refresh()`, reactive on roster changes; prop removed from TeamBidConsole/MyActionPanel

### Tidy Up (alongside Phase 6)

- [x] `POSITION_ORDER` deduplication — exported from `auction-engine.ts`, removed local definition in `teams/page.tsx`
- [x] Delete dead exports in `auction-engine.ts` — removed `teamHasOpenSlot`, `canStartBidding`, `getNextPositionCategory`, `isPositionCategoryComplete`
- [x] Delete unused `roleCanEdit()` in `role-utils.ts` — removed
- [x] Extract shared `useApiAction()` hook — `src/hooks/useApiAction.ts`; applied in AuctionMasterControls and MyBidPanel
- [x] Extract `<PositionBadge>` component — `src/components/ui/PositionBadge.tsx`; applied in 6 locations
- [x] Remove dead `isDragOverlay` prop from `PlayerCard` — removed

### Deferred

- `lastConcludedLot` refactor in AuctionProvider
- Duplicate `TeamBidConsole` render pattern in auction page
- Centralise `createClient()` to `/lib/supabase.ts`

## Phase 6 — Drops & Mini-Auctions: **Complete**

Delivered:
- `src/lib/drops.ts` — `freeDropsForType`, `getDropQuota`, `lockAndCommitDrops`
- `src/app/api/drops/[action]/route.ts` — `quota`, `staged-counts` endpoints
- `handleStart` in auction route — calls `lockAndCommitDrops` for non-initial auctions; simultaneously locks all staged drops and removes from roster_entries
- `canTeamReDraft` enforced inline in `handleDeclareInterest` (already existed from Phase 5)
- `DroppedSection` — quota badge ("2/3 free"), penalty warning, "Return" disabled after drops locked
- `AuctionMasterControls` — staged drops summary per team in pending state; "Lock Drops & Start Auction" button label for non-initial auctions
- `team/[id]/page.tsx` — fetches quota server-side for owning team; passes to SquadManager → DroppedSection

## Phase 7 — Scoring & Leaderboard: **Complete**

Delivered:
- `src/lib/fpl.ts` — added `fetchFplLive(gw)` fetching `event/{gw}/live/` from FPL API
- `src/lib/scoring.ts` — `applyAutoSubs` (formation-valid bench rotation), `syncGameweekPoints(gw)`, `getStandings()`
- `src/app/api/scoring/sync/route.ts` — POST endpoint; accepts `Bearer SYNC_SECRET` (scheduled) or admin session (manual); body: `{ gameweek: number }`
- `src/components/standings/StandingsTable.tsx` — league table with per-GW columns, rank, team colour dot, total pts
- `src/app/(dashboard)/standings/page.tsx` — server component; admin sees GW sync form inline
- `src/components/nav.tsx` — added "Standings" nav link with Trophy icon

**Phase 7 deferred item resolved (2026-05-09):**
- `applyDropPenalties` implemented in `src/lib/scoring.ts`; wired into `POST /api/scoring/sync` alongside `syncGameweekPoints` (both run in parallel for the same GW)
- Migration `20260509000001_gameweek_points_nullable_player.sql` makes `player_id` nullable and replaces the unique constraint with a partial index (only for non-null player rows)
- `GameweekPoints` type updated: `player_id: number | null`

## Phase 8 — Settings & Admin: **Complete**

Delivered:
- `supabase/migrations/20260508000004_teams_rls_update.sql` — RLS UPDATE policy so teams can update their own `display_name`
- `src/app/api/auth/update-username/route.ts` — updates `profiles.username` + `auth.users.email` via Admin SDK; self-update (team role) or admin override (`target_user_id`)
- `src/app/api/auth/admin-reset-password/route.ts` — admin-only force-set password via Admin SDK
- `src/app/api/team/[action]/route.ts` — added `update-name` action; `assertOwnership` allows admin to update any team
- `src/components/settings/TeamSettingsForm.tsx` — team name, username, password sections; team name hidden for non-team accounts
- `src/app/(dashboard)/settings/page.tsx` — own account settings; guest sees "not available" message
- `src/components/settings/AdminTeamControls.tsx` — admin-only card on team pages; reset name, username, password for any team
- `src/app/(dashboard)/team/[id]/page.tsx` — fetches team's linked profile; renders AdminTeamControls for admins
- `src/components/nav.tsx` — added "Settings" nav link with Settings icon

## All Phases Complete ✅

Phases 1–8 fully implemented. App is feature-complete per INITIAL_IMPLEMENTATION.md.

## Phase 3 files created (for reference)
- `src/lib/auction-engine.ts` — pure bid validation, position eligibility logic
- `src/lib/role-utils.ts` — client-safe role helper functions
- `src/app/api/auction/[action]/route.ts` — POST endpoints: create, start, open-lot, declare-interest, start-bidding, place-bid, assign-player, fold
- `src/components/auction/AuctionProvider.tsx` — Realtime context with Supabase channel subscriptions
- `src/components/auction/AuctionTimer.tsx` — 45s interest countdown
- `src/components/auction/AuctionLog.tsx` — live feed from auction_log table
- `src/components/auction/PlayerSelectionPanel.tsx` — searchable player pool
- `src/components/auction/CentralConsole.tsx` — current lot stats
- `src/components/auction/TeamBidConsole.tsx` — per-team bid rows + actions
- `src/components/auction/AuctionMasterControls.tsx` — AM panel
- `src/app/(dashboard)/auction/page.tsx` — server component, initial state fetch
