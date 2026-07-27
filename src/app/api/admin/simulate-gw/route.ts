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
 * Body: { gameweek: number } | { gameweeks: number[] }
 * Admin only. Generates random points for all rostered players for the given
 * gameweek(s). Deletes+reinserts non-penalty rows per GW — safe to re-run.
 */
export async function POST(request: NextRequest) {
  try {
    await requireRole("admin")
  } catch {
    return NextResponse.json({ error: "Admin only." }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const gameweeks: unknown[] = Array.isArray(body.gameweeks)
    ? body.gameweeks
    : typeof body.gameweek === "number" ? [body.gameweek] : []

  if (
    gameweeks.length === 0 ||
    !gameweeks.every(gw => typeof gw === "number" && gw >= 1 && gw <= 100)
  ) {
    return NextResponse.json({ error: "gameweek(s) must be numbers between 1 and 100." }, { status: 400 })
  }
  const gws = gameweeks as number[]

  const supabase = createClient()

  const { data: rosterRows, error: rosterErr } = await supabase
    .from("roster_entries")
    .select("team_id, player_id, slot_type")
    .in("slot_type", ["starting", "bench"])

  if (rosterErr) return NextResponse.json({ error: rosterErr.message }, { status: 500 })
  if (!rosterRows || rosterRows.length === 0) {
    return NextResponse.json({ error: "No rostered players found. Run a draft first." }, { status: 400 })
  }

  let totalRows = 0
  for (const gameweek of gws) {
    // gameweek_points only has a partial unique index (player_id is not null),
    // which Postgres can't use as an ON CONFLICT inference target — so we
    // delete-then-insert per GW instead of upserting.
    const { error: deleteErr } = await supabase
      .from("gameweek_points")
      .delete()
      .eq("gameweek", gameweek)
      .not("player_id", "is", null)
    if (deleteErr) return NextResponse.json({ error: deleteErr.message }, { status: 500 })

    const rows = rosterRows.map(r => ({
      team_id: r.team_id,
      player_id: r.player_id,
      gameweek,
      points: simulatePoints(),
      was_subbed_in: false,
      slot_type: r.slot_type,
      counted: r.slot_type === "starting",
    }))

    const { error: insertErr } = await supabase.from("gameweek_points").insert(rows)
    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })
    totalRows += rows.length
  }

  return NextResponse.json({ ok: true, gameweeks: gws, rows: totalRows })
}
