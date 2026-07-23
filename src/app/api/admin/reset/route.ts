import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { requireRole } from "@/lib/roles"
import { restoreFromSnapshot } from "@/app/api/auction/[action]/route"

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
 *    Restores league to pre-auction snapshot and returns the auction to
 *    pending state (lots, bids, and log cleared). The auction order is
 *    preserved so the AM can start again without re-configuring.
 *    Available to auction_master and admin.
 *
 * 2. Full wipe — body: {} (no auction_id)
 *    Admin only. Wipes everything from scratch for dev/testing.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const { auction_id } = body

  if (auction_id) {
    return handleTargetedReset(auction_id)
  }
  return handleFullWipe()
}

async function handleTargetedReset(auction_id: string) {
  try {
    await requireRole("auction_master")
  } catch {
    return NextResponse.json({ error: "Auction Master or Admin only." }, { status: 403 })
  }

  const supabase = createClient()

  const result = await restoreFromSnapshot(auction_id, supabase)
  if (!result.restored) {
    return NextResponse.json({ error: "No snapshot found for this auction. Cannot roll back." }, { status: 404 })
  }

  // Clear all lots, bids, and log entries for this auction so the AM can
  // start fresh — but keep the auction record itself in pending state with
  // the configured auction_order intact.
  await Promise.all([
    supabase.from("auction_lots").delete().eq("auction_id", auction_id),
    supabase.from("auction_log").delete().eq("auction_id", auction_id),
  ])

  const { error: auctionErr } = await supabase
    .from("auctions")
    .update({
      status: "pending",
      started_at: null,
      current_position_category: "GK",
      current_bidder_index: 0,
    })
    .eq("id", auction_id)
  if (auctionErr) return NextResponse.json({ error: `auction reset: ${auctionErr.message}` }, { status: 500 })

  return NextResponse.json({ ok: true, mode: "rollback" })
}

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

  // Must delete team_transfer_records before auctions — no ON DELETE CASCADE on that FK
  const { error: transferErr } = await supabase
    .from("team_transfer_records").delete().neq("id", "00000000-0000-0000-0000-000000000000")
  if (transferErr) return NextResponse.json({ error: `team_transfer_records: ${transferErr.message}` }, { status: 500 })
  steps.push("team transfer records deleted")

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
