@AGENTS.md

# Surat FL — Project Context

## What this is
A private fantasy football app for 7 teams built on FPL data. Teams draft real FPL players via a live auction, manage their squad, and score points based on real FPL gameweek results.

Tech stack: Next.js 16 (App Router), Supabase (Postgres + Auth + Realtime), Tailwind CSS, shadcn/ui.

## Status — the season is LIVE

The 2026/27 season is under way (it began August 2026). Testing before the
season is over. Production holds seven real squads and real scored gameweeks.

This changes the risk calculus for anything destructive. Before the season a
wipe cost nothing; now it costs the league its season:

- **Settings → Danger Zone "Reset to Clean Slate" is not a test tool any more.**
  It clears rosters, budgets, scores and base prices for every team.
- **Destructive migrations** (`drop table`, `delete from`, column drops) need
  explicit confirmation and must be applied *after* the code deploy is live —
  CI does not apply migrations, so verify the deploy landed first.
- **`gameweek_points` is real data.** Prefer a re-sync over hand-editing rows;
  see the Scoring section for why manual edits there aren't durable anyway.

## Key files to orient yourself
- `docs/DEFERRED.md` — known gaps deliberately left unbuilt, and the reasons why
- `docs/AUDIT_ROADMAP.md` — outstanding audit phases and test-coverage gaps
- `src/lib/roles.ts` — role hierarchy and auth helpers
- `src/lib/scoring.ts` — GW sync, auto-subs, standings, highlights
- `src/lib/lineup-lock.ts` — gameweek finalization and the lineup lock
- `src/lib/drops.ts` — drop quotas, lockAndCommitDrops
- `src/lib/auction-engine.ts` — bid validation, turn rotation, slot assignment
- `src/app/api/auction/[action]/route.ts` — all auction API handlers
- `src/components/auction/AuctionProvider.tsx` — realtime auction context

## Routes worth knowing
- `/dashboard` — Overview. Also carries the league table and (admin-only) the
  gameweek sync control. `/standings` is gone; it permanently redirects here.
- `/team/[id]` — a team's squad, plus the Gameweek Performance pitch.

## Auth
- Users log in with a **username + password**. Email is hidden from the UI.
- Under the hood, Supabase stores the email as `username@surat-fl.internal`.
- Changing a username requires updating both `profiles.username` and `auth.users.email` via the Admin SDK (`supabase.auth.admin.updateUserById`).
- Role hierarchy: `admin ≥ auction_master ≥ team ≥ guest`. All checks are in `src/lib/roles.ts`.

## Database migrations
- Every new table must explicitly grant privileges to all three roles: `grant select, insert, update, delete on public.<table> to authenticated, anon, service_role;`
- RLS policies alone are not sufficient — Postgres-level grants are required separately and must always include `service_role` even though it bypasses RLS.

## Scheduled endpoints
- **`GET /api/scoring/cron` is the route Vercel actually calls** — six times a
  day, per `vercel.json`. It folds in the FPL player/fixture sync, catches up
  unfinalized past gameweeks, then syncs points and drop penalties.
- **Two env vars, one value.** Vercel Cron issues GET requests and cannot
  attach custom headers; it auto-injects `Authorization: Bearer $CRON_SECRET`.
  But `verifySyncSecret` (`src/lib/auth.ts`) compares against `SYNC_SECRET`.
  **`CRON_SECRET` must be set to the same value as `SYNC_SECRET` in Vercel**,
  or every scheduled run 401s silently. First thing to check if the cron stops.
- `POST /api/fpl/sync` and `POST /api/scoring/sync` use the same
  `Authorization: Bearer SYNC_SECRET` guard, for manual/local triggers.
- Admin session auth is also accepted on these routes for manual triggers.
- Do not add cookie-based session auth as the primary guard on these routes.
- `verifySyncSecret` fails closed: an unset `SYNC_SECRET` rejects everything
  rather than accepting the literal string `"Bearer undefined"`.

## League rules (source of truth)

### Squad & budget
- 7 teams, fixed. £100m budget per team per season.
- 15 players per team: 2 GK, 5 DEF, 5 MID, 3 FWD. Starting XI = 11, Bench = 4 (numbered priority 1–4).
- Formation minimums: 1 GK, 3 DEF, 2 MID, 1 FWD. No strict formations enforced beyond minimums.
- Max 3 players from the same Premier League club per team (`SQUAD_RULES.max_per_club`, enforced by an `enforce_club_cap` trigger on `roster_entries`).

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

### Drops & re-draft restrictions
Season auction order: **initial → post-summer (end-Aug window) → minis → post-January → minis**.

