# Full Audit Roadmap

On 2026-08-08, a three-lane read-only audit (scoring/data-integrity, auction/roster
mutations, auth/security) found real defects at every severity level. Critical +
High were fixed the same day (see git log around that date, and
`.github/workflows/ci.yml` added alongside). This doc tracks what's left to reach
a genuinely full audit, broken into phases meant to be tackled one at a time,
independently, whenever there's a spare session.

Each phase is scoped to be startable on its own — pick whichever's most relevant
next, no fixed order required, though they're listed roughly cheapest/highest-value
first.

---

## Phase 1 — Close out the known Medium/Low findings ✅ Done (2026-08-09)

Already identified and verified during the 2026-08-08 audit; just not fixed because
that pass was scoped to Critical + High only. No new investigation needed, just
implementation.

- `handleCancel` (auction cancel) and `/api/admin/reset` (full wipe) are sequential,
  unguarded multi-step writes — same class of bug as the Critical fixes already
  shipped, lower likelihood of hitting it.
- `handleEndDraft` squad-size check is floor-only (`< SQUAD_RULES.total`), so a
  16-player squad passes; also no `validateFormation` check at end of draft.
- `handleEndDraft`'s `team_transfer_records` insert isn't idempotent — a retry
  after a failed status flip hits `unique_team_auction` and permanently blocks
  ending the draft.
- `handleOpenLot`'s `.maybeSingle()` swallows the "more than one row" error,
  silently passing a player already on two teams' rosters through the
  already-on-a-roster check.
- `preserveRoster` re-sync zeroes a player's historical points if they're missing
  from that gameweek's FPL live data (deleted/reissued FPL element).
- Incomplete-XI teams (fewer than 15 players) silently score from whatever they
  have, no auto-subs possible, no warning shown anywhere.
- `getStandings` fetches all `gameweek_points` rows with no `.range()` — fine at
  7 teams today, worth confirming Supabase's `db-max-rows` won't silently
  truncate it by end of a full season (~4,000 rows).
- `simulate-gw` has no guard against overwriting a real synced gameweek with
  random data — the `check/` route is advisory/client-side only.
- Chat un-kick doesn't propagate live — `chat_kicks` needs `replica identity full`
  for Realtime DELETE payloads to carry `guest_name`.
- `AuctionProvider`'s `auction-lots`/`auction-bids` channels trigger a full
  `refresh()` (multi-query refetch) on every single row change, for all
  connected clients — no debounce. Also `roster_entries` UPDATE isn't
  subscribed, so slot swaps between two starters don't propagate live (only
  INSERT/DELETE are).
- `protect_profile_fields` trigger has no `service_role`/`security definer`
  exemption — blocks any future admin-driven role or team reassignment feature,
  even from the service client.
- Dead code: `free_drops_post_jan`/`free_drops_post_summer` constants are never
  read (`freeDropsForType` hardcodes the same value for all three special auction
  types), and `DropStatus`'s `'cancelled'` value is never written anywhere.

**Effort**: small, mechanical fixes — a single session should clear most of this list.

---

## Phase 2 — Route-handler test coverage 🔶 Slice 1 done (2026-08-09), slice 2 open

Before this: the test suite covered pure functions in `src/lib/` almost
entirely — `scoring.ts`, `auction-engine.ts`, `drops.ts`. The API route handlers
in `src/app/api/**/route.ts` (the actual request/response logic, auth checks,
RPC wiring) had **zero** automated coverage — every verification of a route
handler this session was done manually via live Playwright + `docker exec psql`,
which doesn't persist as a regression guard.

