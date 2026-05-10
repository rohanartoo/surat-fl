import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { requireRole, getProfile } from "@/lib/roles"
import { validateBid, getNextBidder, getNextBidStartIndex, isSoloWin, chooseSlotType } from "@/lib/auction-engine"
import { lockAndCommitDrops } from "@/lib/drops"
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
      case "reset-timer":      return handleResetTimer(request)
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

  const { data: existing } = await supabase
    .from("auctions").select("id").in("status", ["pending", "active"]).maybeSingle()
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

  const { data: auction } = await supabase
    .from("auctions").select("status").eq("id", auction_id).single()
  if (!auction) return err("Auction not found.", 404)
  if (auction.status === "completed") return err("Cannot reorder a completed auction.")

  const { error } = await supabase
    .from("auctions")
    .update({ auction_order: order, current_bidder_index: 0 })
    .eq("id", auction_id)

  if (error) return err(error.message)
  return NextResponse.json({ success: true })
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

  // For non-initial auctions, lock all staged drops before going active
  if (auction.type !== "initial") {
    await lockAndCommitDrops(auction_id, supabase)
  }

  const { error } = await supabase
    .from("auctions")
    .update({ status: "active", started_at: new Date().toISOString() })
    .eq("id", auction_id)

  if (error) return err(error.message)
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
    .from("players").select("id, web_name, position, base_price").eq("id", player_id).single()
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
    // Determine which teams have an open slot for this position
    const { data: teams } = await supabase.from("teams").select("id")
    const allTeamIds = (teams ?? []).map(t => t.id as string)

    const { data: rosterRows } = await supabase
      .from("roster_entries")
      .select("team_id, player:players(position)")
      .in("slot_type", ["starting", "bench"])

    const filledByTeam: Record<string, number> = {}
    for (const row of rosterRows ?? []) {
      const pos = (row.player as unknown as { position: string } | null)?.position
      if (pos === position) {
        filledByTeam[row.team_id] = (filledByTeam[row.team_id] ?? 0) + 1
      }
    }

    const maxSlots = SQUAD_RULES.slots[position as Position]
    const eligibleTeamIds = allTeamIds.filter(id => (filledByTeam[id] ?? 0) < maxSlots)

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

    if (error) return err(error.message)

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

  if (error) return err(error.message)

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
  if (is_interested && lot.timer_started_at) {
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
      if (drop.dropped_post_summer) {
        return err("You cannot re-draft a player you dropped after the post-summer transfer window. This restriction is permanent for this season.")
      }
      if (drop.dropped_post_january) {
        return err("You cannot re-draft a player you dropped after the post-January transfer window. This restriction is permanent for this season.")
      }
      // Dropped before post_jan — blocked until a post_jan or post_summer auction has begun
      const { data: postWindowAuction } = await supabase
        .from("auctions")
        .select("id")
        .in("type", ["post_jan", "post_summer"])
        .in("status", ["active", "completed"])
        .limit(1)
        .maybeSingle()

      if (!postWindowAuction) {
        return err("You cannot re-draft a player you dropped. Re-drafting is only allowed from the post-January transfer window auction onwards.")
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
  if (!lot_id || typeof amount !== "number") return err("lot_id and amount required.")

  const { data: lot } = await supabase
    .from("auction_lots")
    .select("*, player:players(base_price, position)")
    .eq("id", lot_id).single()
  if (!lot) return err("Lot not found.", 404)
  if (lot.phase !== "bidding") return err("Lot is not in bidding phase.")

  // Enforce turn order
  if (lot.current_turn_team_id && lot.current_turn_team_id !== profile.team_id) {
    return err("It is not your turn to bid.")
  }

  const { data: myBid } = await supabase
    .from("bids").select("is_folded, is_interested")
    .eq("lot_id", lot_id).eq("team_id", profile.team_id).maybeSingle()
  if (myBid?.is_folded) return err("Your team has already folded.")
  if (myBid && !myBid.is_interested) return err("Your team passed on this player.")

  const { data: team } = await supabase
    .from("teams").select("budget, display_name").eq("id", profile.team_id).single()
  if (!team) return err("Team not found.", 404)

  const { data: roster } = await supabase
    .from("roster_entries").select("id").eq("team_id", profile.team_id).in("slot_type", ["starting", "bench"])
  const emptySlots = SQUAD_RULES.total - (roster ?? []).length

  const validationError = validateBid(amount, lot.current_bid, lot.player.base_price, team.budget, emptySlots)
  if (validationError) return err(validationError.message)

  // Advance turn to next active bidder after this team
  const { data: auction } = await supabase
    .from("auctions").select("auction_order").eq("id", lot.auction_id).single()
  const auctionOrder = (auction?.auction_order as string[]) ?? []

  const { data: allBids } = await supabase
    .from("bids").select("team_id, is_folded, is_interested").eq("lot_id", lot_id)

  // Active = interested and not folded, excluding the team that just bid (they remain active)
  const activeAfterBid = new Set(
    (allBids ?? [])
      .filter(b => b.is_interested && !b.is_folded && b.team_id !== profile.team_id)
      .map(b => b.team_id)
  )

  const currentIndex = auctionOrder.indexOf(profile.team_id)
  const nextBidder = getNextBidder(auctionOrder, (currentIndex + 1) % auctionOrder.length, activeAfterBid)

  const prevHighBid = lot.current_bid

  await supabase.from("auction_lots").update({
    current_bid: amount,
    current_bidder_id: profile.team_id,
    current_turn_team_id: nextBidder?.teamId ?? null,
  }).eq("id", lot_id)

  await supabase.from("bids").upsert(
    { lot_id, team_id: profile.team_id, amount, is_interested: true, is_folded: false },
    { onConflict: "lot_id,team_id" }
  )

  await supabase.from("auction_log").insert({
    auction_id: lot.auction_id,
    action_type: "bid_placed",
    payload: {
      lot_id,
      team_id: profile.team_id,
      team_name: team.display_name,
      amount,
      prev_high_bid: prevHighBid,
      next_turn_team_id: nextBidder?.teamId ?? null,
    },
  })

  return NextResponse.json({ success: true, new_high: amount, next_turn: nextBidder?.teamId ?? null })
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

  const { data: lot } = await supabase
    .from("auction_lots")
    .select("*, player:players(id, web_name, base_price, position)")
    .eq("id", lot_id).single()
  if (!lot) return err("Lot not found.", 404)
  if (lot.phase !== "bidding") return err("Lot is not in bidding phase.")

  // Enforce turn order
  if (lot.current_turn_team_id && lot.current_turn_team_id !== profile.team_id) {
    return err("It is not your turn.")
  }

  const { error: foldErr } = await supabase
    .from("bids").update({ is_folded: true })
    .eq("lot_id", lot_id).eq("team_id", profile.team_id)
  if (foldErr) return err(foldErr.message)

  const { data: team } = await supabase
    .from("teams").select("display_name").eq("id", profile.team_id).single()

  await supabase.from("auction_log").insert({
    auction_id: lot.auction_id,
    action_type: "team_folded",
    payload: { lot_id, team_id: profile.team_id, team_name: team?.display_name ?? "" },
  })

  // Check remaining active bidders
  const { data: allBids } = await supabase
    .from("bids").select("team_id, is_folded, is_interested").eq("lot_id", lot_id)
  const active = (allBids ?? []).filter(b => b.is_interested && !b.is_folded)

  if (active.length === 0) {
    // Everyone folded — close with no winner
    await supabase.from("auction_lots").update({ phase: "concluded", current_turn_team_id: null }).eq("id", lot_id)
    return NextResponse.json({ concluded: true, reason: "all_folded" })
  }

  if (active.length === 1) {
    // Last bidder standing — clear turn pointer and wait for AM to confirm assignment
    await supabase.from("auction_lots")
      .update({ current_turn_team_id: null })
      .eq("id", lot_id)
    return NextResponse.json({ success: true, active_bidders: 1, pending_winner: active[0].team_id })
  }

  // Advance turn to next active bidder
  const { data: auction } = await supabase
    .from("auctions").select("auction_order").eq("id", lot.auction_id).single()
  const auctionOrder = (auction?.auction_order as string[]) ?? []
  const activeSet = new Set(active.map(b => b.team_id))
  const currentIndex = auctionOrder.indexOf(profile.team_id)
  const nextBidder = getNextBidder(auctionOrder, (currentIndex + 1) % auctionOrder.length, activeSet)

  await supabase.from("auction_lots")
    .update({ current_turn_team_id: nextBidder?.teamId ?? null })
    .eq("id", lot_id)

  return NextResponse.json({ success: true, active_bidders: active.length, next_turn: nextBidder?.teamId ?? null })
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

  const { data: lot } = await supabase
    .from("auction_lots")
    .select("*, player:players(id, web_name, base_price, position)")
    .eq("id", lot_id).single()
  if (!lot) return err("Lot not found.", 404)
  if (lot.phase !== "bidding") return err("Lot is not in bidding phase.")
  if (!lot.current_bidder_id || lot.current_bid === null) {
    return err("No bid placed yet.")
  }

  const { data: auction } = await supabase
    .from("auctions").select("auction_order, current_bidder_index").eq("id", lot.auction_id).single()

  return autoAssign(supabase, lot, auction, lot.current_bidder_id, lot.current_bid)
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

  const { data: lot } = await supabase
    .from("auction_lots")
    .select("*, player:players(base_price)")
    .eq("id", lot_id).single()
  if (!lot) return err("Lot not found.", 404)
  if (lot.phase !== "bidding") return err("Lot is not in bidding phase.")

  if (lot.current_bidder_id !== profile.team_id) {
    return err("You can only undo your own bid while it is still the highest.")
  }
  if (lot.current_turn_team_id === profile.team_id) {
    return err("Cannot undo — the next team has already placed a bid.")
  }

  // Find the previous highest bid among all other teams
  const { data: otherBids } = await supabase
    .from("bids")
    .select("team_id, amount")
    .eq("lot_id", lot_id)
    .neq("team_id", profile.team_id)
    .not("amount", "is", null)
    .order("amount", { ascending: false })
    .limit(1)

  const prevBid = otherBids?.[0] ?? null
  const prevAmount = prevBid?.amount ?? null
  const prevBidderId = prevBid?.team_id ?? null

  const undoneAmount = lot.current_bid

  await supabase.from("auction_lots").update({
    current_bid: prevAmount,
    current_bidder_id: prevBidderId,
    current_turn_team_id: profile.team_id,
  }).eq("id", lot_id)

  await supabase.from("bids").update({ amount: null })
    .eq("lot_id", lot_id).eq("team_id", profile.team_id)

  const { data: team } = await supabase
    .from("teams").select("display_name").eq("id", profile.team_id).single()

  await supabase.from("auction_log").insert({
    auction_id: lot.auction_id,
    action_type: "bid_undone",
    payload: { lot_id, team_id: profile.team_id, team_name: team?.display_name ?? "", undone_amount: undoneAmount },
  })

  return NextResponse.json({ success: true, restored_bid: prevAmount })
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
// SHARED: assign player, deduct budget, advance bid order
// ─────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function autoAssign(supabase: any, lot: any, auction: any, teamId: string, price: number) {
  const { data: team } = await supabase
    .from("teams").select("budget, display_name").eq("id", teamId).single()
  if (!team) return err("Winning team not found.", 404)

  const newBudget = team.budget - price
  if (newBudget < 0) return err("Team cannot afford this player.")

  // Determine correct slot (starting vs bench) based on current roster
  const { data: currentRoster } = await supabase
    .from("roster_entries")
    .select("slot_type, player:players(position)")
    .eq("team_id", teamId)
    .in("slot_type", ["starting", "bench"])

  const rosterForSlot = (currentRoster ?? []).map((r: { slot_type: string; player: { position: string } }) => ({
    slot_type: r.slot_type,
    position: r.player.position as Position,
  }))

  const playerPosition = (lot.player.position ?? lot.player_position) as Position
  const slotType = chooseSlotType(playerPosition, rosterForSlot)

  // If going to bench, find the lowest unused bench_order (1–4)
  let benchOrder: number | null = null
  if (slotType === "bench") {
    // Re-fetch actual bench_order values since rosterForSlot doesn't include them
    const { data: benchRows } = await supabase
      .from("roster_entries")
      .select("bench_order")
      .eq("team_id", teamId)
      .eq("slot_type", "bench")
    const usedBenchOrders = new Set((benchRows ?? []).map((r: { bench_order: number | null }) => r.bench_order))
    benchOrder = [1, 2, 3, 4].find(n => !usedBenchOrders.has(n)) ?? null
  }

  const { error: rosterError } = await supabase.from("roster_entries").insert({
    team_id: teamId,
    player_id: lot.player_id,
    slot_type: slotType,
    bench_order: benchOrder,
    base_price: price,
    is_captain: false,
    is_vice_captain: false,
  })
  if (rosterError) return err(rosterError.message)

  await supabase.from("teams").update({ budget: newBudget }).eq("id", teamId)
  await supabase.from("players").update({ base_price: price }).eq("id", lot.player_id)
  await supabase.from("auction_lots").update({
    phase: "concluded",
    winning_team_id: teamId,
    winning_bid: price,
    current_turn_team_id: null,
  }).eq("id", lot.id)

  await supabase.from("auction_log").insert({
    auction_id: lot.auction_id,
    action_type: "player_assigned",
    payload: {
      lot_id: lot.id,
      player_id: lot.player_id,
      player_name: lot.player.web_name,
      winning_team_id: teamId,
      winning_team_name: team.display_name,
      winning_bid: price,
      prev_budget: team.budget,
      prev_base_price: lot.player.base_price,
    },
  })

  // Advance auction.current_bidder_index to next team with open slots for this position
  if (auction) {
    const auctionOrder = (auction.auction_order as string[]) ?? []
    const position = lot.player.position as Position

    // Fetch current roster fill counts for this position
    const { data: rosterRows } = await supabase
      .from("roster_entries")
      .select("team_id, player:players(position)")
      .in("slot_type", ["starting", "bench"])

    const filledByTeam: Record<string, number> = {}
    for (const row of rosterRows ?? []) {
      const pos = (row.player as unknown as { position: string } | null)?.position
      if (pos === position) {
        filledByTeam[row.team_id] = (filledByTeam[row.team_id] ?? 0) + 1
      }
    }

    const maxSlots = SQUAD_RULES.slots[position as Position]
    const teamsWithOpenSlots = new Set(
      auctionOrder.filter(id => (filledByTeam[id] ?? 0) < maxSlots)
    )

    const currentIndex = auction.current_bidder_index ?? 0
    // Advance from current pointer — winner is irrelevant to rotation
    const nextIndex = getNextBidStartIndex(
      auctionOrder,
      currentIndex,
      teamsWithOpenSlots
    )

    await supabase.from("auctions")
      .update({ current_bidder_index: nextIndex })
      .eq("id", lot.auction_id)
  }

  return NextResponse.json({
    success: true,
    player: lot.player.web_name,
    team: team.display_name,
    price,
    new_budget: newBudget,
  })
}

// ─────────────────────────────────────────────
// SHARED HELPER — restore league state from pre-auction snapshot
// ─────────────────────────────────────────────
export async function restoreFromSnapshot(auction_id: string, supabase: ReturnType<typeof createClient>): Promise<{ restored: true } | { error: string }> {
  const { data: snapshotRow } = await supabase
    .from("auction_snapshots")
    .select("snapshot")
    .eq("auction_id", auction_id)
    .single()

  if (!snapshotRow) return { error: "No snapshot found for this auction." }

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

  // Restore team budgets
  for (const team of snap.teams) {
    await supabase.from("teams").update({ budget: team.budget }).eq("id", team.id)
  }

  // Restore player base prices
  for (const player of snap.players) {
    await supabase.from("players").update({ base_price: player.base_price }).eq("id", player.id)
  }

  // Restore roster entries
  const teamIds = [...new Set(snap.roster_entries.map(r => r.team_id))]
  if (teamIds.length > 0) {
    await supabase.from("roster_entries").delete().in("team_id", teamIds)
  }
  if (snap.roster_entries.length > 0) {
    await supabase.from("roster_entries").insert(snap.roster_entries)
  }

  // Restore staged drops
  await supabase.from("team_drops").delete().eq("auction_id", auction_id)
  if (snap.team_drops.length > 0) {
    const dropsToRestore = snap.team_drops.map(d => ({ ...d, auction_id, status: "staged" }))
    await supabase.from("team_drops").insert(dropsToRestore)
  }

  return { restored: true }
}

// ─────────────────────────────────────────────
// CANCEL — delete a pending or active auction, restoring snapshot if active
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

  // If active, restore from snapshot first
  if (auction.status === "active") {
    const result = await restoreFromSnapshot(auction_id, supabase)
    if ("error" in result) return err(result.error, 404)
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
    .from("auctions").select("status").eq("id", auction_id).single()
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

  // Validate all teams have 15 players
  const { data: teams } = await supabase.from("teams").select("id, display_name")
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
