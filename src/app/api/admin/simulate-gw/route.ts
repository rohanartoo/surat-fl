import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { requireRole } from "@/lib/roles"

function createClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function simulatePoints(): number {
  const r = Math.random()
  if (r < 0.05) return Math.floor(Math.random() * 6) + 10  // 10-15: star performance
  if (r < 0.20) return Math.floor(Math.random() * 3) + 7   // 7-9: very good
  if (r < 0.55) return Math.floor(Math.random() * 3) + 4   // 4-6: decent
  if (r < 0.85) return Math.floor(Math.random() * 2) + 2   // 2-3: average
  return 1                                                   // 1: poor
}

/**
 * POST /api/admin/simulate-gw
 * Body: { gameweek: number }
 * Admin only. Generates random points for all rostered players for the given GW.
 * Upserts into gameweek_points — safe to re-run for the same GW.
 */
export async function POST(request: NextRequest) {
  try {
    await requireRole("admin")
  } catch {
    return NextResponse.json({ error: "Admin only." }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const { gameweek } = body

  if (typeof gameweek !== "number" || gameweek < 1 || gameweek > 100) {
    return NextResponse.json({ error: "gameweek must be a number between 1 and 100." }, { status: 400 })
  }

  const supabase = createClient()

  const { data: rosterRows, error: rosterErr } = await supabase
    .from("roster_entries")
    .select("team_id, player_id")
    .in("slot_type", ["starting", "bench"])

  if (rosterErr) return NextResponse.json({ error: rosterErr.message }, { status: 500 })
  if (!rosterRows || rosterRows.length === 0) {
    return NextResponse.json({ error: "No rostered players found. Run a draft first." }, { status: 400 })
  }

  const rows = rosterRows.map(r => ({
    team_id: r.team_id,
    player_id: r.player_id,
    gameweek,
    points: simulatePoints(),
  }))

  const { error: upsertErr } = await supabase
    .from("gameweek_points")
    .upsert(rows, { onConflict: "team_id,player_id,gameweek" })

  if (upsertErr) return NextResponse.json({ error: upsertErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, gameweek, rows: rows.length })
}