**Slice 1 (done)** — built the shared mock harness and covered the handlers most
recently touched by real bugs:
- `src/app/api/__tests__/route-test-helpers.ts` — a reusable `createMockSupabase()`
  fake extending the `makeQueryChain`/`makeSupabase` pattern already established in
  `scoring.test.ts` with `.single()`/`.maybeSingle()`/`.insert()`/`.update()`/
  `.delete()`/`.upsert()`/`.rpc()` (with call recording) and count-mode selects.
  Data is keyed by table name; a table queried multiple times per handler with
  different expected shapes can be given an array of responses, consumed in call
  order. `vi.mock("@supabase/supabase-js")` + `vi.mock("@/lib/roles")` intercept
  the route's own `createClient()`/`requireRole`/`assertOwnership`/`getProfile` —
  no real Next.js request context or cookies needed. Tests call the real exported
  `POST`/`GET` handlers with a constructed `NextRequest`, so the actual dispatch +
  error-wrapping code is exercised, not extracted logic.
- `team-route.test.ts` — `handleSetCaptain` (captain/VC mutual-exclusivity
  regression guard), `handleSwap` (formation-cap rejection, `rpc_swap_roster_entry`
  call args, RPC error propagation).
- `auction-route.test.ts` — `handleCancel` (`rpc_cancel_auction` wiring/error
  propagation), `handleStartBidding` (no-interest, solo-win affordable/unaffordable
  — regression guard for the solo-win budget fix, multi-team bidding start).
- `loan-transfers-route.test.ts` — every validation branch (missing fields,
  self-trade, cash validation, ownership, active-roster check, position mismatch,
  team-not-found, club-cap, budget) plus a full happy path reaching
  `rpc_execute_loan_transfer` with the expected args.
- 138 total tests (101 → 138), all passing in CI.

