import { cache } from "react"
import { hasRole } from "@/lib/roles"
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any

/**
 * How long before a gameweek's earliest kickoff lineups lock — more
 * forgiving than real FPL's 90 minutes, but still safely ahead of kickoff.
 */
export const DEADLINE_OFFSET_MINUTES = 30

export interface FixtureTiming {
  event: number | null
  kickoff_time: string | null
}

export interface LineupLockState {
  locked: boolean
  lockedGameweek: number | null
  nextDeadline: string | null
  nextDeadlineGameweek: number | null
}

/**
 * Pure — all deadline math lives here so it's testable without a database.
 * deadline(gw) = earliest kickoff among that gameweek's dated fixtures,
 * minus DEADLINE_OFFSET_MINUTES. A gameweek with no dated fixture yet (blank
 * gameweek, or fixtures just hasn't synced) has no deadline and can never
 * lock on its own.
 *
 * Locked iff some gameweek's deadline has passed and it has not been
 * finalized (see gameweek_scoring_status) — NOT merely "all its fixtures
 * finished", since the final auto-sub/captain-fallback rebuild only happens
 * on the next scoring sync after that. lockedGameweek reports the SMALLEST
 * such gameweek, so a stuck/never-finalized gameweek surfaces rather than
 * getting silently shadowed by a later one.
 *
 * Fails open: no fixtures, or none with both an event and a kickoff_time,
 * means unlocked — pre-season, an empty fixtures table, or one that simply
 * hasn't synced yet must never lock the whole league out.
 *
 * Known limitation: fixtures only syncs nightly (see the cron in
 * src/app/api/scoring/cron/route.ts), so a fixture rescheduled EARLIER than
 * its originally-synced kickoff can leave the computed deadline up to ~24h
 * stale until the next sync catches up.
 */
export function computeLineupLock(
  fixtures: FixtureTiming[],
  finalized: Iterable<number>,
  now: Date = new Date(),
): LineupLockState {
  const finalizedSet = finalized instanceof Set ? finalized : new Set(finalized)

  const earliestKickoffByGw = new Map<number, number>()
  for (const f of fixtures) {
    if (f.event == null || !f.kickoff_time) continue
    const ms = new Date(f.kickoff_time).getTime()
    if (Number.isNaN(ms)) continue
    const existing = earliestKickoffByGw.get(f.event)
    if (existing === undefined || ms < existing) earliestKickoffByGw.set(f.event, ms)
  }

  const deadlinesByGw = new Map<number, number>()
  for (const [gw, kickoffMs] of earliestKickoffByGw) {
    deadlinesByGw.set(gw, kickoffMs - DEADLINE_OFFSET_MINUTES * 60 * 1000)
  }

  const nowMs = now.getTime()
  let lockedGameweek: number | null = null
  let nextDeadlineGw: number | null = null
  let nextDeadlineMs: number | null = null

  for (const [gw, deadlineMs] of deadlinesByGw) {
    if (deadlineMs <= nowMs) {
      if (!finalizedSet.has(gw) && (lockedGameweek === null || gw < lockedGameweek)) {
        lockedGameweek = gw
      }
    } else if (nextDeadlineMs === null || deadlineMs < nextDeadlineMs) {
      nextDeadlineMs = deadlineMs
      nextDeadlineGw = gw
    }
  }

  return {
    locked: lockedGameweek !== null,
    lockedGameweek,
    nextDeadline: nextDeadlineMs !== null ? new Date(nextDeadlineMs).toISOString() : null,
    nextDeadlineGameweek: nextDeadlineGw,
  }
}

/** All gameweeks whose scoring has been marked final (gameweek_scoring_status). */
export async function getFinalizedGameweeks(supabase: SupabaseClient): Promise<Set<number>> {
  const { data } = await supabase.from("gameweek_scoring_status").select("gameweek")
  return new Set(((data ?? []) as { gameweek: number }[]).map(r => r.gameweek))
}

export async function isGameweekFinalized(gw: number, supabase: SupabaseClient): Promise<boolean> {
  const { data } = await supabase
    .from("gameweek_scoring_status")
    .select("gameweek")
    .eq("gameweek", gw)
    .maybeSingle()
  return !!data
}

/**
 * Thin DB wrapper around computeLineupLock. Cached per-request (React
 * cache(), same treatment as getProfile in src/lib/roles.ts) so a page that
 * needs lock state more than once during a single render issues one query.
 */
export const getLineupLockState = cache(async (supabase: SupabaseClient, now?: Date): Promise<LineupLockState> => {
  const [{ data: fixtures }, finalized] = await Promise.all([
    supabase.from("fixtures").select("event, kickoff_time"),
    getFinalizedGameweeks(supabase),
  ])
  return computeLineupLock((fixtures ?? []) as FixtureTiming[], finalized, now)
})

/**
 * Server-side enforcement boundary for the four lineup-mutating team-route
 * handlers (swap, set-captain, mark-drop, return-from-drop). Admin and
 * auction_master bypass the lock entirely. Throws rather than returning a
 * boolean so a single `await` at each call site is enough — the route's
 * top-level catch maps the "Lineup locked" prefix to a 409.
 */
export async function assertLineupEditable(supabase: SupabaseClient): Promise<void> {
  if (await hasRole("auction_master")) return
  const lock = await getLineupLockState(supabase)
  if (lock.locked) {
    throw new Error(`Lineup locked: GW ${lock.lockedGameweek} is in progress — lineups reopen once it's fully scored.`)
  }
}
