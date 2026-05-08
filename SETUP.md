# Surat Fantasy League — Setup Guide

## Prerequisites

- Node.js 18+
- A free [Supabase](https://supabase.com) account
- A free [Vercel](https://vercel.com) account (for deployment)

---

## Local Development

### 1. Install dependencies

```bash
npm install
```

### 2. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a new project (free tier)
2. Once the project is ready, go to **Settings → API**
3. Copy your **Project URL** and **anon public** key

### 3. Run the database schema

1. In the Supabase dashboard, go to **SQL Editor**
2. Paste the contents of `supabase/schema.sql` and run it
3. This creates all tables, RLS policies, and seeds the 7 teams

### 4. Configure environment variables

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SYNC_SECRET=any-random-string-you-choose
```

### 5. Create user accounts

Accounts use **username + password** (not email). Behind the scenes Supabase uses `username@surat-fl.internal` as the email — teams only ever see their username.

1. In Supabase dashboard, go to **Authentication → Users**
2. Create the following accounts:
   - **1 Admin account** (you) — full edit rights across the entire app
   - **1 Auction Master account** — read all teams, write on auction page
   - **7 Team accounts** — one per team (e.g. `team1` / `team7`)
3. Note down each user's UUID

> **Guest access**: Guests don't need accounts. The login page has a "Continue as Guest" button that grants read-only, real-time access. Sessions clear when the browser is closed.

### 6. Set up user profiles & link to teams

In the Supabase SQL editor, run:

```sql
-- Admin profile
insert into profiles (id, role, username, display_name)
values ('admin-uuid', 'admin', 'rohan', 'Rohan');

-- Auction Master profile
insert into profiles (id, role, username, display_name)
values ('am-uuid', 'auction_master', 'auctionmaster', 'Auction Master');

-- Team profiles (repeat for each of the 7 teams)
insert into profiles (id, role, username, display_name, team_id)
values ('uuid-here', 'team', 'team1', 'Team 1 FC',
  (select id from teams where short_name = 'T1'));
```

Update team display names and auction order (based on previous year standings, 1 = 1st place):

```sql
update teams set display_name = 'Rohan FC', short_name = 'RFC', auction_order = 1
  where short_name = 'T1';
-- repeat for each team
```

### 7. Sync FPL player data

```bash
curl -X POST http://localhost:3000/api/fpl/sync \
  -H "Authorization: Bearer your-sync-secret"
```

This fetches all ~700 Premier League players from the FPL API and loads them into your database. Re-run this any time you want updated stats.

### 8. Start the dev server

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000)

---

## Deploying to Vercel

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "initial commit"
gh repo create surat-fl --private --push --source=.
```

### 2. Import to Vercel

1. Go to [vercel.com](https://vercel.com) → **Add New Project**
2. Import your GitHub repo
3. Under **Environment Variables**, add the same three variables from your `.env.local`
4. Click **Deploy**

Vercel gives you a public URL you can share with the other teams immediately.

### 3. Re-run the player sync against production

```bash
curl -X POST https://your-app.vercel.app/api/fpl/sync \
  -H "Authorization: Bearer your-sync-secret"
```

---

## Project Structure

```
src/
├── app/
│   ├── (auth)/login/              # Login page (username + guest)
│   ├── (dashboard)/
│   │   ├── dashboard/             # League overview
│   │   ├── team/[id]/             # Individual team roster
│   │   ├── teams/                 # All teams side-by-side
│   │   ├── auction/               # Live auction page
│   │   └── standings/             # League table / leaderboard
│   ├── api/
│   │   ├── fpl/sync/              # FPL player sync endpoint
│   │   ├── auction/[action]/      # Auction action endpoints
│   │   ├── team/[action]/         # Team management endpoints
│   │   ├── drops/[action]/        # Drop management endpoints
│   │   ├── scoring/sync/          # Gameweek points sync
│   │   └── auth/update-credentials/
│   ├── layout.tsx
│   └── page.tsx                   # Redirects to /login or /dashboard
├── components/
│   ├── ui/                        # shadcn/ui components
│   ├── auction/                   # Auction page components
│   │   ├── AuctionProvider.tsx    # Real-time state context
│   │   ├── PlayerSelectionPanel.tsx
│   │   ├── CentralConsole.tsx     # Current player + stats + base price
│   │   ├── TeamBidConsole.tsx     # Per-team bid card
│   │   ├── AuctionTimer.tsx       # 45-second countdown
│   │   ├── AuctionLog.tsx         # Fuzzy-searchable live log
│   │   ├── AuctionMasterControls.tsx
│   │   └── BiddingRound.tsx       # Circular bid order display
│   ├── team/                      # Team page components
│   │   ├── PlayerCard.tsx         # Draggable player row + actions
│   │   ├── SquadSection.tsx       # Starting XI (11 slots)
│   │   ├── BenchSection.tsx       # Bench (4 slots, priority ordered)
│   │   ├── DroppedSection.tsx     # Drop staging
│   │   └── TeamBudgetBar.tsx      # Dynamic budget display
│   ├── standings/
│   │   └── StandingsTable.tsx     # League table
│   ├── nav.tsx
│   ├── providers.tsx
│   └── theme-toggle.tsx
├── lib/
│   ├── supabase/                  # Supabase client (browser + server)
│   ├── fpl.ts                     # FPL API fetcher
│   ├── auction-engine.ts          # Core auction logic
│   ├── drops.ts                   # Drop management logic
│   ├── scoring.ts                 # FPL points sync + standings
│   ├── deadline.ts                # FPL gameweek deadline fetcher
│   ├── roles.ts                   # Role helpers + permissions
│   └── utils.ts                   # cn(), formatMoney(), helpers
├── types/index.ts                 # All TypeScript types + rules
└── proxy.ts                       # Auth middleware (role-aware)
supabase/
└── schema.sql                     # Full DB schema — run this in Supabase
```

---

## User Roles

**Role hierarchy**: Admin ⊇ Auction Master ⊇ Team ⊇ Guest

| Role | Read Access | Write Access | Notes |
|---|---|---|---|
| **Admin** | Everything | Everything | Superset of AM — can perform all AM actions without a separate account |
| **Auction Master** | Everything | Auction page (select player, timer, conclude bids, 10-move undo, confirm drops) | Cannot perform admin-only actions |
| **Team** | Everything | Own team only (bids, roster, bench, drops) | |
| **Guest** | Everything | None | Session cleared on browser close; unlimited concurrent guests |

---

## What's built (Phase 0 — skeleton)

- [x] Team login with Supabase Auth
- [x] League overview dashboard (budgets, player counts)
- [x] Individual team roster pages (by position, empty slots, budget breakdown)
- [x] All-teams view
- [x] Auction page skeleton (player browser, team budgets panel)
- [x] FPL player sync (positions, % selected, club, status)
- [x] Dark / light mode
- [x] Auth middleware (redirect to login if unauthenticated)
- [x] Full database schema with RLS

## Rollout Phases

### Phase 1 — Foundation
- [ ] Username + password login (not email)
- [ ] Role-based auth: Admin, Auction Master, Team, Guest
- [ ] Guest "Continue as Guest" button (session clears on browser close)
- [ ] Profiles table with `username`, `display_name`, `role`, `team_id`
- [ ] Teams can change their password after first login
- [ ] Dashboard with £100m budgets per team

### Phase 2 — Team Pages
- [ ] Roster pages with placeholder slots before draft
- [ ] Base price displayed (not FPL cost)
- [ ] Compact position counts on all-teams view (GK 0/2, DEF 0/5, etc.)

### Phase 3 — Auction MVP
- [ ] Positional bidding: GK → DEF → MID → FWD (won't advance until all teams fill current position)
- [ ] Player selection panel locked to current position category
- [ ] 45-second interest timer
- [ ] Team bid consoles: budget, position counts, interest + bid input
- [ ] Bid validation: integer, ≥ base price, +£1m increment (or +£2m above £20m), max bid = budget - (slots-1)
- [ ] Position eligibility: disabled when position is full
- [ ] AM concludes bids, assigns players
- [ ] Real-time updates via Supabase Realtime
- [ ] Live auction log (fuzzy searchable)

### Phase 4 — Full Auction
- [ ] Enforced circular bid order with auto-rotation after each player
- [ ] Teams auto-skipped when their position is full
- [ ] 10-move undo (player assignments, timer resets, bid corrections)
- [ ] Undoing assignment returns player to pool + refunds budget
- [ ] End Draft button (blocked until all 7 teams have 15 players)
- [ ] AM sets initial auction order (based on previous year standings)

### Phase 5 — Team Management
- [ ] Starting XI (11) / Bench (4, priority-ordered) / Dropped sections
- [ ] Drag and drop between Starting XI and Bench
- [ ] Captain / Vice Captain selection
- [ ] Drop staging (returnable before auction starts)
- [ ] Dynamic budget when players move to dropped section
- [ ] Formation minimums enforced (1 GK, 3 DEF, 3 MID, 1 FWD)
- [ ] Auto-lock at FPL gameweek deadlines (via FPL API)

### Phase 6 — Drops & Mini-Auctions
- [ ] Teams mark players for drop → player **stays in squad**, budget unchanged
- [ ] Teams can **remove a player from the drop list** at any time before the auction starts
- [ ] AM clicks **"Start Auction"** → all drops across all teams are simultaneously locked and added to the player pool
- [ ] Drop quotas: 3 free (first in-season + post-Jan), 2 free (all other mini-auctions); max 1 rollover
- [ ] **-4 pt penalty** per excess drop, deducted at **end of the gameweek**
- [ ] Dropped player base price = ceil(purchase_price × 0.5)
- [ ] Mini-auction pool: confirmed drops + undrafted players
- [ ] Same-window re-sign restriction enforced at lock time
- [ ] Post-Jan rule: team can't re-sign player they dropped after January (ever)
- [ ] Pre-Jan rule: team can only re-draft a dropped player after first Jan auction starts

### Phase 7 — Scoring & Leaderboard
- [ ] Sync real FPL points per gameweek per player
- [ ] Calculate team GW points from starting XI of 11
- [ ] Apply -4 pt drop penalties to standings
- [ ] Leaderboard / standings page (rank, GW pts, total pts, penalty pts)
- [ ] Live standings drive auction bid order for subsequent auctions

---

## Key Rules

```ts
export const SQUAD_RULES = {
  total: 15,
  starting: 11,
  bench: 4,
  slots: { GK: 2, DEF: 5, MID: 5, FWD: 3 } as Record<Position, number>,
  min_starting: { GK: 1, DEF: 3, MID: 3, FWD: 1 } as Record<Position, number>,
  min_bid: 1,
}

export const BID_RULES = {
  increment_threshold: 20,  // £20m
  increment_below: 1,       // +£1m when current bid < £20m
  increment_above: 2,       // +£2m when current bid ≥ £20m
}

export const DROP_RULES = {
  free_drops_first_inseason: 3,
  free_drops_post_jan: 3,
  free_drops_standard: 2,
  max_carry_over: 1,
  penalty_per_extra_drop: -4,  // deducted end of gameweek
  drop_price_factor: 0.5,      // ceil(purchase_price × 0.5)
}
```

### Budget & Bid Validation
- Max bid: `budget - (empty_slots - 1)`
- Increment: **+£1m** when current bid < £20m; **+£2m** when ≥ £20m
- All bids must be **integers** ≥ player's base price
- Base price after draft = winning bid amount
- Base price after drop = `ceil(last_draft_price × 0.5)`

### Auction Phases Per Player
1. **Interest Phase** — 45s timer; teams indicate interest or pass
2. **Bidding Phase** — interested teams bid in circular order; must raise or fold; fold = eliminated for this player
3. **Conclusion** — AM confirms winner; player assigned, budget deducted, `base_price` updated

### Player Stats Shown in Auction Console
Position · Club · Injury/status · Total FPL points · Goals · Assists · Clean sheets · Bonus points · Yellow/Red cards · Minutes played · Defensive contribution points

*(No % selected or FPL price — these are irrelevant to our auction)*

### Auto-Sub Scoring Rules
When a starting XI player did not play in a gameweek:
1. Check bench players in priority order (bench slot 1 → 4)
2. Sub in the first bench player whose position keeps the formation valid
3. Continue until all non-playing starters are filled or bench is exhausted

### Re-Draft Restrictions (cumulative)
1. **Same-window**: a team can never re-sign a player dropped in the **same auction window**
2. **Pre-Jan**: a player dropped before January can only be re-drafted after the **first January auction has started**
3. **Post-Jan**: a player dropped after January opens **can never** be re-signed by the same team

### Drop Lifecycle
1. Team marks a player for drop → player **stays in their squad** and budget reflects their presence
2. Team can **remove the player from drop list at any time** before the auction starts
3. AM clicks **"Start Auction"** → all drops across all teams are **simultaneously locked** and committed to the player pool
4. Re-draft restrictions evaluated at lock time; -4 pt penalty per excess drop deducted at end of GW