**Slice 2 (open)** — same pattern, next handlers by the original risk ranking:
`handleMarkDrop`/`handleReturnFromDrop` (deferred from slice 1 — the fullest
orchestration of any handler: `getCurrentAuction` + `getCarryoverForTeam` +
`getDropQuota` + `repairTeamCaptaincy` all compose in one call, each hitting
`roster_entries`/`auctions`/`team_drops` with different shapes — needs a careful
call-order map like `loan-transfers`'s happy-path test, just longer),
`handleEndDraft`, `handleOpenLot` (most complex single handler — initial-auction
auto-enroll branching, redraft bans, club/position caps), `handlePlaceBid`/
`handleFold` (thin RPC wrappers — lower marginal value, logic lives in SQL),
`handleAssignPlayer`, `handleUndoLastAssignment`, `handleFullWipe`. Also
still open: an actual **integration-test subset** against the real local Supabase
stack (`supabase start` in CI) for the RPC-backed critical paths themselves
(`rpc_place_bid`, `rpc_lock_and_credit_drops`, the drop-staging RPCs) — the mock
harness verifies a handler calls an RPC with the right arguments, not that the
RPC's own SQL is correct; that's still only covered by manual/live verification.

**Effort**: slice 1 was ~1 session. Slice 2 (remaining handlers + real integration
tests) is still genuinely multi-session work.

---

## Phase 3 — RLS policy systematic review

The 2026-08-08 audit spot-checked policies that looked suspicious; a full audit
reads every policy against every role methodically.

- For each table in `supabase/migrations/*.sql`, tabulate: which roles
  (`admin`/`auction_master`/`team`/`guest`/`anon`) can `select`/`insert`/
  `update`/`delete`, per the RLS policy — cross-referenced against the
  Postgres-level `grant` statements (both must line up; a grant without a
  matching policy is dead, a policy without a grant is unreachable).
- Confirm every policy using `for all`/`using(...)` without a `with check`
  doesn't allow writing rows that wouldn't pass the `using` clause on read.
- Confirm `service_role` is always granted (per `CLAUDE.md`'s stated
  convention) even though it bypasses RLS, for consistency.
- Produce a single table (could live in this doc, or `docs/RLS_MATRIX.md`) so
  future migrations can be checked against it instead of re-deriving intent
  from scratch each time.

**Effort**: small-medium, mostly reading — good candidate for a background/Explore
agent pass, then a human/AI review of the resulting matrix.

---

## Phase 4 — Frontend/UI audit

Not covered at all by the 2026-08-08 audit, which was entirely backend/API-focused.

- Client-side form validation — does every input that has server-side
  validation (bid amounts, drop confirmations, team name changes) also fail
  gracefully client-side, or just surface a raw API error?
- Accessibility — keyboard navigation through the auction bid console and
  drag-and-drop squad manager (drag-and-drop in particular is often
  keyboard-inaccessible by default), color contrast, screen-reader labeling.
- Client-side state bugs beyond what's already been found — stale closures,
  effect cleanup, optimistic-update revert correctness — in components not
  touched by prior sessions' bug fixes (e.g. `Teams`, `Settings`, `Overview`
  pages haven't had focused review).

**Effort**: medium — best done as its own Explore-agent pass per major page/component tree.

---

## Phase 5 — Performance pass

- N+1 query patterns — grep for `.map` calling `await` per-row instead of a
  single batched `.in()` query (the codebase mostly avoids this per existing
  comments, but worth confirming systematically rather than spot-checking).
- Realtime overhead — covered partially by Phase 1's `AuctionProvider` item;
  broader pass would profile actual payload/refetch sizes during a live
  7-team auction.
- Missing indexes — check `roster_entries`, `gameweek_points`, `bids` for
  columns filtered/joined on frequently but not indexed.

**Effort**: small-medium, needs a realistic data volume to profile against
(seed a full season's worth of `gameweek_points` locally first).

---

## Phase 6 — Adversarial / load testing

- Concurrent-write stress: fire simultaneous bids on the same lot, simultaneous
  drop-stage/un-stage on the same player, simultaneous auction-start requests —
  confirm the RPC row-locking actually holds under real concurrency, not just
  the sequential-request races already reasoned about statically.
- Malformed/hostile request bodies against every route — wrong types, huge
  payloads, SQL-injection-shaped strings (should be moot given parameterized
  Supabase calls, but worth confirming), unicode edge cases in chat/names.
- Rate-limit abuse of the intentionally-open `/api/chat/send` guest endpoint —
  decide whether basic rate limiting is warranted even for a private league
  (e.g. Vercel's built-in options, or a simple per-IP counter).

**Effort**: medium — needs a scripted load-test harness (k6, Playwright with
many parallel contexts, or similar).

---

## Phase 7 — Operational readiness

- Backup/restore drill: actually attempt a full restore from a Supabase backup
  in a scratch project, confirm it works and time how long it takes, before
  ever needing it for real.
- Monitoring/alerting on the scoring cron — Phase 1 of the 2026-08-08 fixes
  made the cron actually run; nothing currently *alerts* if it silently stops
  working again (e.g. FPL API shape changes, secret rotates and breaks auth).
  A simple "cron ran successfully recently" check (Vercel cron monitoring, or
  a dead-man's-switch style external ping) would have caught today's "never
  actually ran" bug immediately instead of it going unnoticed for however
  long it was live. Note the window this should use has changed: the cron now
  runs every 4 hours (2026-08-25), so ~5 hours is the right threshold, not
  the 25 hours a once-daily schedule implied.
- A short incident runbook: what to do if a gameweek's data looks wrong, if
  an auction gets stuck, if budgets look off — who has DB access, which
  scripts/queries were used to diagnose past incidents (several are documented
  implicitly in this session's history but not written down anywhere durable).

**Effort**: small-medium, mostly documentation + one real backup/restore test.

---

## Suggested order

Given this is a 7-team private league in pre-season testing (not planet-scale,
not handling real money beyond bragging rights), the highest value-per-effort
ordering is:

1. **Phase 1** (finish the known list — cheap, already-diagnosed)
2. **Phase 2** (route-handler tests — closes the biggest real gap: today's fixes
   are only guarded by manual verification, not regression tests)
3. **Phase 3** (RLS matrix — cheap, mostly reading, high confidence payoff)
4. **Phase 7** (operational readiness — cheap, and directly prevents a repeat
   of "the cron silently never ran")
5. Phases 4/5/6 as time allows — valuable but lower urgency at this scale.
