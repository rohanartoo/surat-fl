export type Position = "GK" | "DEF" | "MID" | "FWD"
export type Role = "admin" | "auction_master" | "team" | "guest"
export type SlotType = "starting" | "bench" | "dropped"
export type AuctionType = "initial" | "mini" | "post_jan" | "post_summer"
export type AuctionStatus = "pending" | "active" | "completed"
export type LotPhase = "pending" | "interest" | "bidding" | "concluded"
export type DropStatus = "staged" | "locked" | "cancelled"

// =============================================
// CONSTANTS
// =============================================

export const SQUAD_RULES = {
  total: 15,
  starting: 11,
  bench: 4,
  slots: { GK: 2, DEF: 5, MID: 5, FWD: 3 } as Record<Position, number>,
  /** Minimum players per position in the starting XI */
  min_starting: { GK: 1, DEF: 3, MID: 3, FWD: 1 } as Record<Position, number>,
  /** Maximum players per position in the starting XI (GK capped at 1; others capped by squad size) */
  max_starting: { GK: 1, DEF: 5, MID: 5, FWD: 3 } as Record<Position, number>,
  /** Minimum base price for any player */
  min_bid: 1,
  /** Maximum players from the same FPL club per team */
  max_per_club: 3,
} as const

export const BID_RULES = {
  /** Current bid must exceed this threshold to use the higher increment */
  increment_threshold: 20, // £20m
  /** Minimum raise when current bid is below threshold */
  increment_below: 1,      // +£1m
  /** Minimum raise when current bid is at or above threshold */
  increment_above: 2,      // +£2m
} as const

export const DROP_RULES = {
  /** First in-season auction */
  free_drops_first_inseason: 3,
  /** Post-January transfer window auction */
  free_drops_post_jan: 3,
  /** Post-summer transfer window auction */
  free_drops_post_summer: 3,
  /** All other mini-auctions */
  free_drops_standard: 2,
  /** Max unused free transfers that roll over */
  max_carry_over: 1,
  /** Points deducted per drop above free quota (applied end of GW) */
  penalty_per_extra_drop: -4,
  /** Multiplier for dropped player's new base price */
  drop_price_factor: 0.5, // ceil(purchase_price * 0.5)
} as const

export const AUCTION_TIMER_SECONDS = 45

// =============================================
// FPL API TYPES
// =============================================

export interface FplPlayer {
  id: number
  first_name: string
  second_name: string
  web_name: string
  element_type: number // 1=GK, 2=DEF, 3=MID, 4=FWD
  team: number
  team_code: number
  selected_by_percent: string
  total_points: number
  goals_scored: number
  assists: number
  clean_sheets: number
  bonus: number
  yellow_cards: number
  red_cards: number
  minutes: number
  now_cost: number // in tenths of millions
  status: string   // a=available, d=doubtful, i=injured, s=suspended, u=unavailable
  news: string
}

export interface FplBootstrap {
  elements: FplPlayer[]
  teams: FplTeam[]
  element_types: FplElementType[]
  events: FplEvent[]
}

export interface FplTeam {
  id: number
  name: string
  short_name: string
  code: number
}

export interface FplElementType {
  id: number
  singular_name_short: string
}

export interface FplEvent {
  id: number
  deadline_time: string
  is_current: boolean
  is_next: boolean
  finished: boolean
}

// =============================================
// DATABASE TYPES
// =============================================

export interface Profile {
  id: string
  role: Role
  username: string
  display_name: string
  team_id: string | null
  created_at: string
}

export interface LeagueTeam {
  id: string
  display_name: string
  short_name: string
  budget: number      // in £m
  color: string
  auction_order: number | null
  created_at: string
}

export interface Player {
  id: number
  first_name: string
  second_name: string
  web_name: string
  position: Position
  fpl_team: string
  fpl_team_short: string
  selected_by_percent: number
  // Auction console stats
  total_points: number
  goals_scored: number
  assists: number
  clean_sheets: number
  bonus: number
  yellow_cards: number
  red_cards: number
  minutes: number
  // Pricing
  base_price: number  // our internal price (starts £1m, updated on auction/drop)
  fpl_cost: number    // stored but not displayed in UI
  status: string
  news: string
  updated_at: string
}

export interface RosterEntry {
  id: string
  team_id: string
  player_id: number
  slot_type: SlotType
  bench_order: number | null   // 1–4 for bench slots
  is_captain: boolean
  is_vice_captain: boolean
  base_price: number
  purchased_at: string
  player?: Player
}

export interface Auction {
  id: string
  type: AuctionType
  status: AuctionStatus
  gameweek: number | null
  current_position_category: Position | null
  auction_order: string[]  // ordered array of team IDs
  current_bidder_index: number
  free_transfers: number
  created_at: string
  started_at: string | null
  completed_at: string | null
}

export interface AuctionLot {
  id: string
  auction_id: string
  player_id: number
  phase: LotPhase
  timer_started_at: string | null
  current_bid: number | null
  current_bidder_id: string | null
  current_turn_team_id: string | null
  bid_start_team_index: number
  winning_team_id: string | null
  winning_bid: number | null
  created_at: string
  player?: Player
  winning_team?: LeagueTeam
}

export interface Bid {
  id: string
  lot_id: string
  team_id: string
  amount: number | null
  is_interested: boolean
  is_folded: boolean
  created_at: string
  team?: LeagueTeam
}

export interface AuctionLogEntry {
  id: string
  auction_id: string
  action_type: string
  payload: Record<string, unknown>
  created_at: string
}

export interface TeamDrop {
  id: string
  team_id: string
  auction_id: string
  player_id: number
  drop_price: number | null
  status: DropStatus
  dropped_post_january: boolean
  dropped_post_summer: boolean
  penalty_gameweek: number | null
  created_at: string
  player?: Player
}

export interface TeamTransferRecord {
  id: string
  team_id: string
  auction_id: string
  free_transfers_base: number
  free_transfers_carryover: number
  transfers_used: number
  excess_drops: number
  points_penalty: number
}

export interface GameweekPoints {
  id: string
  team_id: string
  gameweek: number
  player_id: number | null  // null for drop-penalty rows
  points: number
  was_subbed_in: boolean
  created_at: string
  player?: Player
}

// =============================================
// UI HELPERS
// =============================================

/** Position fill counts for a team's bid console */
export interface PositionFillCounts {
  GK: { filled: number; total: number }
  DEF: { filled: number; total: number }
  MID: { filled: number; total: number }
  FWD: { filled: number; total: number }
}

/** Summary of a team's drop quota for the current auction */
export interface DropQuotaSummary {
  free_base: number
  carryover: number
  total_free: number
  used: number
  excess: number
  penalty_points: number
}
