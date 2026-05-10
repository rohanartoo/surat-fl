import { BID_RULES, SQUAD_RULES, type Position } from "@/types"
import { calcMinIncrement } from "@/lib/utils"

// =============================================
// BID VALIDATION
// =============================================

export interface BidValidationError {
  code: "BELOW_MIN" | "BAD_INCREMENT" | "EXCEEDS_MAX" | "NOT_INTEGER"
  message: string
}

/**
 * Validates a proposed bid amount.
 * Returns null if valid, or an error object describing the problem.
 *
 * @param amount       - The proposed bid in £m (must be a whole number)
 * @param currentBid   - The current highest bid (null = first bid on this player)
 * @param basePrice    - The player's base_price (floor for first bid)
 * @param budget       - The bidding team's remaining budget in £m
 * @param emptySlots   - How many unfilled squad slots the team still has
 *                       (including the current player being bid on)
 */
export function validateBid(
  amount: number,
  currentBid: number | null,
  basePrice: number,
  budget: number,
  emptySlots: number
): BidValidationError | null {
  if (!Number.isInteger(amount)) {
    return { code: "NOT_INTEGER", message: "Bid must be a whole number." }
  }

  // First bid must be at least base_price
  if (currentBid === null) {
    if (amount < basePrice) {
      return {
        code: "BELOW_MIN",
        message: `Opening bid must be at least £${basePrice}m.`,
      }
    }
    // No increment rule on the opening bid — just floor check
  } else {
    const minNext = currentBid + calcMinIncrement(currentBid)
    if (amount < minNext) {
      return {
        code: "BAD_INCREMENT",
        message: `Bid must be at least £${minNext}m (minimum +£${calcMinIncrement(currentBid)}m).`,
      }
    }
  }

  // Team must be able to fill all remaining empty slots at £1m each
  // (emptySlots includes the current player, so they need budget - (emptySlots - 1) left)
  const maxAllowed = budget - (emptySlots - 1)
  if (amount > maxAllowed) {
    return {
      code: "EXCEEDS_MAX",
      message: `Maximum bid is £${maxAllowed}m (need £1m for each remaining slot).`,
    }
  }

  return null
}

// =============================================
// POSITION ELIGIBILITY
// =============================================

/**
 * If exactly 1 team is interested after the interest phase, they win at
 * the player's base_price automatically — no bidding round needed.
 */
export function isSoloWin(interestedTeamIds: string[]): boolean {
  return interestedTeamIds.length === 1
}

// =============================================
// BID INCREMENT DISPLAY HELPERS
// =============================================

/** The minimum a team can bid next, given the current highest bid. */
export function getMinNextBid(currentBid: number | null, basePrice: number): number {
  if (currentBid === null) return basePrice
  return currentBid + calcMinIncrement(currentBid)
}

/** The maximum a team can bid, given their budget and unfilled slots. */
export function getMaxBid(budget: number, emptySlots: number): number {
  return Math.max(0, budget - (emptySlots - 1))
}

// =============================================
// AUCTION LOG PAYLOADS
// =============================================

export interface LogPayload_PlayerAssigned {
  lot_id: string
  player_id: number
  player_name: string
  winning_team_id: string
  winning_team_name: string
  winning_bid: number
  prev_budget: number
  prev_base_price: number
}

export interface LogPayload_BidPlaced {
  lot_id: string
  team_id: string
  team_name: string
  amount: number
  prev_high_bid: number | null
}

export interface LogPayload_LotOpened {
  lot_id: string
  player_id: number
  player_name: string
  base_price: number
  position: Position
}

export interface LogPayload_InterestDeclared {
  lot_id: string
  team_id: string
  team_name: string
  is_interested: boolean
}

export type AuctionLogPayload =
  | ({ action: "player_assigned" } & LogPayload_PlayerAssigned)
  | ({ action: "bid_placed" } & LogPayload_BidPlaced)
  | ({ action: "lot_opened" } & LogPayload_LotOpened)
  | ({ action: "interest_declared" } & LogPayload_InterestDeclared)

// =============================================
// BID ORDER — rotating turn pointer
// =============================================

/**
 * Given the full auction_order array and a starting index, finds the next
 * team ID that appears in eligibleTeamIds (i.e. is interested and not folded).
 *
 * Wraps around the order once. Returns null if no eligible team found.
 *
 * @param auctionOrder   - Full ordered array of team IDs for this auction
 * @param startIndex     - Index to start searching from (inclusive)
 * @param eligibleIds    - Set of team IDs still active in this bidding round
 */
export function getNextBidder(
  auctionOrder: string[],
  startIndex: number,
  eligibleIds: Set<string>
): { teamId: string; index: number } | null {
  const n = auctionOrder.length
  for (let i = 0; i < n; i++) {
    const idx = (startIndex + i) % n
    const teamId = auctionOrder[idx]
    if (eligibleIds.has(teamId)) {
      return { teamId, index: idx }
    }
  }
  return null
}

/**
 * After a player is assigned, advances the auction's current_bidder_index
 * to the next team in auction_order that still has open slots for the position.
 *
 * @param auctionOrder       - Full ordered array of team IDs
 * @param currentIndex       - The current auction pointer index (auction.current_bidder_index)
 * @param teamsWithOpenSlots - Set of team IDs that still need players at this position
 */
export function getNextBidStartIndex(
  auctionOrder: string[],
  currentIndex: number,
  teamsWithOpenSlots: Set<string>
): number {
  const n = auctionOrder.length
  // Start from the team AFTER the current one
  for (let i = 1; i <= n; i++) {
    const idx = (currentIndex + i) % n
    if (teamsWithOpenSlots.has(auctionOrder[idx])) {
      return idx
    }
  }
  // All teams are full for this position — return current (position is complete)
  return currentIndex
}

// =============================================
// POSITION CATEGORY PROGRESSION
// =============================================

export const POSITION_ORDER: Position[] = ["GK", "DEF", "MID", "FWD"]

// =============================================
// DRAFT SLOT ASSIGNMENT
// =============================================

/**
 * Determines whether a newly drafted player should go to the starting XI or
 * the bench, based on current roster state.
 *
 * Rules (in order):
 * 1. If starting XI already has 11 players → bench
 * 2. If position is already at max starters (e.g. 2nd GK) → bench
 * 3. Otherwise → starting
 */
export function chooseSlotType(
  position: Position,
  currentRoster: { slot_type: string; position: Position }[],
): "starting" | "bench" {
  const starters = currentRoster.filter(e => e.slot_type === "starting")
  if (starters.length >= SQUAD_RULES.starting) return "bench"
  const startersAtPos = starters.filter(e => e.position === position).length
  if (startersAtPos >= SQUAD_RULES.max_starting[position]) return "bench"
  return "starting"
}

// =============================================
// FORMATION VALIDATION
// =============================================

/**
 * Validates that a proposed Starting XI satisfies the minimum positional requirements.
 * Returns null if valid, or an error string describing what's wrong.
 */
export function validateFormation(starting: { position: Position }[]): string | null {
  if (starting.length !== SQUAD_RULES.starting) {
    return `Starting XI must have exactly ${SQUAD_RULES.starting} players`
  }
  for (const pos of ["GK", "DEF", "MID", "FWD"] as Position[]) {
    const count = starting.filter(p => p.position === pos).length
    const min = SQUAD_RULES.min_starting[pos]
    if (count < min) {
      return `Starting XI needs at least ${min} ${pos}${min > 1 ? "s" : ""} (currently ${count})`
    }
  }
  return null
}
