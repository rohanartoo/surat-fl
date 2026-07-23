import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { requireRole, getProfile } from "@/lib/roles"
import { getNextBidder, isSoloWin, POSITION_ORDER } from "@/lib/auction-engine"
import { lockAndCommitDrops, checkReDraftEligibility } from "@/lib/drops"
import { getCurrentAuction } from "@/lib/auctions"
import type { Position } from "@/types"
import { SQUAD_RULES, AUCTION_TIMER_SECONDS } from "@/types"

// All mutations use the service role client to bypass RLS.
// Auth is still enforced via requireRole/getProfile before every write.
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
      case "create":           return handleCreate(request)
      case "start":            return handleStart(request)
      case "set-order":        return handleSetOrder(request)
      case "open-lot":         return handleOpenLot(request)
      case "declare-interest": return handleDeclareInterest(request)
      case "start-bidding":    return handleStartBidding(request)
      case "place-bid":        return handlePlaceBid(request)
      case "fold":             return handleFold(request)
      case "assign-player":    return handleAssignPlayer(request)
      case "undo-bid":         return handleUndoBid(request)
      case "undo-last-assignment": return handleUndoLastAssignment(request)
      case "reset-timer":      return handleResetTimer(request)
      case "return-to-pool":   return handleReturnToPool(request)
      case "advance-position": return handleAdvancePosition(request)
      case "cancel":           return handleCancel(request)
      case "end-draft":        return handleEndDraft(request)
      default:
        return err(`Unknown action: ${action}`, 404)
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error."
    if (message.startsWith("Requires role:")) return err(message, 403)
    console.error(`[auction/${action}]`, e)
    return err("Internal server error.", 500)
  }
}

// ─────────────────────────────────────────────
// CREATE
// Body: { type: "initial" | "mini" | "post_jan" | "post_summer" }
// ─────────────────────────────────────────────
async function handleCreate(request: NextRequest) {
  await requireRole("auction_master")
  const supabase = createClient()
  const { type = "initial" } = await request.json()

  if (!["initial", "mini", "post_jan", "post_summer"].includes(type)) return err("Invalid auction type.")

  const existing = await getCurrentAuction(supabase)
  if (existing) return err("An auction is already open.")

  const freeTransfers = type === "initial" || type === "post_jan" || type === "post_summer" ? 3 : 2

  // Seed auction_order from teams.auction_order field
  const { data: teams } = await supabase
    .from("teams").select("id, auction_order").order("auction_order")

  const auctionOrder = (teams ?? []).map(t => t.id)

  const { data: auction, error } = await supabase
    .from("auctions")
    .insert({
      type,
      status: "pending",
      current_position_category: "GK",
      free_transfers: freeTransfers,
      auction_order: auctionOrder,
      current_bidder_index: 0,
    })
    .select().single()

  if (error) return err(error.message)
  return NextResponse.json({ auction })
}

// ─────────────────────────────────────────────
// SET-ORDER — AM reorders team bid priority before auction starts
// Body: { auction_id: string, order: string[] }  (array of team UUIDs)
// ─────────────────────────────────────────────
async function handleSetOrder(request: NextRequest) {
  await requireRole("auction_master")
  const supabase = createClient()
  const { auction_id, order } = await request.json()

  if (!auction_id || !Array.isArray(order)) return err("auction_id and order[] required.")
  if (order.length === 0) return err("Auction order must contain at least one team.")
  if (!order.every(id => typeof id === "string")) return err("All team IDs must be strings.")
  if (new Set(order).size !== order.length) return err("Duplicate team IDs in order.")

  const { data: auction } = await supabase
    .from("auctions").select("status").eq("id", auction_id).single()
  if (!auction) return err("Auction not found.", 404)
  if (auction.status !== "pending") return err("Auction order can only be set before the auction starts.")

  const { data: validTeams } = await supabase.from("teams").select("id")
  const validIds = new Set((validTeams ?? []).map((t: { id: string }) => t.id))
  if (!order.every(id => validIds.has(id))) return err("One or more team IDs are not valid.")

  const { error } = await supabase
    .from("auctions")
    .update({ auction_order: order, current_bidder_index: 0 })
    .eq("id", auction_id)

  if (error) return err(error.message)

  const omittedCount = (validTeams?.length ?? 0) - order.length
  return NextResponse.json({
    success: true,
    ...(omittedCount > 0 && { warning: `${omittedCount} team(s) not included in this auction order.` }),
  })
}

