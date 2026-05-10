import { NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { requireRole } from "@/lib/roles"

/**
 * POST /api/admin/reset
 * Wipes all auction state and returns the league to a clean slate.
 * Admin only. Intended for development/testing.
 *
 * Deletes: auctions (cascades → auction_lots, bids, auction_log,
 *           team_drops, team_transfer_records), roster_entries
 * Resets:  teams.budget → 100, players.base_price → 1
 */
export async function POST() {
  try {
    await requireRole("admin")
  } catch {
    return NextResponse.json({ error: "Admin only." }, { status: 403 })
  }

  // Use service role to bypass RLS for the bulk deletes/updates
  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const steps: string[] = []

  // 1a. Delete team_drops first (FK → auctions, not cascaded)
  const { error: dropsErr } = await supabase
    .from("team_drops")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000")
  if (dropsErr) return NextResponse.json({ error: `team_drops: ${dropsErr.message}` }, { status: 500 })
  steps.push("team drops deleted")

  // 1b. Delete all auctions (cascades to lots, bids, log, transfer records)
  const { error: auctionsErr } = await supabase
    .from("auctions")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000")
  if (auctionsErr) return NextResponse.json({ error: `auctions: ${auctionsErr.message}` }, { status: 500 })
  steps.push("auctions deleted")

  // 2. Delete all roster entries
  const { error: rosterErr } = await supabase
    .from("roster_entries")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000")
  if (rosterErr) return NextResponse.json({ error: `roster_entries: ${rosterErr.message}` }, { status: 500 })
  steps.push("roster entries deleted")

  // 3. Reset team budgets to £100m
  const { error: budgetErr } = await supabase
    .from("teams")
    .update({ budget: 100 })
    .neq("id", "00000000-0000-0000-0000-000000000000")
  if (budgetErr) return NextResponse.json({ error: `teams budget: ${budgetErr.message}` }, { status: 500 })
  steps.push("team budgets reset to £100m")

  // 4. Delete gameweek points (no cascade from auctions)
  const { error: gwErr } = await supabase
    .from("gameweek_points")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000")
  if (gwErr) return NextResponse.json({ error: `gameweek_points: ${gwErr.message}` }, { status: 500 })
  steps.push("gameweek points deleted")

  // 5. Reset player base prices to £1m
  const { error: priceErr } = await supabase
    .from("players")
    .update({ base_price: 1 })
    .neq("id", 0)
  if (priceErr) return NextResponse.json({ error: `players base_price: ${priceErr.message}` }, { status: 500 })
  steps.push("player base prices reset to £1m")

  return NextResponse.json({ ok: true, steps })
}
