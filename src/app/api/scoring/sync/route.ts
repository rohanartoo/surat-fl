import { NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { getProfile } from "@/lib/roles"
import { syncGameweekPoints, applyDropPenalties } from "@/lib/scoring"
import { fetchFplBootstrap } from "@/lib/fpl"
import { verifySyncSecret } from "@/lib/auth"

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
    const { gameweek } = await request.json()
    if (!Number.isInteger(gameweek) || gameweek < 1 || gameweek > 38) {
      return NextResponse.json({ error: "gameweek must be an integer between 1 and 38" }, { status: 400 })
    }

    // Only the live gameweek is rebuilt from current squads. For any earlier
    // gameweek, refresh points on the rows already recorded for it so that
    // transfers and mid-season auctions cannot rewrite past results.
    // Fails safe: if FPL reports no active gameweek (pre-season, between
    // seasons, or a bootstrap hiccup) every gameweek counts as past, so a
    // stray manual sync can never rebuild history from current squads.
    const bootstrap = await fetchFplBootstrap()
    const currentGw = bootstrap.events.find(e => e.is_current)?.id ?? null
    const preserveRoster = currentGw === null || gameweek !== currentGw

    const supabase = createClient()
    const [pointsResult, penaltyResult] = await Promise.all([
      syncGameweekPoints(gameweek, supabase, { preserveRoster }),
      applyDropPenalties(gameweek, supabase),
    ])

    return NextResponse.json({ ok: true, gameweek, ...pointsResult, ...penaltyResult })
  } catch (err) {
    console.error("[scoring/sync] error:", err)
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