// ─────────────────────────────────────────────
// START
// Body: { auction_id: string }
// ─────────────────────────────────────────────
async function handleStart(request: NextRequest) {
  await requireRole("auction_master")
  const supabase = createClient()
  const { auction_id } = await request.json()
  if (!auction_id) return err("auction_id required.")

  const { data: auction } = await supabase
    .from("auctions").select("status, type, auction_order").eq("id", auction_id).single()
  if (!auction) return err("Auction not found.", 404)
  if (auction.status !== "pending") return err("Auction is not in pending state.")

  const order = (auction.auction_order as string[]) ?? []
  if (order.length === 0) return err("Auction order has not been set. Set the order before starting.")

  // Capture pre-auction snapshot for rollback support
  const [{ data: teamBudgets }, { data: rosterEntries }, { data: stagedDrops }] = await Promise.all([
    supabase.from("teams").select("id, budget"),
    supabase.from("roster_entries").select("id, team_id, player_id, slot_type, bench_order, is_captain, is_vice_captain, base_price"),
    supabase.from("team_drops").select("id, team_id, player_id, drop_price, status, dropped_post_january, dropped_post_summer, penalty_gameweek").eq("auction_id", auction_id),
  ])

  // Get base prices for all rostered players
  const rosteredPlayerIds = (rosterEntries ?? []).map(r => r.player_id)
  const { data: playerPrices } = rosteredPlayerIds.length > 0
    ? await supabase.from("players").select("id, base_price").in("id", rosteredPlayerIds)
    : { data: [] }

  await supabase.from("auction_snapshots").upsert({
    auction_id,
    snapshot: {
      teams: teamBudgets ?? [],
      roster_entries: rosterEntries ?? [],
      players: playerPrices ?? [],
      team_drops: stagedDrops ?? [],
    },
  }, { onConflict: "auction_id" })

  try {
    // For non-initial auctions, lock all staged drops before going active
    if (auction.type !== "initial") {
      await lockAndCommitDrops(auction_id, supabase)
    }

    const { error } = await supabase
      .from("auctions")
      .update({ status: "active", started_at: new Date().toISOString() })
      .eq("id", auction_id)

    if (error) throw new Error(error.message)
  } catch (e) {
    // Clean up dangling snapshot if activation failed
    await supabase.from("auction_snapshots").delete().eq("auction_id", auction_id)
    throw e
  }

  return NextResponse.json({ success: true })
}

