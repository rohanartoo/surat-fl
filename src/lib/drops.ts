import { DROP_RULES, SQUAD_RULES } from "@/types"
import type { AuctionType, DropQuotaSummary, Position, Role, SlotType } from "@/types"
import { roleIsAM } from "@/lib/role-utils"
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any

/** Free drop allowance for a given auction type. */
export function freeDropsForType(type: AuctionType): number {
  switch (type) {
    case "initial": return DROP_RULES.free_drops_first_inseason
    case "post_jan": return DROP_RULES.free_drops_post_jan
    case "post_summer": return DROP_RULES.free_drops_post_summer
    default: return DROP_RULES.free_drops_standard
  }
}

/**
 * Looks up how many free transfers a team carries into the given auction,
 * from the most recently completed auction before it. Auctions are strictly
 * serial (only one pending/active at a time — see handleCreate), so "the
 * most recently completed auction before this one's created_at" is an
 * unambiguous "prior auction" to pull team_transfer_records from. Returns 0
 * if there's no prior auction, or the team has no record for it (e.g. it
 * didn't participate).
 */
export async function getCarryoverForTeam(
  teamId: string,
  auctionCreatedAt: string,
  supabase: SupabaseClient,
): Promise<number> {
  const { data: priorAuctions } = await supabase
    .from("auctions")
    .select("id")
    .eq("status", "completed")
    .lt("created_at", auctionCreatedAt)
    .order("created_at", { ascending: false })
    .limit(1)
  const priorAuctionId = priorAuctions?.[0]?.id ?? null
  if (!priorAuctionId) return 0

  const { data: priorRecord } = await supabase
    .from("team_transfer_records")
    .select("free_transfers_base, free_transfers_carryover, transfers_used")
    .eq("auction_id", priorAuctionId)
    .eq("team_id", teamId)
    .maybeSingle()
  if (!priorRecord) return 0

  const leftover = priorRecord.free_transfers_base + priorRecord.free_transfers_carryover - priorRecord.transfers_used
  return Math.min(Math.max(0, leftover), DROP_RULES.max_carry_over)
}

/**
 * Computes a team's drop quota summary for the given auction.
 * carryover defaults to 0; pass from team_transfer_records when available.
 */
export async function getDropQuota(
  teamId: string,
  auctionId: string,
  auctionType: AuctionType,
  supabase: SupabaseClient,
  carryover = 0,
): Promise<DropQuotaSummary> {
  const { count } = await supabase
    .from("team_drops")
    .select("*", { count: "exact", head: true })
    .eq("team_id", teamId)
    .eq("auction_id", auctionId)

  const free_base = freeDropsForType(auctionType)
  const total_free = free_base + Math.min(carryover, DROP_RULES.max_carry_over)
  const used = count ?? 0
  const excess = Math.max(0, used - total_free)
  const penalty_points = excess * DROP_RULES.penalty_per_extra_drop

  return { free_base, carryover, total_free, used, excess, penalty_points }
}

/**
 * Locks all staged drops for an auction simultaneously, credits each
 * dropping team's budget with the full purchase price of every player they
 * dropped, and removes those players from roster_entries so they enter the
 * available pool. Called when the AM starts a mini/post_jan/post_summer
 * auction. Atomic (see rpc_lock_and_credit_drops) — teams.budget must never
 * be credited without the corresponding roster rows actually being removed,
 * or vice versa.
 */
export async function lockAndCommitDrops(
  auctionId: string,
  supabase: SupabaseClient,
): Promise<{ locked: number }> {
  const { data, error } = await supabase
    .rpc("rpc_lock_and_credit_drops", { p_auction_id: auctionId })
    .single()
  if (error) throw new Error(error.message)
  return { locked: (data as { locked: number }).locked }
}

/**
 * Checks whether a team may re-draft a player it previously dropped (in an
 * auction OTHER than the current one — same-auction re-signs are blocked
 * separately by the caller). Returns null if allowed, or an error message.
 *
 * Rule (pivots on the post-January / Feb-1 window):
 *  - Dropped **in or after** the post-January window → permanent for the
 *    season (`dropped_post_january` is set true at drop time in that case).
 *  - Dropped **before** it → re-draftable only once the post-January auction
 *    has started (`postJanAuctionExists`).
 *
 * `dropped_post_summer` is retained on the record for history but no longer
 * affects eligibility: a post-summer drop is a pre-January drop and becomes
 * re-draftable from the post-January auction like any other.
 */
