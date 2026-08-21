import { NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { getProfile } from "@/lib/roles"
import { syncGameweekPoints, applyDropPenalties } from "@/lib/scoring"
import { fetchFplBootstrap } from "@/lib/fpl"
import { verifySyncSecret } from "@/lib/auth"
import { isGameweekFinalized } from "@/lib/lineup-lock"

function createClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(request: Request) {
  // Two auth paths: scheduled cron (Bearer token) or admin session
  const authHeader = request.headers.get("authorization")
  const isScheduled = verifySyncSecret(authHeader)

  if (!isScheduled) {
    const profile = await getProfile()
    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  try {
    const { gameweek, finalize } = await request.json()
    if (!Number.isInteger(gameweek) || gameweek < 1 || gameweek > 38) {
      return NextResponse.json({ error: "gameweek must be an integer between 1 and 38" }, { status: 400 })
    }

    const supabase = createClient()

    // Manual escape hatch for a gameweek that would otherwise never
    // finalize on its own (e.g. a fixture postponed out of its gameweek
    // entirely, so FPL never marks it finished) — see the wedge risk noted
    // in src/lib/lineup-lock.ts. Admin-only in practice: the auth check
    // above only lets a non-scheduled caller through if profile.role is
    // "admin".
    if (finalize === true) {
      const { error: finalizeErr } = await supabase
        .from("gameweek_scoring_status")
        .upsert({ gameweek, finalized_by: "manual" }, { onConflict: "gameweek", ignoreDuplicates: true })
      if (finalizeErr) throw new Error(`scoring/sync finalize: ${finalizeErr.message}`)
    }

    // Only the live gameweek is rebuilt from current squads. For any earlier
    // gameweek, refresh points on the rows already recorded for it so that
    // transfers and mid-season auctions cannot rewrite past results.
    // Fails safe: if FPL reports no active gameweek (pre-season, between
    // seasons, or a bootstrap hiccup) every gameweek counts as past, so a
    // stray manual sync can never rebuild history from current squads.
    // Also preserved once a gameweek is finalized (see gameweek_scoring_status)
    // — computed here, not left to syncGameweekPoints's internal safety net,
    // because preserveRoster also gates the drop-penalty application below.
    const bootstrap = await fetchFplBootstrap()
    const currentEvent = bootstrap.events.find(e => e.is_current) ?? null
    const preserveRoster =
      currentEvent === null || gameweek !== currentEvent.id || await isGameweekFinalized(gameweek, supabase)

    const pointsResult = await syncGameweekPoints(gameweek, supabase, {
      preserveRoster,
      gwFinished: currentEvent?.finished,
    })
    // A pending drop penalty must only ever attach to the live/next gameweek
    // actually being scored for the first time — not to a `preserveRoster`
    // re-sync of an older GW (e.g. refreshing a past GW after an FPL bonus
    // correction), which would permanently steal a penalty meant for later.
    const penaltyResult = preserveRoster
      ? { penaltyRows: 0 }
      : await applyDropPenalties(gameweek, supabase)

    return NextResponse.json({ ok: true, gameweek, ...pointsResult, ...penaltyResult })
  } catch (err) {
    console.error("[scoring/sync] error:", err)
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
