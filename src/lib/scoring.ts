import { SQUAD_RULES } from "@/types"
import type { Position, GameweekStatBreakdown } from "@/types"
import { validateFormation, POSITION_ORDER } from "@/lib/auction-engine"
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
  base_price: number
  is_captain: boolean
  is_vice_captain: boolean
}

// =============================================
// AUTO-SUBS
// =============================================

/**
 * Real FPL can never save an illegal Starting XI in the first place, so
 * there's no rule to mirror here — this app could, historically, for squads
 * drafted before the formation-minimum bug in auto-assignment was fixed.
 * Rather than scoring an incomplete lineup (missing a whole position) as-is,
 * repair it first: for each position short of its minimum, bring in the
 * team's own highest-priority bench player at that position (same bench
 * order the normal minutes-based subs below use), bumping the cheapest
 * starter from a position currently over its minimum — "cheapest" being
 * what the team itself paid, not a ranking imposed on them.
 */
function repairIllegalFormation(
  effectiveXI: { entry: RosterEntry; wasSubbedIn: boolean; subbedOutPlayerId?: number }[],
  bench: RosterEntry[],
  usedBenchIds: Set<string>,
): { entry: RosterEntry; wasSubbedIn: boolean; subbedOutPlayerId?: number }[] {
  if (validateFormation(effectiveXI.map(x => ({ position: x.entry.position }))) === null) {
    return effectiveXI
  }

  const next = [...effectiveXI]

  for (const pos of POSITION_ORDER) {
    for (;;) {
      const counts: Record<Position, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 }
      for (const x of next) counts[x.entry.position]++
      if (counts[pos] >= SQUAD_RULES.min_starting[pos]) break

      const incoming = bench.find(b => b.position === pos && !usedBenchIds.has(b.id))
      if (!incoming) break // no bench player at this position left to bring in

      const donor = next
        .filter(x => x.entry.position !== pos && counts[x.entry.position] > SQUAD_RULES.min_starting[x.entry.position])
        .sort((a, b) => a.entry.base_price - b.entry.base_price)[0]
      if (!donor) break // no legal donor — bringing this player in would break another position's minimum

      const donorIdx = next.findIndex(x => x.entry.id === donor.entry.id)
      next[donorIdx] = { entry: incoming, wasSubbedIn: true, subbedOutPlayerId: donor.entry.player_id }
      usedBenchIds.add(incoming.id)
    }
  }

  return next
}

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
): { entry: RosterEntry; wasSubbedIn: boolean; subbedOutPlayerId?: number }[] {
  const usedBenchIds = new Set<string>()

  const repaired = repairIllegalFormation(
    starting.map(e => ({ entry: e, wasSubbedIn: false })),
    bench,
    usedBenchIds,
  )

  const effectiveXI = [...repaired]

  for (let i = 0; i < effectiveXI.length; i++) {
    const { entry: starter } = effectiveXI[i]
    if ((liveStats[starter.player_id]?.minutes ?? 0) > 0) continue

    for (const bencher of bench) {
      if (usedBenchIds.has(bencher.id)) continue
      if ((liveStats[bencher.player_id]?.minutes ?? 0) === 0) continue

      // GK can only replace GK, and only a GK can replace GK
      if (bencher.position === "GK" && starter.position !== "GK") continue
      if (starter.position === "GK" && bencher.position !== "GK") continue

      // Check formation is still valid after the swap
      const simPositions = effectiveXI.map((x, idx) =>
        ({ position: idx === i ? bencher.position : x.entry.position })
      )
      if (validateFormation(simPositions) !== null) continue

      effectiveXI[i] = { entry: bencher, wasSubbedIn: true, subbedOutPlayerId: starter.player_id }
      usedBenchIds.add(bencher.id)
      break
    }
  }

  return effectiveXI
}

// =============================================
// CAPTAIN
// =============================================

/**
 * Real FPL rule: the captain's points double, but only if they actually
 * featured — if they didn't play (or got auto-subbed/repaired out of the
 * final XI entirely), the armband passes to the vice-captain under the same
 * condition. Returns null if neither played (no doubling that gameweek).
 */