// ─────────────────────────────────────────────
// OPEN-LOT — AM nominates a player
// Body: { auction_id: string, player_id: number }
// Sets bid_start_team_index from auction.current_bidder_index
// ─────────────────────────────────────────────
async function handleOpenLot(request: NextRequest) {
  await requireRole("auction_master")
  const supabase = createClient()
  const { auction_id, player_id } = await request.json()
  if (!auction_id || !player_id) return err("auction_id and player_id required.")

  const { data: auction } = await supabase
    .from("auctions")
    .select("status, type, current_position_category, current_bidder_index, auction_order")
    .eq("id", auction_id).single()

  if (!auction) return err("Auction not found.", 404)
  if (auction.status !== "active") return err("Auction is not active.")

  const { data: openLot } = await supabase
    .from("auction_lots").select("id")
    .eq("auction_id", auction_id).in("phase", ["interest", "bidding"]).maybeSingle()
  if (openLot) return err("A lot is already open.")

  const { data: player } = await supabase
    .from("players").select("id, web_name, position, base_price, fpl_team").eq("id", player_id).single()
  if (!player) return err("Player not found.", 404)
  if (player.position !== auction.current_position_category) {
    return err(`Player is ${player.position} but auction is on ${auction.current_position_category}.`)
  }

  const { data: existingRoster } = await supabase
    .from("roster_entries").select("id").eq("player_id", player_id)
    .neq("slot_type", "dropped").maybeSingle()
  if (existingRoster) return err("Player is already on a team's roster.")

  const auctionOrder = (auction.auction_order as string[]) ?? []
  const bidStartIndex = auction.current_bidder_index ?? 0
  const position = player.position as Position

  const logPayload = {
    lot_id: "", // filled after insert
    player_id: player.id,
    player_name: player.web_name,
    base_price: player.base_price,
    position: player.position,
  }

  // ── Initial auction: skip interest phase, auto-enroll eligible teams ────────
  if (auction.type === "initial") {
    // Determine which teams have an open slot for this position (scoped to auction_order)
    const allTeamIds = auctionOrder

    const { data: rosterRows } = await supabase
      .from("roster_entries")
      .select("team_id, player:players(position, fpl_team)")
      .in("slot_type", ["starting", "bench"])

    const filledByTeam: Record<string, number> = {}
    const clubCountByTeam: Record<string, number> = {}
    for (const row of rosterRows ?? []) {
      const p = (row.player as unknown as { position: string; fpl_team: string } | null)
      if (p?.position === position) {
        filledByTeam[row.team_id] = (filledByTeam[row.team_id] ?? 0) + 1
      }
      if (p?.fpl_team === player.fpl_team) {
        clubCountByTeam[row.team_id] = (clubCountByTeam[row.team_id] ?? 0) + 1
      }
    }

    const maxSlots = SQUAD_RULES.slots[position as Position]

    // Filter out teams banned from re-drafting this player
    const { data: redraftBans } = await supabase
      .from("team_drops")
      .select("team_id, dropped_post_january, dropped_post_summer")
      .eq("player_id", player_id)
      .in("status", ["locked"])

    const { data: postWindowAuction } = await supabase
      .from("auctions")
      .select("id")
      .in("type", ["post_jan", "post_summer"])
      .in("status", ["active", "completed"])
      .limit(1)
      .maybeSingle()

    const bannedTeamIds = new Set(
      (redraftBans ?? [])
        .filter(d => d.dropped_post_summer || d.dropped_post_january || !postWindowAuction)
        .map(d => d.team_id)
    )

    const eligibleTeamIds = allTeamIds.filter(
      id =>
        (filledByTeam[id] ?? 0) < maxSlots &&
        (clubCountByTeam[id] ?? 0) < SQUAD_RULES.max_per_club &&
        !bannedTeamIds.has(id)
    )

    if (eligibleTeamIds.length === 0) {
      return err("No teams have open slots for this position.")
    }

    const { data: lot, error } = await supabase
      .from("auction_lots")
      .insert({
        auction_id,
        player_id,
        phase: "bidding",
        timer_started_at: new Date().toISOString(),
        bid_start_team_index: bidStartIndex,
      })
      .select().single()

    if (error) return err(error.code === "23505" ? "A lot is already open." : error.message)

    // Create bid rows for all eligible teams
    await supabase.from("bids").insert(
      eligibleTeamIds.map(team_id => ({ lot_id: lot.id, team_id, is_interested: true, is_folded: false }))
    )

    // Set first turn
    const eligibleSet = new Set(eligibleTeamIds)
    const firstBidder = getNextBidder(auctionOrder, bidStartIndex, eligibleSet)
    await supabase.from("auction_lots")
      .update({ current_turn_team_id: firstBidder?.teamId ?? null })
      .eq("id", lot.id)

    await supabase.from("auction_log").insert([
      { auction_id, action_type: "lot_opened", payload: { ...logPayload, lot_id: lot.id } },
      {
        auction_id, action_type: "bidding_started", payload: {
          lot_id: lot.id,
          first_bidder_id: firstBidder?.teamId ?? null,
          interested_count: eligibleTeamIds.length,
        },
      },
    ])

    return NextResponse.json({ lot })
  }

  // ── All other auction types: standard interest phase ────────────────────────
  const { data: lot, error } = await supabase
    .from("auction_lots")
    .insert({
      auction_id,
      player_id,
      phase: "interest",
      timer_started_at: new Date().toISOString(),
      bid_start_team_index: bidStartIndex,
    })
    .select().single()

  if (error) return err(error.code === "23505" ? "A lot is already open." : error.message)

  await supabase.from("auction_log").insert({
    auction_id,
    action_type: "lot_opened",
    payload: { ...logPayload, lot_id: lot.id },
  })

  return NextResponse.json({ lot })
}

