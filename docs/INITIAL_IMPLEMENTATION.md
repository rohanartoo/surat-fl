# Surat FL — Phased Rollout Plan

**Status: Phases 1–5 complete. Pre-Phase 6 cleanup in progress.**

> Track current phase status and in-progress cleanup work: [`project_phase_status.md`](./project_phase_status.md)

---

## Changelog

| Date | Change |
|------|--------|
| 2026-05-08 | Phase 8 complete: RLS migration for teams UPDATE, update-username + admin-reset-password endpoints, update-name action in team route, TeamSettingsForm, settings page, AdminTeamControls on team page, Settings nav link. |
| 2026-05-08 | Phase 7 complete: `src/lib/scoring.ts` (FPL live sync, auto-subs, standings), `/api/scoring/sync`, `/standings` page + StandingsTable, Standings nav link. Drop penalties deferred (needs nullable player_id migration). |
| 2026-05-08 | Phase 6 complete: `src/lib/drops.ts`, `/api/drops/[action]`, `lockAndCommitDrops` wired into auction start, quota badge + penalty warning in DroppedSection, staged drops summary in AuctionMasterControls. |
| 2026-05-08 | Pre-Phase 6 cleanup complete: duplicate constants/functions removed, `useApiAction` hook, `<PositionBadge>` component, `filledSlotsByTeam` in AuctionContext, `assertOwnership` in roles.ts, budget % bar fix, `isSoloWin` wired up. |
| 2026-05-08 | Phases 1–5 implemented. |

---

## Confirmed Rules (Complete)

| Rule | Detail |
|---|---|
| **Budget** | £100m per team. Currency: **£** symbol throughout |
| **Bid increment** | +£1m minimum when current bid < £20m; +£2m minimum when ≥ £20m |
| **Fold = eliminated** | Passing during bidding = out for that player |
| **Undo** | Last **10** moves: player assignments, timer resets, bid corrections. Undo restores player to pool + refunds budget. |
| **Squad** | 15 total (2 GK, 5 DEF, 5 MID, 3 FWD). Starting XI = 11, Bench = 4 |
| **Formations** | Minimums only: 1 GK, 3 DEF, 3 MID, 1 FWD. No strict formations. |
| **Bench order** | Numbered priority 1–4 (1 = first sub) |
| **Deadlines** | Auto-lock at FPL gameweek deadlines (fetched from FPL API) |
| **Scoring** | Real FPL points for starting XI of 11. Auto-sub rules apply (see below). Leaderboard page. |
| **Guest sessions** | Browser close = sign out. Unlimited concurrent guests. Real-time view. |
| **Teams** | Fixed at 7 |
| **Initial draft pool** | All ~700 FPL players |
| **Mini-auction pool** | Dropped + undrafted players |
| **AM initiates auctions** | Auction Master decides when mini-auctions happen |
| **Auction order — first** | Set manually in database (`auction_order` field) before first auction |
| **Auction order — subsequent** | AM confirms the order manually before each auction starts |

### Role Hierarchy
```
Admin  ⊇  Auction Master  ⊇  Team  ⊇  Guest
```
- **Admin** has all AM rights plus full edit access to the entire app
- An admin account can run the auction (no separate AM account needed)
- An AM account cannot perform admin-only actions
- Implemented as a single `role` column — no dual-role needed; admin simply has the highest level

### Auto-Sub Scoring Rules
When a starting XI player did not play in a gameweek:
1. Check bench players in priority order (1 → 4)
2. Substitute in the first bench player whose position keeps the formation valid (min 1 GK, 3 DEF, 3 MID, 1 FWD)
3. Continue until all empty starting slots are filled or bench is exhausted

### Drop & Transfer Rules

| Auction Type | Free Transfers | Max Rollover |
|---|---|---|
| First in-season auction | 3 | 1 |
| Post-January transfer window auction | 3 | 1 |
| All other mini-auctions | 2 | 1 |

**Re-draft restrictions (all apply cumulatively):**
1. **Same-window rule**: A team can never re-sign a player they dropped in the **same auction window**
2. **Pre-Jan rule**: A player dropped before January can only be re-drafted by the same team after the **first January auction has started** (not in any earlier mini-auction)
3. **Post-Jan rule**: A player dropped after January opens can **never** be re-signed by the same team for the rest of the season

**-4 pt penalty** (-4 pts per excess drop above free quota) — deducted at the **end of the gameweek**.