export function determineEffectiveCaptain(
  allEntries: RosterEntry[],
  effectiveXI: { entry: RosterEntry }[],
  liveStats: Record<number, FplLiveStats>,
): number | null {
  const playedInEffectiveXI = (playerId: number) =>
    effectiveXI.some(x => x.entry.player_id === playerId) && (liveStats[playerId]?.minutes ?? 0) > 0

  const captain = allEntries.find(e => e.is_captain)
  if (captain && playedInEffectiveXI(captain.player_id)) return captain.player_id

  const vice = allEntries.find(e => e.is_vice_captain)
  if (vice && playedInEffectiveXI(vice.player_id)) return vice.player_id

  return null
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
  opts: { preserveRoster?: boolean } = {},
): Promise<{ synced: number; teams: number; preservedRoster?: boolean }> {
  const liveStats = await fetchFplLive(gw)

  // Re-scoring a finished gameweek: refresh the points on the rows already
  // recorded for it instead of rebuilding from today's squads. Rosters change
  // between gameweeks (transfers, mid-season auctions, players leaving the
  // league), so rebuilding would retroactively credit a past gameweek to
  // whoever holds the slot now. gameweek_points is the historical record of
  // who actually played that week, so only `points` may move — which is what
  // FPL bonus/appeal adjustments actually change.
  if (opts.preserveRoster) {
    const { data: existing } = await supabase
      .from("gameweek_points")
      .select("id, player_id, is_captain")
      .eq("gameweek", gw)
      .not("player_id", "is", null)

    if (!existing || existing.length === 0) {
      return { synced: 0, teams: 0, preservedRoster: true }
    }

    let updated = 0
    for (const row of existing as { id: string; player_id: number; is_captain: boolean }[]) {
      const stats = liveStats[row.player_id]
      const basePoints = stats?.total_points ?? 0
      const { error } = await supabase
        .from("gameweek_points")
        .update({ points: row.is_captain ? basePoints * 2 : basePoints, stat_breakdown: stats ?? null })
        .eq("id", row.id)
      if (error) throw new Error(`syncGameweekPoints update: ${error.message}`)
      updated++
    }
    return { synced: updated, teams: 0, preservedRoster: true }
  }

  const [{ data: teams }, { data: allRoster }] = await Promise.all([
    supabase.from("teams").select("id"),
    supabase
      .from("roster_entries")
      .select("id, team_id, player_id, slot_type, bench_order, base_price, is_captain, is_vice_captain, player:players(position)")
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
  type RosterRow = { id: string; team_id: string; player_id: number; slot_type: string; bench_order: number | null; base_price: number; is_captain: boolean; is_vice_captain: boolean; player: { position: string } }
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
    stat_breakdown: FplLiveStats | null
    is_captain: boolean
    subbed_out_player_id: number | null
    slot_type: "starting" | "bench"
    counted: boolean
  }[] = []

  for (const team of teams as { id: string }[]) {
    const entries: RosterEntry[] = (rosterByTeam[team.id] ?? []).map(r => ({
      id: r.id,
      player_id: r.player_id,
      slot_type: r.slot_type as "starting" | "bench",
      bench_order: r.bench_order,
      position: r.player.position as Position,
      base_price: r.base_price,
      is_captain: r.is_captain,
      is_vice_captain: r.is_vice_captain,
    }))

    const starting = entries.filter(e => e.slot_type === "starting")
    const bench = entries
      .filter(e => e.slot_type === "bench")
      .sort((a, b) => {
        const orderA = a.bench_order ?? 99
        const orderB = b.bench_order ?? 99
        if (orderA !== orderB) return orderA - orderB
        return a.id.localeCompare(b.id)
      })

    // Only run auto-subs when starting XI is complete
    const effectiveXI = starting.length === SQUAD_RULES.starting
      ? applyAutoSubs(starting, bench, liveStats)
      : starting.map(e => ({ entry: e, wasSubbedIn: false, subbedOutPlayerId: undefined as number | undefined }))

    const captainId = determineEffectiveCaptain(entries, effectiveXI, liveStats)
    const countedIds = new Set(effectiveXI.map(x => x.entry.player_id))

    for (const { entry, wasSubbedIn, subbedOutPlayerId } of effectiveXI) {
      const stats = liveStats[entry.player_id] ?? null
      const basePoints = stats?.total_points ?? 0
      const isEffectiveCaptain = entry.player_id === captainId
      rows.push({
        team_id: team.id,
        gameweek: gw,
        player_id: entry.player_id,
        points: isEffectiveCaptain ? basePoints * 2 : basePoints,
        was_subbed_in: wasSubbedIn,
        stat_breakdown: stats,
        is_captain: isEffectiveCaptain,
        subbed_out_player_id: subbedOutPlayerId ?? null,
        slot_type: entry.slot_type,
        counted: true,
      })
    }

    // Informational-only rows: original starters who got subbed out, and
    // bench players never used. Not part of the team total, but needed so
    // the per-GW squad view can show the full 15-man snapshot for that week.
    for (const entry of entries) {
      if (countedIds.has(entry.player_id)) continue
      const stats = liveStats[entry.player_id] ?? null
      rows.push({
        team_id: team.id,
        gameweek: gw,
        player_id: entry.player_id,
        points: stats?.total_points ?? 0,
        was_subbed_in: false,
        stat_breakdown: stats,
        is_captain: false,
        subbed_out_player_id: null,
        slot_type: entry.slot_type,
        counted: false,
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
    supabase.from("gameweek_points").select("team_id, gameweek, points").eq("counted", true),
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
      .select("team_id, player_id, points, was_subbed_in, counted, player:players(web_name, first_name, second_name, fpl_team_short)")
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

  // Top team — highest sum of points for the GW (only rows that counted
  // towards the team's total, i.e. the effective Starting XI)
  let topTeam: GameweekHighlights["topTeam"] = null
  if (pointRows && teams) {
    const teamMap = Object.fromEntries((teams as { id: string; display_name: string; short_name: string; color: string }[]).map(t => [t.id, t]))
    const totals: Record<string, number> = {}
    for (const row of pointRows) {
      if (!row.counted) continue
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

// =============================================
// TEAM GAMEWEEK PERFORMANCE
// =============================================

export interface TeamGameweekPlayerPerformance {
  player_id: number
  web_name: string
  position: Position
  points: number
  was_subbed_in: boolean
  is_captain: boolean
  stat_breakdown: GameweekStatBreakdown | null
  subbed_out_player_id: number | null
  subbed_out_web_name: string | null
  slot_type: "starting" | "bench"
  counted: boolean
}

export interface TeamGameweekPerformance {
  gameweek: number
  team_total: number
  starting: TeamGameweekPlayerPerformance[]
  bench: TeamGameweekPlayerPerformance[]
}

/**
 * Powers the "My Team" gameweek-performance view: the full 15-man squad
 * snapshot for this team+GW as of sync time (see syncGameweekPoints) split
 * into starting/bench, each with its stat breakdown, captain flag, whether
 * it counted towards the team total, and — for auto-subbed-in players — the
 * name of whoever they replaced.
 */
export async function getTeamGameweekPerformance(
  teamId: string,
  gw: number,
  supabase: SupabaseClient,
): Promise<TeamGameweekPerformance> {
  const { data } = await supabase
    .from("gameweek_points")
    .select("player_id, points, was_subbed_in, is_captain, stat_breakdown, subbed_out_player_id, slot_type, counted, player:players(web_name, position)")
    .eq("team_id", teamId)
    .eq("gameweek", gw)
    .not("player_id", "is", null)

  type Row = {
    player_id: number
    points: number
    was_subbed_in: boolean
    is_captain: boolean
    stat_breakdown: GameweekStatBreakdown | null
    subbed_out_player_id: number | null
    slot_type: "starting" | "bench" | null
    counted: boolean
    player: { web_name: string; position: Position } | null
  }
  const rows = (data ?? []) as Row[]

  const subbedOutIds = [...new Set(rows.map(r => r.subbed_out_player_id).filter((id): id is number => id != null))]
  const subbedOutNames: Record<number, string> = {}
  if (subbedOutIds.length > 0) {
    const { data: subbedOutPlayers } = await supabase
      .from("players")
      .select("id, web_name")
      .in("id", subbedOutIds)
    for (const p of (subbedOutPlayers ?? []) as { id: number; web_name: string }[]) {
      subbedOutNames[p.id] = p.web_name
    }
  }

  const players: TeamGameweekPlayerPerformance[] = rows
    .filter(r => r.player)
    .map(r => ({
      player_id: r.player_id,
      web_name: r.player!.web_name,
      position: r.player!.position,
      points: r.points,
      was_subbed_in: r.was_subbed_in,
      is_captain: r.is_captain,
      stat_breakdown: r.stat_breakdown,
      subbed_out_player_id: r.subbed_out_player_id,
      subbed_out_web_name: r.subbed_out_player_id != null ? subbedOutNames[r.subbed_out_player_id] ?? null : null,
      // Rows synced before this column existed have no slot_type — treat as starting
      // since only effective-XI rows were ever written back then.
      slot_type: r.slot_type ?? "starting",
      counted: r.counted,
    }))
    .sort((a, b) => POSITION_ORDER.indexOf(a.position) - POSITION_ORDER.indexOf(b.position))

  const starting = players.filter(p => p.slot_type === "starting")
  const bench = players.filter(p => p.slot_type === "bench")
  const team_total = players.filter(p => p.counted).reduce((s, p) => s + p.points, 0)

  return { gameweek: gw, team_total, starting, bench }
}
