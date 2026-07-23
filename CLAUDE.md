@AGENTS.md

# Surat FL — Project Context

## What this is
A private fantasy football app for 7 teams built on FPL data. Teams draft real FPL players via a live auction, manage their squad, and score points based on real FPL gameweek results. The app is fully built and in pre-season testing ahead of the 2026/27 season.

Tech stack: Next.js 16 (App Router), Supabase (Postgres + Auth + Realtime), Tailwind CSS, shadcn/ui.

## Key files to orient yourself
- `docs/DEFERRED.md` — work intentionally tabled for after dry runs (Postgres RPC transactions)
- `src/lib/roles.ts` — role hierarchy and auth helpers
- `src/lib/scoring.ts` — GW sync, auto-subs, standings, highlights
- `src/lib/drops.ts` — drop quotas, lockAndCommitDrops
- `src/lib/auction-engine.ts` — bid validation, turn rotation, slot assignment
- `src/app/api/auction/[action]/route.ts` — all auction API handlers
- `src/components/auction/AuctionProvider.tsx` — realtime auction context

## Auth
- Users log in with a **username + password**. Email is hidden from the UI.
- Under the hood, Supabase stores the email as `username@surat-fl.internal`.
- Changing a username requires updating both `profiles.username` and `auth.users.email` via the Admin SDK (`supabase.auth.admin.updateUserById`).
- Role hierarchy: `admin ≥ auction_master ≥ team ≥ guest`. All checks are in `src/lib/roles.ts`.

## Database migrations
- Every new table must explicitly grant privileges to all three roles: `grant select, insert, update, delete on public.<table> to authenticated, anon, service_role;`
- RLS policies alone are not sufficient — Postgres-level grants are required separately and must always include `service_role` even though it bypasses RLS.

## Scheduled endpoints
- `POST /api/fpl/sync` and `POST /api/scoring/sync` use `Authorization: Bearer SYNC_SECRET` for scheduled cron triggers.
- Admin session auth is also accepted on these routes for manual triggers.
- Do not add cookie-based session auth as the primary guard on these routes.

## League rules (source of truth)

### Squad & budget
- 7 teams, fixed. £100m budget per team per season.
- 15 players per team: 2 GK, 5 DEF, 5 MID, 3 FWD. Starting XI = 11, Bench = 4 (numbered priority 1–4).
- Formation minimums: 1 GK, 3 DEF, 3 MID, 1 FWD. No strict formations enforced beyond minimums.

### Bidding
- Opening bid ≥ player base price. Increments: +£1m when current bid < £20m, +£2m when ≥ £20m.
- Fold = eliminated for that player. Last team standing wins at current bid.
- If everyone else folds before any bid is placed, the last team standing wins at base price (same as the solo-interest rule). The AM still confirms via Assign.
- Max bid = budget − (empty slots − 1), ensuring team can fill remaining slots at £1m each.

### Auction types & drop quotas
| Auction type | Free transfers | Max rollover |
|---|---|---|
| Initial / post-Jan / post-summer | 3 | 1 |
| All other mini-auctions | 2 | 1 |

- Excess drops: −4 pts per drop above free quota, deducted at end of the gameweek.

### Re-draft restrictions
1. **Same-window**: cannot re-sign a player dropped in the same auction window.
2. **Pre-Jan**: player dropped before January can only be re-drafted after the first January auction starts.
3. **Post-Jan**: player dropped after January opens can never be re-signed that season.
4. **Post-summer**: player dropped after post-summer window can never be re-signed that season.

### Scoring
- Real FPL points for starting XI. Auto-sub rules: non-playing starters replaced by bench in priority order, formation minimums respected.
- Scoring sync: daily cron at 23:00 UTC + manual trigger by admin/AM.
- Season rollover: full wipe in Settings → Danger Zone resets rosters, budgets, scores, and base prices. Does not touch usernames, passwords, or team names.
