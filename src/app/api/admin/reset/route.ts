import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { requireRole } from "@/lib/roles"

function createClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * POST /api/admin/reset
 * Two modes:
 *
 * 1. Targeted rollback — body: { auction_id }
 *    Restores league to the pre-auction snapshot captured when the auction started.
 *    Available to auction_master and admin.
 *    Restores: team budgets, roster_entries, player base_prices, team_drops (staged).
 *    Then deletes the auction (cascades to lots, bids, log, transfer records, snapshot).
 *
 * 2. Full wipe — body: {} (no auction_id)
 *    Admin only. Wipes everything from scratch for dev/testing.
 */
export async function POST(request: NextRequest) {
  const { auction_id } = await request.json().catch(() => ({}))

  if (auction_id) {
    return handleTargetedReset(auction_id)
  }
  return handleFullWipe()
}

// ─────────────────────────────────────────────
// TARGETED ROLLBACK — restore from snapshot
// ─────────────────────────────────────────────
async function handleTargetedReset(auction_id: string) {
  try {
    await requireRole("auction_master")
  } catch {
    return NextResponse.json({ error: "Auction Master or Admin only." }, { status: 403 })
  }

  const supabase = createClient()

  // Load snapshot
  const { data: snapshotRow, error: snapErr } = await supabase
    .from("auction_snapshots")
    .select("snapshot")
    .eq("auction_id", auction_id)
    .single()

  if (snapErr || !snapshotRow) {
    return NextResponse.json({ error: "No snapshot found for this auction. Cannot roll back." }, { status: 404 })
  }

  const snap = snapshotRow.snapshot as {
    teams: { id: string; budget: number }[]
    roster_entries: {
      id: string; team_id: string; player_id: number; slot_type: string
      bench_order: number | null; is_captain: boolean; is_vice_captain: boolean; base_price: number
    }[]
    players: { id: number; base_price: number }[]
    team_drops: {
      id: string; team_id: string; player_id: number; drop_price: number | null
      status: string; dropped_post_january: boolean; dropped_post_summer: boolean
      penalty_gameweek: number | null
    }[]
  }

  const steps: string[] = []

  // 1. Restore team budgets
  for (const team of snap.teams) {
    const { error } = await supabase.from("teams").update({ budget: team.budget }).eq("id", team.id)
    if (error) return NextResponse.json({ error: `budget restore: ${error.message}` }, { status: 500 })
  }
  steps.push("team budgets restored")

  // 2. Restore player base prices
  for (const player of snap.players) {
    await supabase.from("players").update({ base_price: player.base_price }).eq("id", player.id)
  }
  steps.push("player base prices restored")

  // 3. Delete current roster entries for teams in the snapshot, then re-insert
  const teamIds = [...new Set(snap.roster_entries.map(r => r.team_id))]
  if (teamIds.length > 0) {
    const { error: delErr } = await supabase
      .from("roster_entries").delete().in("team_id", teamIds)
    if (delErr) return NextResponse.json({ error: `roster delete: ${delErr.message}` }, { status: 500 })
  }
  if (snap.roster_entries.length > 0) {
    const { error: insErr } = await supabase.from("roster_entries").insert(snap.roster_entries)
    if (insErr) return NextResponse.json({ error: `roster restore: ${insErr.message}` }, { status: 500 })
  }
  steps.push("roster entries restored")

  // 4. Restore staged drops — delete any existing drops for this auction, re-insert from snapshot
  await supabase.from("team_drops").delete().eq("auction_id", auction_id)
  if (snap.team_drops.length > 0) {
    const dropsToRestore = snap.team_drops.map(d => ({ ...d, auction_id, status: "staged" }))
    const { error: dropInsErr } = await supabase.from("team_drops").insert(dropsToRestore)
    if (dropInsErr) return NextResponse.json({ error: `drops restore: ${dropInsErr.message}` }, { status: 500 })
  }
  steps.push("staged drops restored")

  // 5. Delete the auction (cascades to lots, bids, log, transfer records, snapshot)
  const { error: auctionErr } = await supabase.from("auctions").delete().eq("id", auction_id)
  if (auctionErr) return NextResponse.json({ error: `auction delete: ${auctionErr.message}` }, { status: 500 })
  steps.push("auction deleted")

  return NextResponse.json({ ok: true, mode: "rollback", steps })
}

// ─────────────────────────────────────────────
// FULL WIPE — dev/testing only
// ─────────────────────────────────────────────
async function handleFullWipe() {
  try {
    await requireRole("admin")
  } catch {
    return NextResponse.json({ error: "Admin only." }, { status: 403 })
  }

  const supabase = createClient()
  const steps: string[] = []

  const { error: dropsErr } = await supabase
    .from("team_drops").delete().neq("id", "00000000-0000-0000-0000-000000000000")
  if (dropsErr) return NextResponse.json({ error: `team_drops: ${dropsErr.message}` }, { status: 500 })
  steps.push("team drops deleted")

  const { error: auctionsErr } = await supabase
    .from("auctions").delete().neq("id", "00000000-0000-0000-0000-000000000000")
  if (auctionsErr) return NextResponse.json({ error: `auctions: ${auctionsErr.message}` }, { status: 500 })
  steps.push("auctions deleted")

  const { error: rosterErr } = await supabase
    .from("roster_entries").delete().neq("id", "00000000-0000-0000-0000-000000000000")
  if (rosterErr) return NextResponse.json({ error: `roster_entries: ${rosterErr.message}` }, { status: 500 })
  steps.push("roster entries deleted")

  const { error: budgetErr } = await supabase
    .from("teams").update({ budget: 100 }).neq("id", "00000000-0000-0000-0000-000000000000")
  if (budgetErr) return NextResponse.json({ error: `teams budget: ${budgetErr.message}` }, { status: 500 })
  steps.push("team budgets reset to £100m")

  const { error: gwErr } = await supabase
    .from("gameweek_points").delete().neq("id", "00000000-0000-0000-0000-000000000000")
  if (gwErr) return NextResponse.json({ error: `gameweek_points: ${gwErr.message}` }, { status: 500 })
  steps.push("gameweek points deleted")

  const { error: priceErr } = await supabase
    .from("players").update({ base_price: 1 }).neq("id", 0)
  if (priceErr) return NextResponse.json({ error: `players base_price: ${priceErr.message}` }, { status: 500 })
  steps.push("player base prices reset to £1m")

  return NextResponse.json({ ok: true, mode: "full_wipe", steps })
}