// ─────────────────────────────────────────────
// DECLARE-INTEREST
// Body: { lot_id: string, is_interested: boolean }
// ─────────────────────────────────────────────
async function handleDeclareInterest(request: NextRequest) {
  await requireRole("team")
  const supabase = createClient()
  const profile = await getProfile()
  if (!profile?.team_id) return err("Not a team account.", 403)

  const { lot_id, is_interested } = await request.json()
  if (!lot_id || typeof is_interested !== "boolean") return err("lot_id and is_interested required.")

  const { data: lot } = await supabase
    .from("auction_lots").select("phase, auction_id, player_id, timer_started_at").eq("id", lot_id).single()
  if (!lot) return err("Lot not found.", 404)
  if (lot.phase !== "interest") return err("Lot is not in interest phase.")

  // Timer enforcement: block new interest declarations once the window has closed
  if (lot.timer_started_at) {
    const elapsed = (Date.now() - new Date(lot.timer_started_at).getTime()) / 1000
    if (elapsed > AUCTION_TIMER_SECONDS) {
      return err("The interest window has closed. The auction master can reset the timer if needed.")
    }
  }

  // Re-draft restriction: check if this team previously dropped this player
  if (is_interested) {
    const { data: drop } = await supabase
      .from("team_drops")
      .select("dropped_post_january, dropped_post_summer")
      .eq("team_id", profile.team_id)
      .eq("player_id", lot.player_id)
      .in("status", ["locked"])
      .maybeSingle()

    if (drop) {
      const { data: postWindowAuction } = await supabase
        .from("auctions")
        .select("id")
        .in("type", ["post_jan", "post_summer"])
        .in("status", ["active", "completed"])
        .limit(1)
        .maybeSingle()

      const eligibilityError = checkReDraftEligibility(drop, !!postWindowAuction)
      if (eligibilityError) {
        return err(eligibilityError)
      }
    }
  }

  // Position cap + club cap (single player fetch covers both)
  if (is_interested) {
    const { data: lotPlayer } = await supabase
      .from("players").select("fpl_team, position").eq("id", lot.player_id).single()

    const { data: myRoster } = await supabase
      .from("roster_entries")
      .select("player:players(fpl_team, position)")
      .eq("team_id", profile.team_id)
      .in("slot_type", ["starting", "bench"])

    // Position cap
    if (lotPlayer?.position) {
      const posCount = (myRoster ?? []).filter(
        (r) => (r.player as unknown as { position: string } | null)?.position === lotPlayer.position
      ).length
      const maxForPos = SQUAD_RULES.slots[lotPlayer.position as Position]
      if (posCount >= maxForPos) {
        return err(`Your ${lotPlayer.position} slots are full (${maxForPos}/${maxForPos}).`)
      }
    }

    // Club cap
    if (lotPlayer?.fpl_team) {
      const clubCount = (myRoster ?? []).filter(
        (r) => (r.player as unknown as { fpl_team: string } | null)?.fpl_team === lotPlayer.fpl_team
      ).length
      if (clubCount >= SQUAD_RULES.max_per_club) {
        return err(`You already have ${SQUAD_RULES.max_per_club} players from ${lotPlayer.fpl_team}. Club cap reached.`)
      }
    }
  }

  const { error } = await supabase.from("bids").upsert(
    { lot_id, team_id: profile.team_id, is_interested, is_folded: false },
    { onConflict: "lot_id,team_id" }
  )
  if (error) return err(error.message)

  const { data: team } = await supabase
    .from("teams").select("display_name").eq("id", profile.team_id).single()

  await supabase.from("auction_log").insert({
    auction_id: lot.auction_id,
    action_type: "interest_declared",
    payload: { lot_id, team_id: profile.team_id, team_name: team?.display_name ?? "", is_interested },
  })

  return NextResponse.json({ success: true })
}