- **No drops in the initial auction** — teams start empty, so there is nothing to drop. `handleMarkDrop` rejects drops when the current auction is `initial`.
- The re-draft rule pivots on the **post-January window (≈ Feb 1)**, modeled by whether a `post_jan` auction is under way / has completed:
  1. A player dropped **in or after** the post-January window can **never** be re-drafted by the **same team** that season (permanent). At drop time `handleMarkDrop` sets `dropped_post_january = true` when the current auction is `post_jan` **or** a `post_jan` auction has already completed.
  2. A player dropped **before** the post-January window can be re-drafted **by the same team from the post-January auction onward** — the gate keys off a `post_jan` auction being active/completed (`checkReDraftEligibility`).
  3. **Same-window**: independently, a team can never re-sign a player it dropped in the **same auction** (auction_id match in `handleDeclareInterest` / the initial auto-enroll).
- A **different** team is never restricted from re-drafting a player someone else dropped.
- `team_drops.dropped_post_summer` is retained for history but **no longer affects eligibility** — a post-summer drop is a pre-January drop.

### Scoring
- Real FPL points for starting XI. Auto-sub rules: non-playing starters replaced by bench in priority order, formation minimums respected.
- **`gameweek_points.points` stores the captain's haul ALREADY DOUBLED.**
  `stat_breakdown.total_points` is always the raw, un-doubled FPL figure, and
  `points_breakdown` line items sum to *that*. Nothing in the column names
  hints at this, and it has already caused one production bug: Player of the
  Week ranked on the doubled column while displaying the halved value, so a
  captain on 13 outranked a 14 and was then shown as 13 (fixed in `a962a9a`).
  Rule of thumb: **team totals sum the doubled column** (a captain's double
  genuinely counts for the team), **individual-player comparisons must
  un-double first**.
- Scoring sync: cron every 4 hours (03/07/11/15/19/23 UTC) + manual trigger by admin/AM. Vercel Hobby caps each cron expression at once per day, so `vercel.json` lists six separate entries hitting the same endpoint; timing is per-hour precision (±59 min), not exact.
- A gameweek only *finalizes* (auto-subs and captain→VC resolved, lineup lock lifted) once FPL's own `events[].finished` flag flips — which it does after bonus points are confirmed, typically the morning after the last fixture. Until then the cron rebuilds `gameweek_points` from the live rosters on every run, so manual edits to that table are not durable; edit `roster_entries` instead. See `src/lib/lineup-lock.ts`.
- Season rollover: full wipe in Settings → Danger Zone resets rosters, budgets, scores, and base prices. Does not touch usernames, passwords, or team names.

---

# Maintaining this file

This file is loaded into every agent session as project instructions. Nothing
in the toolchain reads it, so a stale claim here misleads silently and
indefinitely — it has already happened twice: this file described the app as
still being tested before the season two gameweeks into the live season, and
pointed at `docs/DEFERRED.md` for RPC work that doc records as finished.

**Update this file in the same commit as the change, not afterwards.** A
follow-up commit is a follow-up that doesn't happen.

## Triggers — a change of any of these kinds means editing this file

| If you change… | Update |
|---|---|
| A file named in **Key files** or **Routes worth knowing** (rename, move, delete) | that list |
| A route's auth guard, or any `*_SECRET` / env var | **Scheduled endpoints** |
| A league rule — squad shape, bid increments, drop quotas, re-draft eligibility, scoring | **League rules**, which is the stated source of truth |
| The cron schedule or `vercel.json` | **Scheduled endpoints** and the Scoring bullet naming the hours |
| Adding/removing a top-level route, or redirecting one | **Routes worth knowing** |
| Season state (rollover, a new season starting) | **Status** — and the test that guards it |
| A non-obvious data-model fact that bites someone | **League rules**, as a bolded gotcha |

## What is enforced automatically

`src/lib/__tests__/agent-docs.test.ts` runs in CI and fails if:
- any repo path named in backticks here or in `AGENTS.md` no longer exists;
- an env var documented here isn't referenced anywhere in `src/`
  (`CRON_SECRET` is exempt — Vercel injects it, our code never reads it);
- the Status section regresses to claiming the season hasn't started.

That covers dangling references, which is the most common drift. **It cannot
check whether the prose is true.** Rules, quotas, auth behaviour and the
status section are only as accurate as the last person to touch them.

## Style

State the gotcha and the reason, not just the rule — the reason is what lets
a reader tell whether it still applies. Where a claim came from a real bug,
cite the commit, so a future reader can check whether it was since fixed.
