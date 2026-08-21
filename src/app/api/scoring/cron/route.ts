import { NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { syncGameweekPoints, applyDropPenalties } from "@/lib/scoring"
import { fetchFplBootstrap, syncFplPlayers, syncFixtures } from "@/lib/fpl"
import { verifySyncSecret } from "@/lib/auth"
import { getFinalizedGameweeks } from "@/lib/lineup-lock"

// How many past, finished-but-unfinalized gameweeks to catch up per cron run.
// A missed cron run (or FPL flipping is_current before a gameweek's final
// rebuild ever happened) must not wedge the lineup lock open forever — see
// src/lib/lineup-lock.ts. Capped so one bad night can't turn into an
// unbounded rebuild pass; a backlog this deep would mean the cron has been
// broken for weeks, which needs investigating anyway, not silently absorbing.
const CATCH_UP_LIMIT = 3

function createClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function runCron() {
  const supabase = createClient()

  // Player/fixture data (used by the Auction pool and My Team's "vs
  // opponent" display) previously only ever updated when an AM/admin
  // manually clicked "Sync FPL data" — nothing scheduled it. Folded in here
  // rather than as a second Vercel cron entry, keeping the cron-job count at
  // one (Hobby-plan crons are capped at 2/day). Runs regardless of whether a
  // gameweek is currently active — player/fixture data can go stale between
  // seasons or pre-season just as easily as mid-season. Each sync gets its
  // own try/catch so a failure in one never blocks the other, or the
  // points/penalty sync below.
  let fplSyncResult: unknown
  try {
    fplSyncResult = await syncFplPlayers(supabase)
  } catch (e) {
    console.error("[scoring/cron] syncFplPlayers failed:", e)
    fplSyncResult = { error: e instanceof Error ? e.message : String(e) }
  }
  let fixturesSyncResult: unknown
  try {
    fixturesSyncResult = await syncFixtures(supabase)
  } catch (e) {
    console.error("[scoring/cron] syncFixtures failed:", e)
    fixturesSyncResult = { error: e instanceof Error ? e.message : String(e) }
  }

  const bootstrap = await fetchFplBootstrap()
  const currentEvent = bootstrap.events.find(e => e.is_current)

  // Catch up any past gameweek FPL has marked finished but that never got
  // its final (gwFinished) rebuild — e.g. a missed cron run, or is_current
  // moving to the next gameweek before that happened. These are safe to
  // rebuild unconditionally: every one of them has been past its own
  // lineup-lock deadline since it started, so the roster can't have
  // drifted. Runs even if there's no currentEvent at all (end of season).
  const finalizedGws = await getFinalizedGameweeks(supabase)
  const toCatchUp = bootstrap.events
    .filter(e => e.finished && e.id !== currentEvent?.id && !finalizedGws.has(e.id))
    .sort((a, b) => a.id - b.id)
    .slice(0, CATCH_UP_LIMIT)
  const catchUpResults: Record<number, unknown> = {}
  for (const e of toCatchUp) {
    try {
      catchUpResults[e.id] = await syncGameweekPoints(e.id, supabase, { gwFinished: true })
    } catch (err) {
      console.error(`[scoring/cron] catch-up finalize GW ${e.id} failed:`, err)
      catchUpResults[e.id] = { error: err instanceof Error ? err.message : String(err) }
    }
  }

  // Skip the points/penalty sync only if there's no active gameweek at all.
  // Do NOT skip once it's finished — that final sync is what actually
  // resolves auto-subs and the captain->VC fallback (syncGameweekPoints
  // gates those on gwFinished), so skipping here would mean the
  // finished/final state never gets written.
  if (!currentEvent) {
    return NextResponse.json({ skipped: true, reason: "No active gameweek", fplSyncResult, fixturesSyncResult, catchUpResults })
  }

  const gw = currentEvent.id
  // Computed here (not left to syncGameweekPoints's internal safety flip)
  // because preserveRoster also gates applyDropPenalties below — a penalty
  // must never be applied to an already-finalized gameweek either.
  const finalized = finalizedGws.has(gw)

  const [pointsResult, penaltyResult] = await Promise.all([
    syncGameweekPoints(gw, supabase, { preserveRoster: finalized, gwFinished: currentEvent.finished }),
    finalized ? Promise.resolve({ penaltyRows: 0 }) : applyDropPenalties(gw, supabase),
  ])

  // Purge chat messages older than 30 days
  await supabase
    .from("chat_messages")
    .delete()
    .lt("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())

  return NextResponse.json({ ok: true, gameweek: gw, fplSyncResult, fixturesSyncResult, catchUpResults, ...pointsResult, ...penaltyResult })
}

/**
 * GET /api/scoring/cron
 * Vercel Cron issues GET requests and cannot attach custom headers — it
 * auto-injects `Authorization: Bearer $CRON_SECRET` instead. Set CRON_SECRET
 * in the Vercel project's env vars to the same value as SYNC_SECRET so this
 * authenticates. (The POST handler below remains for manual/local triggers.)
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (!verifySyncSecret(authHeader)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    return await runCron()
  } catch (err) {
    console.error("[scoring/cron] error:", err)
    const message = err instanceof Error ? err.message : JSON.stringify(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * POST /api/scoring/cron
 * Manual/local trigger equivalent of the GET handler above.
 * Auto-detects the current gameweek and syncs points only if one is active.
 * Auth: Bearer SYNC_SECRET (same secret used for manual sync).
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (!verifySyncSecret(authHeader)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    return await runCron()
  } catch (err) {
    console.error("[scoring/cron] error:", err)
    const message = err instanceof Error ? err.message : JSON.stringify(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
