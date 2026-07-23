import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { requireRole, assertOwnership } from "@/lib/roles"
import { validateFormation } from "@/lib/auction-engine"
import { calcDropPrice } from "@/lib/utils"
import { SQUAD_RULES } from "@/types"
import type { Position } from "@/types"

function createClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

type Params = { params: Promise<{ action: string }> }

function err(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(request: NextRequest, { params }: Params) {
  const { action } = await params
  try {
    switch (action) {
      case "swap":             return handleSwap(request)
      case "set-captain":     return handleSetCaptain(request)
      case "mark-drop":       return handleMarkDrop(request)
      case "return-from-drop": return handleReturnFromDrop(request)
      case "update-name":     return handleUpdateName(request)
      default:
        return err(`Unknown action: ${action}`, 404)
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error."
    if (message.startsWith("Requires role:")) return err(message, 403)
    console.error(`[team/${action}]`, e)
    return err("Internal server error.", 500)
  }
}

// ─────────────────────────────────────────────
// SWAP — move player between starting ↔ bench (with optional displaced partner)
// Body: { entry_id: string, target_slot: "starting"|"bench", bench_order?: number, displaced_entry_id?: string }
// When displaced_entry_id is provided, the two players swap slots.
// ─────────────────────────────────────────────
async function handleSwap(request: NextRequest) {
  await requireRole("team")
  const supabase = createClient()
  const { entry_id, target_slot, bench_order, displaced_entry_id } = await request.json()

  if (!entry_id || !target_slot) return err("entry_id and target_slot required.")
  if (!["starting", "bench"].includes(target_slot)) return err("target_slot must be 'starting' or 'bench'.")

  const { data: entry } = await supabase
    .from("roster_entries")
    .select("id, slot_type, bench_order, team_id, player_id")
    .eq("id", entry_id).single()
  if (!entry) return err("Roster entry not found.", 404)

  await assertOwnership(entry.team_id)

  // Fetch all active entries with player positions for formation validation
  const { data: allEntries } = await supabase
    .from("roster_entries")
    .select("id, slot_type, bench_order, player:players(position)")
    .eq("team_id", entry.team_id)
    .in("slot_type", ["starting", "bench"])

  const rows = allEntries ?? []

  // Build a map of id → position for type-safe lookups
  const posById: Record<string, Position> = {}
  for (const r of rows) {
    posById[r.id] = (r.player as unknown as { position: Position }).position
  }

  // Simulate what starting XI would look like after the swap
  const startingIds = new Set(rows.filter(r => r.slot_type === "starting").map(r => r.id))
  if (target_slot === "starting") {
    startingIds.add(entry_id)
    if (displaced_entry_id) startingIds.delete(displaced_entry_id)
  } else {
    startingIds.delete(entry_id)
    if (displaced_entry_id) startingIds.add(displaced_entry_id)
  }

  // Only enforce formation when squad is complete
  if (rows.length === SQUAD_RULES.total) {
    const simStarting = [...startingIds].map(id => ({ position: posById[id] })).filter(p => p.position)
    const formationError = validateFormation(simStarting)
    if (formationError) return err(formationError)
  }

  // Apply writes
  if (displaced_entry_id) {
    const displaced = rows.find(r => r.id === displaced_entry_id)
    if (!displaced) return err("Displaced entry not found.")

    // Swap slot types and bench_order between the two entries
    const entryNewBenchOrder = target_slot === "bench" ? (bench_order ?? displaced.bench_order ?? null) : null
    const displacedNewSlot = entry.slot_type as "starting" | "bench"
    const displacedNewBenchOrder = displacedNewSlot === "bench" ? (entry.bench_order ?? null) : null

    await supabase.from("roster_entries")
      .update({ slot_type: target_slot, bench_order: entryNewBenchOrder })
      .eq("id", entry_id)
    await supabase.from("roster_entries")
      .update({ slot_type: displacedNewSlot, bench_order: displacedNewBenchOrder })
      .eq("id", displaced_entry_id)
  } else {
    await supabase.from("roster_entries").update({
      slot_type: target_slot,
      bench_order: target_slot === "bench" ? (bench_order ?? null) : null,
    }).eq("id", entry_id)
  }

  return NextResponse.json({ success: true })
}

// ─────────────────────────────────────────────
// SET-CAPTAIN
// Body: { entry_id: string, role: "captain" | "vice_captain" }
// ─────────────────────────────────────────────
async function handleSetCaptain(request: NextRequest) {
  await requireRole("team")
  const supabase = createClient()
  const { entry_id, role } = await request.json()

  if (!entry_id || !role) return err("entry_id and role required.")
  if (!["captain", "vice_captain"].includes(role)) return err("role must be 'captain' or 'vice_captain'.")

  const { data: entry } = await supabase
    .from("roster_entries").select("team_id, slot_type").eq("id", entry_id).single()
  if (!entry) return err("Roster entry not found.", 404)
  if (entry.slot_type !== "starting") return err("Captain must be in the Starting XI.")

  await assertOwnership(entry.team_id)

  const field = role === "captain" ? "is_captain" : "is_vice_captain"

  // Clear existing flag on all entries for this team
  await supabase.from("roster_entries")
    .update({ [field]: false })
    .eq("team_id", entry.team_id)

  // Set on target
  await supabase.from("roster_entries")
    .update({ [field]: true })
    .eq("id", entry_id)

  return NextResponse.json({ success: true })
}

// ─────────────────────────────────────────────
// MARK-DROP — stage a player for dropping
// Body: { entry_id: string }
// ─────────────────────────────────────────────
async function handleMarkDrop(request: NextRequest) {
  await requireRole("team")
  const supabase = createClient()
  const { entry_id } = await request.json()
  if (!entry_id) return err("entry_id required.")

  const { data: entry } = await supabase
    .from("roster_entries")
    .select("*, player:players(position, base_price)")
    .eq("id", entry_id).single()
  if (!entry) return err("Roster entry not found.", 404)
  if (entry.slot_type === "dropped") return err("Player is already staged for drop.")

  await assertOwnership(entry.team_id)

  // Find the current active auction (for the team_drops foreign key)
  const { data: auction } = await supabase
    .from("auctions").select("id, type").in("status", ["pending", "active"]).maybeSingle()
  if (!auction) return err("No active auction — drops can only be staged during an auction window.")

  const dropPrice = calcDropPrice(entry.base_price)

  // Move to dropped slot
  await supabase.from("roster_entries").update({
    slot_type: "dropped",
    bench_order: null,
    is_captain: false,
    is_vice_captain: false,
  }).eq("id", entry_id)

  // Create staged drop record
  await supabase.from("team_drops").insert({
    team_id: entry.team_id,
    player_id: entry.player_id,
    auction_id: auction.id,
    drop_price: dropPrice,
    status: "staged",
    dropped_post_january: auction.type === "post_jan",
    dropped_post_summer: auction.type === "post_summer",
  })

  return NextResponse.json({ success: true, drop_price: dropPrice })
}

// ─────────────────────────────────────────────
// RETURN-FROM-DROP — cancel a staged drop
// Body: { entry_id: string }
// ─────────────────────────────────────────────
async function handleReturnFromDrop(request: NextRequest) {
  await requireRole("team")
  const supabase = createClient()
  const { entry_id } = await request.json()
  if (!entry_id) return err("entry_id required.")

  const { data: entry } = await supabase
    .from("roster_entries").select("team_id, player_id, slot_type").eq("id", entry_id).single()
  if (!entry) return err("Roster entry not found.", 404)
  if (entry.slot_type !== "dropped") return err("Player is not staged for drop.")

  await assertOwnership(entry.team_id)

  // Find current pending/active auction
  const { data: auction } = await supabase
    .from("auctions").select("id").in("status", ["pending", "active"]).maybeSingle()

  // Find the staged drop record
  let dropQuery = supabase
    .from("team_drops")
    .select("id, status")
    .eq("team_id", entry.team_id)
    .eq("player_id", entry.player_id)
    .eq("status", "staged")

  if (auction) {
    dropQuery = dropQuery.eq("auction_id", auction.id)
  }

  const { data: drop } = await dropQuery.maybeSingle()

  if (!drop) return err("No staged drop found for this player.")

  // Find next available bench slot (1–4)
  const { data: benchEntries } = await supabase
    .from("roster_entries")
    .select("bench_order")
    .eq("team_id", entry.team_id)
    .eq("slot_type", "bench")

  const usedOrders = new Set((benchEntries ?? []).map(e => e.bench_order))
  const nextOrder = [1, 2, 3, 4].find(n => !usedOrders.has(n)) ?? null

  // Restore to bench
  await supabase.from("roster_entries").update({
    slot_type: "bench",
    bench_order: nextOrder,
  }).eq("id", entry_id)

  // Delete the staged drop
  await supabase.from("team_drops").delete().eq("id", drop.id)

  return NextResponse.json({ success: true })
}

// ─────────────────────────────────────────────
// UPDATE-NAME — change a team's display_name
// Body: { team_id: string, display_name: string }
// Team accounts can only update their own; admin can update any.
// ─────────────────────────────────────────────
async function handleUpdateName(request: NextRequest) {
  await requireRole("team")
  const supabase = createClient()
  const { team_id, display_name } = await request.json()

  if (!team_id || !display_name?.trim()) return err("team_id and display_name required.")
  if (display_name.trim().length < 2) return err("Display name must be at least 2 characters.")

  await assertOwnership(team_id)

  const { error } = await supabase
    .from("teams")
    .update({ display_name: display_name.trim() })
    .eq("id", team_id)

  if (error) return err(error.message)
  return NextResponse.json({ success: true })
}
