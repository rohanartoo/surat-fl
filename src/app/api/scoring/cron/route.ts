import { NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { syncGameweekPoints, applyDropPenalties } from "@/lib/scoring"
import { fetchFplBootstrap } from "@/lib/fpl"
import { verifySyncSecret } from "@/lib/auth"

function createClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * POST /api/scoring/cron
 * Called by Vercel cron every 30 minutes (see vercel.json).
 * Auto-detects the current gameweek and syncs points only if one is active.
 * Auth: Bearer SYNC_SECRET (same secret used for manual sync).
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (!verifySyncSecret(authHeader)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const bootstrap = await fetchFplBootstrap()
    const currentEvent = bootstrap.events.find(e => e.is_current)

    // Skip if no active gameweek or it's already finished
    if (!currentEvent || currentEvent.finished) {
      return NextResponse.json({ skipped: true, reason: "No active gameweek" })
    }

    const gw = currentEvent.id
    const supabase = createClient()

    const [pointsResult, penaltyResult] = await Promise.all([
      syncGameweekPoints(gw, supabase),
      applyDropPenalties(gw, supabase),
    ])

    // Purge chat messages older than 30 days
    await supabase
      .from("chat_messages")
      .delete()
      .lt("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())

    return NextResponse.json({ ok: true, gameweek: gw, ...pointsResult, ...penaltyResult })
  } catch (err) {
    console.error("[scoring/cron] error:", err)
    const message = err instanceof Error ? err.message : JSON.stringify(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