// ─────────────────────────────────────────────
// START-BIDDING — AM closes interest, sets first turn
// Body: { lot_id: string }
// ─────────────────────────────────────────────
async function handleStartBidding(request: NextRequest) {
  await requireRole("auction_master")
  const supabase = createClient()
  const { lot_id } = await request.json()
  if (!lot_id) return err("lot_id required.")

  const { data: lot } = await supabase
    .from("auction_lots")
    .select("*, player:players(id, web_name, base_price, position)")
    .eq("id", lot_id).single()
  if (!lot) return err("Lot not found.", 404)
  if (lot.phase !== "interest") return err("Lot is not in interest phase.")

  const { data: auction } = await supabase
    .from("auctions")
    .select("auction_order, current_bidder_index")
    .eq("id", lot.auction_id).single()
  if (!auction) return err("Auction not found.", 404)

  const { data: bids } = await supabase
    .from("bids").select("team_id, is_interested").eq("lot_id", lot_id)

  const interested = (bids ?? []).filter(b => b.is_interested).map(b => b.team_id)

  if (interested.length === 0) {
    await supabase.from("auction_lots").update({ phase: "concluded" }).eq("id", lot_id)
    await supabase.from("auction_log").insert({
      auction_id: lot.auction_id,
      action_type: "lot_no_interest",
      payload: { lot_id, player_id: lot.player_id },
    })
    return NextResponse.json({ concluded: true, reason: "no_interest" })
  }

  // Single interested team wins at base_price — skip bidding round
  if (isSoloWin(interested)) {
    const player = lot.player as unknown as { base_price: number }
    await supabase.from("auction_lots").update({
      phase: "bidding",
      current_bid: player.base_price,
      current_bidder_id: interested[0],
      current_turn_team_id: null,
    }).eq("id", lot_id)
    return NextResponse.json({ solo_win: true, winner_id: interested[0], winning_bid: player.base_price })
  }

  // Ensure every interested team has a bid row
  const existingIds = new Set((bids ?? []).map(b => b.team_id))
  const missingRows = interested
    .filter(id => !existingIds.has(id))
    .map(id => ({ lot_id, team_id: id, is_interested: true, is_folded: false }))
  if (missingRows.length > 0) await supabase.from("bids").insert(missingRows)

  // Fold non-interested
  const notInterested = (bids ?? []).filter(b => !b.is_interested).map(b => b.team_id)
  if (notInterested.length > 0) {
    await supabase.from("bids").update({ is_folded: true })
      .eq("lot_id", lot_id).in("team_id", notInterested)
  }

  // Determine first bidder: start from bid_start_team_index, find first interested team
  const auctionOrder = (auction.auction_order as string[]) ?? []
  const interestedSet = new Set(interested)
  const firstBidder = getNextBidder(auctionOrder, lot.bid_start_team_index, interestedSet)

  await supabase.from("auction_lots").update({
    phase: "bidding",
    current_turn_team_id: firstBidder?.teamId ?? null,
  }).eq("id", lot_id)

  await supabase.from("auction_log").insert({
    auction_id: lot.auction_id,
    action_type: "bidding_started",
    payload: {
      lot_id,
      first_bidder_id: firstBidder?.teamId ?? null,
      interested_count: interested.length,
    },
  })

  return NextResponse.json({ bidding: true, first_bidder: firstBidder?.teamId ?? null })
}

