import { DROP_RULES } from "@/types"
import type { AuctionType, DropQuotaSummary } from "@/types"
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any

/** Free drop allowance for a given auction type. */
export function freeDropsForType(type: AuctionType): number {
  if (type === "initial" || type === "post_jan" || type === "post_summer") {
    return DROP_RULES.free_drops_first_inseason
  }
  return DROP_RULES.free_drops_standard
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
 * Locks all staged drops for an auction simultaneously and removes those
 * players from roster_entries so they enter the available pool.
 * Called when the AM starts a mini/post_jan/post_summer auction.
 */
export async function lockAndCommitDrops(
  auctionId: string,
  supabase: SupabaseClient,
): Promise<{ locked: number }> {
  const { data: staged } = await supabase
    .from("team_drops")
    .select("id, player_id")
    .eq("auction_id", auctionId)
    .eq("status", "staged")

  if (!staged || staged.length === 0) return { locked: 0 }

  const dropIds = (staged as { id: string }[]).map(d => d.id)
  const playerIds = (staged as { player_id: number }[]).map(d => d.player_id)

  await supabase
    .from("team_drops")
    .update({ status: "locked" })
    .in("id", dropIds)

  // Remove dropped roster entries — players are now fully in the free pool
  await supabase
    .from("roster_entries")
    .delete()
    .in("player_id", playerIds)
    .eq("slot_type", "dropped")

  return { locked: staged.length }
}
