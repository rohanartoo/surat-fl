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
export function applyAutoSubs(
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

  const [{ data: teams }, { data: allRoster }] = await Promise.all([
    supabase.from("teams").select("id"),
    supabase
      .from("roster_entries")
      .select("id, team_id, player_id, slot_type, bench_order, player:players(position)")
      .in("slot_type", ["starting", "bench"]),
  ])
  if (!teams || teams.length === 0) return { synced: 0, teams: 0 }

  // Delete existing non-penalty rows for this GW so re-sync is safe
  await supabase
    .from("gameweek_points")
    .delete()
    .eq("gameweek", gw)
    .not("player_id", "is", null)

  // Group roster entries by team_id in memory (avoids N+1)
  type RosterRow = { id: string; team_id: string; player_id: number; slot_type: string; bench_order: number | null; player: { position: string } }
  const rosterByTeam: Record<string, RosterRow[]> = {}
  for (const row of (allRoster ?? []) as RosterRow[]) {
    if (!rosterByTeam[row.team_id]) rosterByTeam[row.team_id] = []
    rosterByTeam[row.team_id].push(row)
  }

  const rows: {
    team_id: string
    gameweek: number
    player_id: number
    points: number
    was_subbed_in: boolean
  }[] = []

  for (const team of teams as { id: string }[]) {
    const entries: RosterEntry[] = (rosterByTeam[team.id] ?? []).map(r => ({
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
  latest_gw: number | null
  latest_gw_points: number | null
  position_change: number
}

export async function getStandings(supabase: SupabaseClient): Promise<StandingRow[]> {
  const [{ data: teams }, { data: pointRows }] = await Promise.all([
    supabase.from("teams").select("id, display_name, short_name, color"),
    supabase.from("gameweek_points").select("team_id, gameweek, points"),
  ])

  const standings: Record<string, StandingRow> = {}

  for (const team of teams ?? []) {
    standings[team.id] = {
      team_id: team.id,
      display_name: team.display_name,
      short_name: team.short_name,
      color: team.color,
      total_points: 0,
      by_gameweek: {},
      latest_gw: null,
      latest_gw_points: null,
      position_change: 0,
    }
  }

  for (const row of pointRows ?? []) {
    if (!standings[row.team_id]) continue
    standings[row.team_id].total_points += row.points
    standings[row.team_id].by_gameweek[row.gameweek] =
      (standings[row.team_id].by_gameweek[row.gameweek] ?? 0) + row.points
  }

  const allGws = Object.values(standings).flatMap(r => Object.keys(r.by_gameweek).map(Number))
  const latestGw = allGws.length > 0 ? Math.max(...allGws) : null

  const current = Object.values(standings).sort((a, b) => b.total_points - a.total_points)

  if (latestGw !== null) {
    // Rank before this GW's points were added
    const prev = [...current].sort(
      (a, b) => (b.total_points - (b.by_gameweek[latestGw] ?? 0)) - (a.total_points - (a.by_gameweek[latestGw] ?? 0))
    )
    const prevRankById: Record<string, number> = {}
    prev.forEach((r, i) => { prevRankById[r.team_id] = i })

    current.forEach((r, currIdx) => {
      r.latest_gw = latestGw
      r.latest_gw_points = r.by_gameweek[latestGw] ?? null
      r.position_change = prevRankById[r.team_id] - currIdx
    })
  }

  return current
}

// =============================================
// GAMEWEEK HIGHLIGHTS
// =============================================

export interface GameweekHighlights {
  gameweek: number
  playerOfTheWeek: {
    player_name: string
    web_name: string
    team_name: string
    points: number
    was_subbed_in: boolean
  } | null
  topTeam: {
    team_id: string
    display_name: string
    short_name: string
    color: string
    points: number
  } | null
}

/**
 * Returns the most recent gameweek that has synced data in gameweek_points,
 * or null if no data exists yet.
 */
export async function getLastSyncedGameweek(supabase: SupabaseClient): Promise<number | null> {
  const { data } = await supabase
    .from("gameweek_points")
    .select("gameweek")
    .order("gameweek", { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.gameweek ?? null
}

/**
 * Returns player of the week (highest individual points scorer from drafted players)
 * and top team (highest team total) for the given gameweek.
 */
export async function getGameweekHighlights(
  gw: number,
  supabase: SupabaseClient,
): Promise<GameweekHighlights> {
  const [{ data: pointRows }, { data: teams }] = await Promise.all([
    supabase
      .from("gameweek_points")
      .select("team_id, player_id, points, was_subbed_in, player:players(web_name, first_name, second_name, fpl_team_short)")
      .eq("gameweek", gw)
      .not("player_id", "is", null),
    supabase.from("teams").select("id, display_name, short_name, color"),
  ])

  // Player of the week — highest individual points
  let playerOfTheWeek: GameweekHighlights["playerOfTheWeek"] = null
  if (pointRows && pointRows.length > 0) {
    const best = [...pointRows].sort((a, b) => b.points - a.points)[0]
    if (best?.player) {
      const p = best.player as { web_name: string; first_name: string; second_name: string; fpl_team_short: string }
      playerOfTheWeek = {
        player_name: `${p.first_name} ${p.second_name}`,
        web_name: p.web_name,
        team_name: p.fpl_team_short,
        points: best.points,
        was_subbed_in: best.was_subbed_in,
      }
    }
  }

  // Top team — highest sum of points for the GW
  let topTeam: GameweekHighlights["topTeam"] = null
  if (pointRows && teams) {
    const teamMap = Object.fromEntries((teams as { id: string; display_name: string; short_name: string; color: string }[]).map(t => [t.id, t]))
    const totals: Record<string, number> = {}
    for (const row of pointRows) {
      totals[row.team_id] = (totals[row.team_id] ?? 0) + row.points
    }
    const topTeamId = Object.entries(totals).sort((a, b) => b[1] - a[1])[0]?.[0]
    if (topTeamId && teamMap[topTeamId]) {
      topTeam = {
        team_id: topTeamId,
        display_name: teamMap[topTeamId].display_name,
        short_name: teamMap[topTeamId].short_name,
        color: teamMap[topTeamId].color,
        points: totals[topTeamId],
      }
    }
  }

  return { gameweek: gw, playerOfTheWeek, topTeam }
}
