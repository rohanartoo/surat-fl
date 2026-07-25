import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { requireRole, assertOwnership } from "@/lib/roles"
import { validateFormation } from "@/lib/auction-engine"
import { getCurrentAuction } from "@/lib/auctions"
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
      case "swap":             return await handleSwap(request)
      case "set-captain":     return await handleSetCaptain(request)
      case "mark-drop":       return await handleMarkDrop(request)
      case "return-from-drop": return await handleReturnFromDrop(request)
      case "update-name":     return await handleUpdateName(request)
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

  // Apply writes atomically — rpc_swap_roster_entry locks both rows and does
  // the slot_type/bench_order updates in one transaction, so a partial
  // failure can never leave one side moved and the other stuck (see
  // 20260725000001_atomic_roster_swap.sql for the bug this replaced).
  if (displaced_entry_id) {
    const displaced = rows.find(r => r.id === displaced_entry_id)
    if (!displaced) return err("Displaced entry not found.")
  }

  const { error: swapErr } = await supabase.rpc("rpc_swap_roster_entry", {
    p_entry_id: entry_id,
    p_target_slot: target_slot,
    p_bench_order: bench_order ?? null,
    p_displaced_entry_id: displaced_entry_id ?? null,
  })
  if (swapErr) return err(swapErr.message)

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

  // Find the current auction (for the team_drops foreign key)
  const auction = await getCurrentAuction<{ id: string; type: string; status: string }>(supabase, "id, type, status")
  if (!auction) return err("No active auction — drops can only be staged during an auction window.")
  // Teams have no squad to drop from during the initial draft.
  if (auction.type === "initial") return err("Players cannot be dropped during the initial auction.")
  // Drops are only staged before the auction starts. Once it's live, staged
  // drops have already been locked in (budget credited, roster freed) and
  // bidding is underway — new drops wait for the next auction.
  if (auction.status !== "pending") return err("Drops can only be staged before the auction starts. Mark players for the next auction instead.")

  // A drop is permanent (never re-draftable by the same team) when it is made
  // in or after the post-January window — i.e. this is the post-January
  // auction, or a post-January auction has already completed. Anything dropped
  // before then is re-draftable from the post-January auction onward.
  const { data: priorPostJan } = await supabase
    .from("auctions").select("id").eq("type", "post_jan").eq("status", "completed").limit(1).maybeSingle()
  const isPermanentDrop = auction.type === "post_jan" || !!priorPostJan

  const dropPrice = calcDropPrice(entry.base_price)

  // Move to dropped slot
  await supabase.from("roster_entries").update({
    slot_type: "dropped",
    bench_order: null,
    is_captain: false,
    is_vice_captain: false,
  }).eq("id", entry_id)

  // Create staged drop record. dropped_post_summer is kept for history only —
  // it no longer affects re-draft eligibility (a post-summer drop is a
  // pre-January drop).
  await supabase.from("team_drops").insert({
    team_id: entry.team_id,
    player_id: entry.player_id,
    auction_id: auction.id,
    drop_price: dropPrice,
    status: "staged",
    dropped_post_january: isPermanentDrop,
    dropped_post_summer: false,
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

  // Find the current auction. Un-staging, like staging, is only possible
  // before the auction starts — once live, any staged drop has already been
  // locked (see rpc_lock_and_credit_drops) and no longer exists to return.
  const auction = await getCurrentAuction<{ id: string; status: string }>(supabase, "id, status")
  if (!auction) return err("No active auction — staged drops can only be returned during an auction window.")
  if (auction.status !== "pending") return err("This drop has already been locked in and can no longer be returned.")

  // Find the staged drop record, scoped to the current auction
  const { data: drop } = await supabase
    .from("team_drops")
    .select("id, status")
    .eq("team_id", entry.team_id)
    .eq("player_id", entry.player_id)
    .eq("status", "staged")
    .eq("auction_id", auction.id)
    .maybeSingle()

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