### Drop Lifecycle
1. Team marks a player for drop → player **stays in their squad** (still counts toward their roster, budget reflects their presence)
2. Team can **remove a player from the drop list at any time** before the auction starts
3. AM clicks **"Start Auction"** → all drops across all teams are **simultaneously locked and committed** to the player pool
4. Re-draft restrictions apply at this point (same-window, pre-Jan, post-Jan rules)
5. -4 pt penalty per excess drop is **deducted at end of the gameweek**

### Player Stats Shown in Auction Console
| Stat | Show? |
|---|---|
| Position | ✅ |
| Club | ✅ |
| Injury/availability status | ✅ |
| Total FPL points (season) | ✅ |
| Goals | ✅ |
| Assists | ✅ |
| Clean sheets | ✅ |
| Bonus points | ✅ |
| Yellow / Red cards | ✅ |
| Minutes played | ✅ |
| Defensive contribution points | ✅ |
| % selected by (FPL) | ❌ |
| FPL price | ❌ |

---

## Phase Overview

| Phase | What you get | Status |
|---|---|---|
| **1. Foundation** | Schema, username auth, roles, login, FPL sync, dashboard | 🔲 Ready to build |
| **2. Team Pages** | Roster display with placeholders, base prices | 🔲 Ready |
| **3. Auction MVP** | Positional bidding, interest timer, assign players | 🔲 Ready |
| **4. Full Auction** | Circular bid order, auto-rotation, 10-move undo, end draft | 🔲 Ready |
| **5. Team Management** | Drag-drop XI/bench, captain, drop staging, deadline lock | 🔲 Ready |
| **6. Drops & Mini-Auctions** | Drop quotas, penalties, re-draft restrictions, mini-auction | 🔲 Ready |
| **7. Scoring & Leaderboard** | Auto weekly sync, auto-sub, standings, penalty deductions | 🔲 Ready |
| **8. Settings & Admin** | Teams customize team name and username. Admin tools. | 🔲 Ready |

---

## Phase 1 — Foundation

> **Goal**: Everyone can log in, dashboard is live, FPL player data is synced.

### Files

#### [REWRITE] `supabase/schema.sql`
```
profiles      → id, role (admin/auction_master/team/guest), username, display_name, team_id
teams         → id, display_name, short_name, budget (£100m), color, auction_order
players       → FPL sync + base_price
roster_entries → team_id, player_id, slot_type (starting/bench/dropped), is_captain,
                 is_vice_captain, bench_order (1–4), base_price
auctions      → type (initial/mini/post_jan), status, current_position_category,
                 auction_order (jsonb array of team IDs)
auction_lots  → player_id, phase (interest/bidding/concluded), timer_started_at,
                 current_bid, current_bidder_id, bid_start_team_index
bids          → lot_id, team_id, amount, is_interested
auction_log   → auction_id, action_type, payload jsonb, created_at  (10-move undo + live feed)
team_drops    → team_id, auction_id, player_id, drop_price, status,
                 dropped_post_january (bool), same_window_restriction (bool)
gameweek_points → team_id, gameweek, player_id, points, was_subbed_in (bool)
```

RLS policy tiers (Admin ≥ AM > Team > Guest):
- **Admin**: full read/write everywhere
- **AM**: read all, write `auctions`, `auction_lots`, `bids`, `auction_log`, `team_drops` (confirm)
- **Team**: read all, write own `bids` + own `roster_entries`
- **Guest**: read all, write nothing

#### [MODIFY] `src/app/(auth)/login/page.tsx`
- Username + password form (email hidden from UI)
- "Continue as Guest" button
- `beforeunload` handler signs out guests

#### [MODIFY] `src/proxy.ts`
- Fetch `profiles.role`, pass downstream
- Admin passes all AM route checks automatically

#### [NEW] `src/lib/roles.ts`
```ts
// Role hierarchy — admin passes all lower-level checks
export function canActAsAuctionMaster(role: Role) {
  return role === 'admin' || role === 'auction_master'
}
```

#### [MODIFY] `src/types/index.ts`
All new interfaces + updated constants:
```ts
export const SQUAD_RULES = {
  total: 15, starting: 11, bench: 4,
  slots: { GK: 2, DEF: 5, MID: 5, FWD: 3 },
  min_starting: { GK: 1, DEF: 3, MID: 3, FWD: 1 },
  min_bid: 1,
}
export const DROP_RULES = {
  free_drops_first_inseason: 3,
  free_drops_post_jan: 3,
  free_drops_standard: 2,
  max_carry_over: 1,
  penalty_per_extra_drop: -4,
  drop_price_factor: 0.5,
}
export const BID_RULES = {
  increment_threshold: 20,   // £20m
  increment_below: 1,        // +£1m
  increment_above: 2,        // +£2m
}
```