// ─────────────────────────────────────────────
// PLACE-BID — team places a bid (must be their turn)
// Body: { lot_id: string, amount: number }
// ─────────────────────────────────────────────
async function handlePlaceBid(request: NextRequest) {
  await requireRole("team")
  const supabase = createClient()
  const profile = await getProfile()
  if (!profile?.team_id) return err("Not a team account.", 403)

  const { lot_id, amount } = await request.json()
  if (!lot_id || typeof amount !== "number" || !Number.isFinite(amount)) return err("lot_id and amount required.")

  const { data, error } = await supabase
    .rpc("rpc_place_bid", { p_lot_id: lot_id, p_team_id: profile.team_id, p_amount: amount })
    .single<{ new_high: number; next_turn_team_id: string | null }>()
  if (error) return err(error.message)

  return NextResponse.json({ success: true, new_high: data.new_high, next_turn: data.next_turn_team_id })
}

// ─────────────────────────────────────────────
// FOLD — team passes their turn (must be their turn)
// Body: { lot_id: string }
// Auto-assigns if last bidder remaining.
// ─────────────────────────────────────────────
async function handleFold(request: NextRequest) {
  await requireRole("team")
  const supabase = createClient()
  const profile = await getProfile()
  if (!profile?.team_id) return err("Not a team account.", 403)

  const { lot_id } = await request.json()
  if (!lot_id) return err("lot_id required.")

  const { data, error } = await supabase
    .rpc("rpc_fold_bid", { p_lot_id: lot_id, p_team_id: profile.team_id })
    .single<{
      concluded: boolean; reason: string | null; active_bidders: number
      next_turn_team_id: string | null; pending_winner: string | null
    }>()
  if (error) return err(error.message)

  if (data.concluded) return NextResponse.json({ concluded: true, reason: data.reason })
  if (data.pending_winner) return NextResponse.json({ success: true, active_bidders: 1, pending_winner: data.pending_winner })
  return NextResponse.json({ success: true, active_bidders: data.active_bidders, next_turn: data.next_turn_team_id })
}

// ─────────────────────────────────────────────
// ASSIGN-PLAYER — AM manually concludes lot
// Body: { lot_id: string }
// ─────────────────────────────────────────────
async function handleAssignPlayer(request: NextRequest) {
  await requireRole("auction_master")
  const supabase = createClient()
  const { lot_id } = await request.json()
  if (!lot_id) return err("lot_id required.")

  const { data, error } = await supabase
    .rpc("rpc_assign_player", { p_lot_id: lot_id })
    .single<{ slot_type: string; new_budget: number; player_name: string; team_name: string; price: number }>()
  if (error) return err(error.message)

  return NextResponse.json({
    success: true,
    player: data.player_name,
    team: data.team_name,
    price: data.price,
    new_budget: data.new_budget,
  })
}

// ─────────────────────────────────────────────
// UNDO-BID — team reverts their last bid (only while still highest bidder)
// Body: { lot_id: string }
// ─────────────────────────────────────────────
async function handleUndoBid(request: NextRequest) {
  await requireRole("team")
  const supabase = createClient()
  const profile = await getProfile()
  if (!profile?.team_id) return err("Not a team account.", 403)

  const { lot_id } = await request.json()
  if (!lot_id) return err("lot_id required.")

  const { data, error } = await supabase
    .rpc("rpc_undo_bid", { p_lot_id: lot_id, p_team_id: profile.team_id })
    .single<{ restored_bid: number | null }>()
  if (error) return err(error.message)

  return NextResponse.json({ success: true, restored_bid: data.restored_bid })
}

// ─────────────────────────────────────────────
// RESET-TIMER — AM restarts the 45s interest window
// Body: { lot_id: string }
// ─────────────────────────────────────────────
async function handleResetTimer(request: NextRequest) {
  await requireRole("auction_master")
  const supabase = createClient()
  const { lot_id } = await request.json()
  if (!lot_id) return err("lot_id required.")

  const { data: lot } = await supabase
    .from("auction_lots").select("phase").eq("id", lot_id).single()
  if (!lot) return err("Lot not found.", 404)
  if (lot.phase !== "interest") return err("Timer can only be reset during the interest phase.")

  await supabase.from("auction_lots")
    .update({ timer_started_at: new Date().toISOString() })
    .eq("id", lot_id)

  return NextResponse.json({ success: true })
}