export function checkReDraftEligibility(
  drop: { dropped_post_january: boolean; dropped_post_summer?: boolean } | null,
  postJanAuctionExists: boolean
): string | null {
  if (!drop) return null

  if (drop.dropped_post_january) {
    return "You cannot re-draft a player you dropped in or after the post-January transfer window. This restriction is permanent for this season."
  }
  if (!postJanAuctionExists) {
    return "You cannot re-draft this player yet. Players dropped before the post-January window can only be re-drafted from the post-January auction onwards."
  }

  return null
}

// ─────────────────────────────────────────────
// Staged-drop visibility
// ─────────────────────────────────────────────
//
// A roster row with slot_type "dropped" is always a staged, not-yet-locked
// drop: drops can only be staged while an auction is pending, and
// rpc_lock_and_credit_drops deletes those rows when the auction starts. Until
// then, only the owning team and the AM/admin may see them — other teams would
// otherwise gain an edge from knowing who is about to hit the pool.
//
// This is app-level hiding only: RLS still lets any signed-in user read
// roster_entries and team_drops directly. Every roster/drops view shown to
// other teams must go through these helpers.

/** Whether the viewer may see `teamId`'s staged drops: its own team, or AM/admin. */
export function canSeeStagedDrops(role: Role, viewerTeamId: string | null | undefined, teamId: string): boolean {
  return roleIsAM(role) || (!!viewerTeamId && viewerTeamId === teamId)
}

type MaskableEntry = {
  slot_type: SlotType
  bench_order: number | null
  is_captain: boolean
  is_vice_captain: boolean
  base_price: number
  player?: { position: Position } | null
}

/**
 * Returns the roster as other teams should see it while drops are staged:
 * every "dropped" row restored to an active slot, so the squad shows no gap,
 * no staged section and no provisional budget.
 *
 * The original slot isn't stored (rpc_mark_drop overwrites it), so this is a
 * best-effort reconstruction: dropped players (most expensive first) refill
 * Starting XI gaps where the formation maximum for their position allows,
 * and the rest go to the end of the bench. Captaincy is not restored.
 */
export function maskStagedDrops<T extends MaskableEntry>(roster: T[]): T[] {
  const dropped = roster.filter(e => e.slot_type === "dropped")
  if (dropped.length === 0) return roster

  const result = roster.filter(e => e.slot_type !== "dropped")
  const starting = result.filter(e => e.slot_type === "starting")
  const startingByPos: Partial<Record<Position, number>> = {}
  for (const e of starting) {
    if (e.player) startingByPos[e.player.position] = (startingByPos[e.player.position] ?? 0) + 1
  }
  let startingCount = starting.length
  let nextBenchOrder = Math.max(0, ...result.filter(e => e.slot_type === "bench").map(e => e.bench_order ?? 0)) + 1

  for (const e of [...dropped].sort((a, b) => b.base_price - a.base_price)) {
    const pos = e.player?.position
    const fitsXI = startingCount < SQUAD_RULES.starting &&
      (!pos || (startingByPos[pos] ?? 0) < SQUAD_RULES.max_starting[pos])
    if (fitsXI) {
      result.push({ ...e, slot_type: "starting", bench_order: null, is_captain: false, is_vice_captain: false })
      startingCount++
      if (pos) startingByPos[pos] = (startingByPos[pos] ?? 0) + 1
    } else {
      result.push({ ...e, slot_type: "bench", bench_order: nextBenchOrder++, is_captain: false, is_vice_captain: false })
    }
  }
  return result
}

export type PlayerOwner = { team_id: string; short_name: string; color: string; staged: boolean }

/**
 * Who owns each drafted player, for list views such as the Players page.
 * Every roster row counts as ownership — a staged drop included — so a staged
 * player never looks free before the auction locks the drop. `staged` is only
 * true for viewers allowed to see that team's staged drops (canSeeStagedDrops);
 * everyone else gets `false`, so the payload itself gives nothing away.
 * Unowned players are simply absent.
 */
export function buildPlayerOwners(
  rosterRows: { team_id: string; player_id: number; slot_type: SlotType }[],
  teams: { id: string; short_name: string; color: string }[],
  viewer: { role: Role; teamId: string | null | undefined },
): Record<number, PlayerOwner> {
  const teamById = new Map(teams.map(t => [t.id, t]))
  const owners: Record<number, PlayerOwner> = {}
  for (const row of rosterRows) {
    const team = teamById.get(row.team_id)
    if (!team) continue
    owners[row.player_id] = {
      team_id: team.id,
      short_name: team.short_name,
      color: team.color,
      staged: row.slot_type === "dropped" && canSeeStagedDrops(viewer.role, viewer.teamId, row.team_id),
    }
  }
  return owners
}