#### [MODIFY] `src/lib/utils.ts`
- `formatMoney(n)` → `£${n}m`
- `calcMinIncrement(currentBid)` → `currentBid >= 20 ? 2 : 1`
- `calcMaxBid(budget, emptySlots)` → `budget - (emptySlots - 1)`
- `calcDropPrice(purchasePrice)` → `Math.ceil(purchasePrice * 0.5)`

#### [NEW] `src/app/api/auth/update-credentials/route.ts`
Teams change their password post-login.

---

## Phase 2 — Team Pages

> **Goal**: Roster pages with placeholder slots, base prices, budget summary.

#### [MODIFY] `src/app/(dashboard)/team/[id]/page.tsx`
- Three sections: Starting XI (11), Bench (4, labelled 1–4), Dropped
- Placeholder text for empty slots
- Show `base_price` (not FPL price)
- Read-only for now

#### [MODIFY] `src/app/(dashboard)/teams/page.tsx`
- Compact position fill counts per team (GK 0/2, DEF 0/5, etc.)

---

## Phase 3 — Auction MVP

> **Goal**: Functional positional auction: GK → DEF → MID → FWD.

### Key rules encoded here
- Panel locked to current position category; won't advance until all teams fill it
- Teams with full position are auto-disabled (greyed out)
- Bid validation: integer, ≥ base price, correct increment tier, ≤ max bid

### New files
- `src/lib/auction-engine.ts` (MVP functions)
- `src/app/api/auction/[action]/route.ts` (7 routes)
- `src/app/(dashboard)/auction/page.tsx` (rewrite)
- `src/components/auction/AuctionProvider.tsx`
- `src/components/auction/PlayerSelectionPanel.tsx`
- `src/components/auction/CentralConsole.tsx` — shows: Position, Club, Injury, Total pts, Goals, Assists, Clean sheets, Bonus, Cards, Minutes, Def. contribution
- `src/components/auction/TeamBidConsole.tsx`
- `src/components/auction/AuctionTimer.tsx`
- `src/components/auction/AuctionLog.tsx`
- `src/components/auction/AuctionMasterControls.tsx`

---

## Phase 4 — Full Auction Polish

> **Goal**: Enforced rotating bid order, 10-move undo, end-draft validation, AM sets auction order.

### Key rules encoded here
- After each player is assigned, bid priority rotates to next eligible team
- Teams with no open spots in current position are skipped
- AM manually confirms/adjusts bid order before auction starts (no auto-populate)
- End Draft blocked unless all 7 teams have 15 players

### New/modified files
- `src/components/auction/BiddingRound.tsx` (new)
- `src/lib/auction-engine.ts` — add `undoAction`, `endDraft`, `setAuctionOrder`, `getNextBidder`, `rotateBidPriority`
- `src/app/api/auction/[action]/route.ts` — add `undo`, `end-draft`, `set-order`
- `src/components/auction/AuctionMasterControls.tsx` — add undo counter, end draft, order controls

---

## Phase 5 — Team Management

> **Goal**: Interactive squad management — drag-drop Starting XI/Bench, captain selection, drop staging, return from drop.
> FPL deadline locking is deferred to a later phase.

### Schema status
No new migrations needed. All required fields already exist:
- `roster_entries`: `slot_type`, `bench_order`, `is_captain`, `is_vice_captain`, `base_price`
- `team_drops`: `status` ('staged' | 'locked' | 'cancelled'), `drop_price`, `dropped_post_january`, `dropped_post_summer`