// ─────────────────────────────────────────────
// UNDO-LAST-ASSIGNMENT — AM reverses the most recently concluded lot
// Body: { auction_id: string }
// ─────────────────────────────────────────────
async function handleUndoLastAssignment(request: NextRequest) {
  await requireRole("auction_master")
  const supabase = createClient()
  const { auction_id } = await request.json()
  if (!auction_id) return err("auction_id required.")

  const { data, error } = await supabase
    .rpc("rpc_undo_last_assignment", { p_auction_id: auction_id })
    .single<{ player_name: string; team_name: string }>()
  if (error) return err(error.message)

  return NextResponse.json({ success: true, player: data.player_name, team: data.team_name })
}

// ─────────────────────────────────────────────
// SHARED HELPER — restore league state from pre-auction snapshot
// ─────────────────────────────────────────────
export async function restoreFromSnapshot(auction_id: string, supabase: ReturnType<typeof createClient>): Promise<{ restored: boolean }> {
  const { data, error } = await supabase
    .rpc("rpc_restore_snapshot", { p_auction_id: auction_id })
    .single<{ restored: boolean }>()
  if (error) throw new Error(error.message)

  return { restored: data.restored }
}

// ─────────────────────────────────────────────
// RETURN-TO-POOL — AM closes an open lot with no winner
// Works for both interest and bidding phases (covers initial auction lots)
// Body: { lot_id: string }
// ─────────────────────────────────────────────
async function handleReturnToPool(request: NextRequest) {
  await requireRole("auction_master")
  const supabase = createClient()
  const { lot_id } = await request.json()
  if (!lot_id) return err("lot_id required.")

  const { data: lot } = await supabase
    .from("auction_lots")
    .select("phase, auction_id, player_id")
    .eq("id", lot_id).single()
  if (!lot) return err("Lot not found.", 404)
  if (!["interest", "bidding"].includes(lot.phase)) {
    return err("Lot is not open.")
  }

  const { error: lotErr } = await supabase
    .from("auction_lots")
    .update({ phase: "concluded", current_turn_team_id: null })
    .eq("id", lot_id)
  if (lotErr) return err(lotErr.message)

  await supabase.from("auction_log").insert({
    auction_id: lot.auction_id,
    action_type: "lot_returned_to_pool",
    payload: { lot_id, player_id: lot.player_id },
  })

  return NextResponse.json({ success: true })
}

// ─────────────────────────────────────────────
// ADVANCE-POSITION — AM moves to the next position category
// Body: { auction_id: string }
// ─────────────────────────────────────────────
async function handleAdvancePosition(request: NextRequest) {
  await requireRole("auction_master")
  const supabase = createClient()
  const { auction_id } = await request.json()
  if (!auction_id) return err("auction_id required.")

  const { data: auction } = await supabase
    .from("auctions")
    .select("status, current_position_category, auction_order")
    .eq("id", auction_id).single()
  if (!auction) return err("Auction not found.", 404)
  if (auction.status !== "active") return err("Auction is not active.")

  const { data: openLot } = await supabase
    .from("auction_lots").select("id")
    .eq("auction_id", auction_id)
    .in("phase", ["interest", "bidding"])
    .maybeSingle()
  if (openLot) return err("Close the current lot before advancing position.")

  const currentPos = auction.current_position_category as Position
  const nextPos = POSITION_ORDER[POSITION_ORDER.indexOf(currentPos) + 1] ?? null
  if (!nextPos) return err("Already at the final position (FWD). End the draft when ready.")

  const { error } = await supabase
    .from("auctions")
    .update({ current_position_category: nextPos, current_bidder_index: 0 })
    .eq("id", auction_id)
  if (error) return err(error.message)

  await supabase.from("auction_log").insert({
    auction_id,
    action_type: "position_advanced",
    payload: { from: currentPos, to: nextPos },
  })

  return NextResponse.json({ success: true, next_position: nextPos })
}

