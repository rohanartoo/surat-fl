import { SQUAD_RULES } from "@/types"
import type { Position } from "@/types"
import { validateFormation } from "@/lib/auction-engine"
import { fetchFplLive } from "@/lib/fpl"
import type { FplLiveStats } from "@/lib/fpl"
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any

interface RosterEntry {
  id: string
  player_id: number
  slot_type: "starting" | "bench"
  bench_order: number | null
  position: Position
}

// =============================================
// AUTO-SUBS
// =============================================

/**
 * Given a team's starting XI and bench sorted by bench_order, applies FPL
 * auto-sub rules: for each starter who got 0 minutes, try bench players in
 * priority order (1→4), subbing in the first one who played AND keeps the
 * formation valid.
 */
function applyAutoSubs(
  starting: RosterEntry[],
  bench: RosterEntry[],
  liveStats: Record<number, FplLiveStats>,
): { entry: RosterEntry; wasSubbedIn: boolean }[] {
  const effectiveXI: { entry: RosterEntry; wasSubbedIn: boolean }[] =
    starting.map(e => ({ entry: e, wasSubbedIn: false }))
  const usedBenchIds = new Set<string>()

  for (let i = 0; i < effectiveXI.length; i++) {
    const { entry: starter } = effectiveXI[i]
    if ((liveStats[starter.player_id]?.minutes ?? 0) > 0) continue

    for (const bencher of bench) {
      if (usedBenchIds.has(bencher.id)) continue
      if ((liveStats[bencher.player_id]?.minutes ?? 0) === 0) continue

      // Check formation is still valid after the swap
      const simPositions = effectiveXI.map((x, idx) =>
        ({ position: idx === i ? bencher.position : x.entry.position })
      )
      if (validateFormation(simPositions) !== null) continue

      effectiveXI[i] = { entry: bencher, wasSubbedIn: true }
      usedBenchIds.add(bencher.id)
      break
    }
  }

  return effectiveXI
}

// =============================================
// SYNC
// =============================================

/**
 * Fetches FPL live points for `gw`, applies auto-sub rules for every team,
 * and upserts rows into `gameweek_points`. Idempotent — re-running overwrites
 * existing rows for the same gameweek.
 */
export async function syncGameweekPoints(
  gw: number,
  supabase: SupabaseClient,
): Promise<{ synced: number; teams: number }> {
  const liveStats = await fetchFplLive(gw)

  const { data: teams } = await supabase.from("teams").select("id")
  if (!teams || teams.length === 0) return { synced: 0, teams: 0 }

  // Delete existing non-penalty rows for this GW so re-sync is safe
  await supabase
    .from("gameweek_points")
    .delete()
    .eq("gameweek", gw)
    .eq("was_subbed_in", false)
  await supabase
    .from("gameweek_points")
    .delete()
    .eq("gameweek", gw)
    .eq("was_subbed_in", true)

  const rows: {
    team_id: string
    gameweek: number
    player_id: number
    points: number
    was_subbed_in: boolean
  }[] = []

  for (const team of teams as { id: string }[]) {
    const { data: roster } = await supabase
      .from("roster_entries")
      .select("id, player_id, slot_type, bench_order, player:players(position)")
      .eq("team_id", team.id)
      .in("slot_type", ["starting", "bench"])

    const entries: RosterEntry[] = (roster ?? []).map((r: {
      id: string; player_id: number; slot_type: string
      bench_order: number | null; player: { position: string }
    }) => ({
      id: r.id,
      player_id: r.player_id,
      slot_type: r.slot_type as "starting" | "bench",
      bench_order: r.bench_order,
      position: r.player.position as Position,
    }))

    const starting = entries.filter(e => e.slot_type === "starting")
    const bench = entries
      .filter(e => e.slot_type === "bench")
      .sort((a, b) => (a.bench_order ?? 99) - (b.bench_order ?? 99))

    // Only run auto-subs when starting XI is complete
    const effectiveXI = starting.length === SQUAD_RULES.starting
      ? applyAutoSubs(starting, bench, liveStats)
      : starting.map(e => ({ entry: e, wasSubbedIn: false }))

    for (const { entry, wasSubbedIn } of effectiveXI) {
      rows.push({
        team_id: team.id,
        gameweek: gw,
        player_id: entry.player_id,
        points: liveStats[entry.player_id]?.total_points ?? 0,
        was_subbed_in: wasSubbedIn,
      })
    }
  }

  if (rows.length > 0) {
    await supabase.from("gameweek_points").insert(rows)
  }

  return { synced: rows.length, teams: teams.length }
}

// =============================================
// DROP PENALTIES
// =============================================

/**
 * Writes -4pt penalty rows into `gameweek_points` for every team that had
 * excess drops in an auction whose `gameweek` field matches `gw`.
 * Idempotent — deletes existing penalty rows for the GW before inserting.
 *
 * Requires: gameweek_points.player_id is nullable (migration 20260509000001).
 */
export async function applyDropPenalties(
  gw: number,
  supabase: SupabaseClient,
): Promise<{ penaltyRows: number }> {
  // Find all transfer records linked to auctions that target this gameweek
  const { data: records, error } = await supabase
    .from("team_transfer_records")
    .select("team_id, points_penalty, auction:auctions(gameweek)")
    .gt("points_penalty", 0) // only rows with an actual penalty

  if (error) throw new Error(`applyDropPenalties fetch: ${error.message}`)

  const relevant = (records ?? []).filter(
    (r: { auction: { gameweek: number | null } | null }) =>
      r.auction?.gameweek === gw
  )

  if (relevant.length === 0) return { penaltyRows: 0 }

  // Remove any existing penalty rows for this GW to keep re-runs idempotent
  await supabase
    .from("gameweek_points")
    .delete()
    .eq("gameweek", gw)
    .is("player_id", null)

  const rows = relevant.map((r: { team_id: string; points_penalty: number }) => ({
    team_id: r.team_id,
    gameweek: gw,
    player_id: null,
    points: r.points_penalty, // already negative (e.g. -8 for 2 excess drops)
    was_subbed_in: false,
  }))

  const { error: insertErr } = await supabase.from("gameweek_points").insert(rows)
  if (insertErr) throw new Error(`applyDropPenalties insert: ${insertErr.message}`)

  return { penaltyRows: rows.length }
}

// =============================================
// STANDINGS
// =============================================

export interface StandingRow {
  team_id: string
  display_name: string
  short_name: string
  color: string
  total_points: number
  by_gameweek: Record<number, number>
}

/**
 * Returns all teams sorted by total points descending, including per-gameweek
 * breakdowns. Teams with no points recorded are included with 0.
 */
export async function getStandings(supabase: SupabaseClient): Promise<StandingRow[]> {
  const [{ data: teams }, { data: pointRows }] = await Promise.all([
    supabase.from("teams").select("id, display_name, short_name, color"),
    supabase.from("gameweek_points").select("team_id, gameweek, points"),
  ])

  const standings: Record<string, StandingRow> = {}

  // Seed every team with 0 points so they always appear
  for (const team of teams ?? []) {
    standings[team.id] = {
      team_id: team.id,
      display_name: team.display_name,
      short_name: team.short_name,
      color: team.color,
      total_points: 0,
      by_gameweek: {},
    }
  }

  for (const row of pointRows ?? []) {
    if (!standings[row.team_id]) continue
    standings[row.team_id].total_points += row.points
    standings[row.team_id].by_gameweek[row.gameweek] =
      (standings[row.team_id].by_gameweek[row.gameweek] ?? 0) + row.points
  }

  return Object.values(standings).sort((a, b) => b.total_points - a.total_points)
}