### Dependency to install
```
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

### Key rules encoded here
- Drag and drop between Starting XI ↔ Bench; formation minimums validated before accepting swap
- Bench slots labelled 1–4 (bench_order); reorder by dragging within bench
- Set captain / vice-captain by clicking — only valid on Starting XI players
- Stage a player for drop: moves to `slot_type = 'dropped'`, creates `team_drops` row with `status = 'staged'`
- Return staged drop: deletes team_drops row, restores player to bench (soft check only — AM confirms in Phase 6)
- Edit controls only shown to the owning team or admin; guests/other teams see read-only view
- FPL deadline locking deferred — no `locked_until` field or `deadline.ts` in this phase

### Formation validation helper
Add `validateFormation(starting: { position: Position }[]): string | null` to `src/lib/auction-engine.ts`
Uses `SQUAD_RULES.min_starting` — returns error string if minimums not met, null if valid.

### API actions — `src/app/api/team/[action]/route.ts` (new file)
All use service role client; ownership verified via `getProfile()` before every write.

| Action | Body | What it does |
|--------|------|-------------|
| `swap` | `{ entry_id, target_slot, bench_order?, displaced_entry_id? }` | Swap starting ↔ bench or reorder bench; validates formation |
| `set-captain` | `{ entry_id, role: "captain" \| "vice_captain" }` | Clears existing flag, sets on target; must be in Starting XI |
| `mark-drop` | `{ entry_id }` | Sets `slot_type = 'dropped'`, inserts staged team_drops row, clears captain/vc |
| `return-from-drop` | `{ entry_id }` | Errors if status = 'locked'; else deletes team_drops row, restores to bench |

### New/modified files
- `src/types/index.ts` — add `free_drops_post_summer: 3` to DROP_RULES
- `src/lib/auction-engine.ts` — add `validateFormation` helper
- `src/components/team/PlayerCard.tsx` — draggable card (position badge, name, C/VC badge, action buttons on hover)
- `src/components/team/SquadGrid.tsx` — Starting XI drop zone (11 slots, SortableContext)
- `src/components/team/BenchRow.tsx` — Bench 4 numbered slots (SortableContext, reorderable)
- `src/components/team/DroppedSection.tsx` — Staged drops list with "Return to squad" button
- `src/components/team/TeamBudgetBar.tsx` — Budget remaining bar
- `src/app/api/team/[action]/route.ts` — new API route (swap, set-captain, mark-drop, return-from-drop)
- `src/app/(dashboard)/team/[id]/page.tsx` — rewrite: server fetch + pass to interactive client components

---

## Phase 6 — Drops & Mini-Auctions

> **Goal**: Full drop lifecycle with re-draft restrictions and mini-auction.

### Drop lifecycle rules encoded here
- Teams mark players for drop → player **stays in squad** until auction starts
- Teams can **unmark** at any time before AM starts the auction
- AM clicks **"Start Auction"** → all drops across all teams are **simultaneously locked** and added to pool
- Re-draft restrictions (same-window, pre-Jan, post-Jan) are evaluated at lock time
- **-4 pt penalty** per excess drop deducted at end of the gameweek

### New/modified files
- `src/lib/drops.ts` — `markForDrop`, `returnFromDrop`, `lockAndCommitDrops` (triggered by auction start), `getDropQuota`, `canTeamReDraft`
- `src/lib/auction-engine.ts` — `startMiniAuction(type)` calls `lockAndCommitDrops` as first step; `getAvailablePool` reads committed drops
- `src/app/api/drops/[action]/route.ts`
- `src/components/team/DroppedSection.tsx` — quota badge, penalty warning, "Remove from drop" available until auction starts
- `src/components/auction/AuctionMasterControls.tsx` — **"Start Mini-Auction"** / **"Start Post-Jan Auction"** buttons (replaces separate "Confirm Drops" step — starting the auction IS the confirmation)

---

## Phase 7 — Scoring & Leaderboard

> **Goal**: Sync FPL points weekly, apply auto-sub logic, show standings.

### Key rules encoded here
- Sync triggers automatically after each GW closes (scheduled); Admin/AM can also trigger manually
- Auto-sub: for each non-playing starter, try bench players in order (1→4) — must keep formation valid
- -4 pt penalty rows written to `gameweek_points` at the end of the GW when drops were confirmed
- Standings used for AM to manually set next auction order

### New files
- `src/lib/scoring.ts` — `syncGameweekPoints(gw)`, `applyAutoSubs(teamId, gw)`, `applyDropPenalties(gw)`, `getStandings()`
- `src/app/api/scoring/sync/route.ts` — scheduled + manual trigger endpoint
- `src/app/(dashboard)/standings/page.tsx`
- `src/components/standings/StandingsTable.tsx`

---

## Phase 8 — Settings & Admin

> **Goal**: Teams can customize their Team Name and Username, requiring safe cross-table updates.

### Key rules encoded here
- **Team Name**: Teams can update their own `teams.display_name`. (Requires adding a new RLS policy allowing teams to `UPDATE` their own row in the `teams` table).
- **Username**: Teams can change their login username. This requires a secure backend API using the Service Role key to simultaneously update `profiles.username` and `auth.users.email` (bypassing the default Supabase email confirmation flow, which is disabled for internal emails).
- **Password**: Password changes are already built (via `/api/auth/update-credentials`).
- Admin controls to forcefully reset team credentials or names if needed.

### New/modified files
- `supabase/migrations/...` (New migration to add RLS update policy for `teams`)
- `src/app/api/auth/update-username/route.ts` (Uses Admin SDK to bypass email confirmations)
- `src/app/api/team/update-name/route.ts`
- `src/app/(dashboard)/settings/page.tsx`
- `src/components/settings/TeamSettingsForm.tsx`

---

## Open Questions

**None.** All questions resolved. Ready to execute Phase 1.