// ─────────────────────────────────────────────
// CANCEL — delete a pending or active auction, restoring snapshot if active.
// Dropped players are fully returned to their teams' benches with no drop marker.
// Body: { auction_id: string }
// ─────────────────────────────────────────────
async function handleCancel(request: NextRequest) {
  await requireRole("auction_master")
  const supabase = createClient()
  const { auction_id } = await request.json()
  if (!auction_id) return err("auction_id required.")

  const { data: auction } = await supabase
    .from("auctions").select("status").eq("id", auction_id).single()
  if (!auction) return err("Auction not found.", 404)
  if (!["pending", "active"].includes(auction.status)) return err("Only pending or active auctions can be cancelled.")

  // Capture drop records before any restoration so we know which players to un-drop.
  // For a pending auction these are "staged"; for an active auction they are "locked".
  const { data: dropRecords } = await supabase
    .from("team_drops")
    .select("player_id")
    .eq("auction_id", auction_id)

  // If active, restore budgets, player prices, and rosters from the pre-auction snapshot.
  // Note: restoreFromSnapshot also re-inserts the team_drops as "staged" — we clean those
  // up explicitly below since there is no ON DELETE CASCADE from auctions → team_drops.
  if (auction.status === "active") {
    await restoreFromSnapshot(auction_id, supabase)
  }

  // Remove all drop records for this auction. After a cancel the teams start fresh —
  // no staged or orphaned drops should remain pointing at a deleted auction.
  await supabase.from("team_drops").delete().eq("auction_id", auction_id)

  // Move each dropped player's roster entry back to bench so they appear on the
  // team's squad without any drop marker. bench_order is set to null; teams can
  // rearrange their bench manually after the cancel if needed.
  if (dropRecords && dropRecords.length > 0) {
    const playerIds = dropRecords.map(d => d.player_id)
    await supabase
      .from("roster_entries")
      .update({ slot_type: "bench", bench_order: null })
      .in("player_id", playerIds)
      .eq("slot_type", "dropped")
  }

  // Delete the auction (cascades to lots, bids, log, transfer records, snapshot)
  const { error: deleteErr } = await supabase.from("auctions").delete().eq("id", auction_id)
  if (deleteErr) return err(deleteErr.message)

  return NextResponse.json({ success: true })
}

// ─────────────────────────────────────────────
// END-DRAFT — mark auction as completed once all teams have full squads
// Body: { auction_id: string }
// ─────────────────────────────────────────────
async function handleEndDraft(request: NextRequest) {
  await requireRole("auction_master")
  const supabase = createClient()
  const { auction_id } = await request.json()
  if (!auction_id) return err("auction_id required.")

  const { data: auction } = await supabase
    .from("auctions").select("status, auction_order").eq("id", auction_id).single()
  if (!auction) return err("Auction not found.", 404)
  if (auction.status !== "active") return err("Auction is not active.")

  // Check no lot is currently open
  const { data: openLot } = await supabase
    .from("auction_lots")
    .select("id")
    .eq("auction_id", auction_id)
    .in("phase", ["interest", "bidding"])
    .maybeSingle()
  if (openLot) return err("A lot is currently open. Close it before ending the draft.")

  // Validate all participating teams (in auction_order) have 15 players
  const participatingTeamIds = (auction.auction_order as string[]) ?? []
  const { data: teams } = await supabase.from("teams").select("id, display_name").in("id", participatingTeamIds)
  const { data: roster } = await supabase
    .from("roster_entries")
    .select("team_id")
    .in("slot_type", ["starting", "bench"])

  const countByTeam: Record<string, number> = {}
  for (const row of roster ?? []) {
    countByTeam[row.team_id] = (countByTeam[row.team_id] ?? 0) + 1
  }

  const incomplete = (teams ?? []).filter(t => (countByTeam[t.id] ?? 0) < SQUAD_RULES.total)
  if (incomplete.length > 0) {
    return err(`${incomplete.length} team(s) still need players: ${incomplete.map(t => t.display_name).join(", ")}`)
  }

  const { error } = await supabase
    .from("auctions")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", auction_id)

  if (error) return err(error.message)
  return NextResponse.json({ success: true })
}
