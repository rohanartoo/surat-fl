import { SQUAD_RULES } from "@/types"
import type { Position, GameweekStatBreakdown } from "@/types"
import { validateFormation, POSITION_ORDER } from "@/lib/auction-engine"
import { fetchFplLive, fetchFplBootstrap } from "@/lib/fpl"
import type { FplLiveStats } from "@/lib/fpl"
import { isGameweekFinalized } from "@/lib/lineup-lock"
import { computePointsBreakdown, type PointsBreakdownLine } from "@/lib/points-breakdown"
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
 *
 * `gwFinished` gates auto-subs and the captain→VC fallback: real FPL only
 * resolves those once a gameweek's fixtures are all finished (a player
 * hasn't "failed to play" just because their fixture hasn't kicked off yet).
 * While `gw` is still live, this scores provisionally — raw Starting XI,
 * no auto-subs, designated captain doubled with no fallback — matching what
 * FPL itself displays mid-gameweek. Ignored when `preserveRoster` is set,
 * since that path only refreshes points on already-resolved rows.
 */
export async function syncGameweekPoints(
  gw: number,
  supabase: SupabaseClient,
  opts: { preserveRoster?: boolean; gwFinished?: boolean } = {},
): Promise<{ synced: number; teams: number; preservedRoster?: boolean; finalized?: boolean }> {
  // Belt-and-braces: a finalized gameweek's roster can never be rebuilt, no
  // matter what the caller passed. Callers (the cron, /api/scoring/sync)
  // are expected to compute this themselves too — see their own comments —
  // since preserveRoster also gates applyDropPenalties there, which this
  // internal flip alone wouldn't protect.
  let preserveRoster = opts.preserveRoster
  if (!preserveRoster && await isGameweekFinalized(gw, supabase)) {
    console.warn(`[syncGameweekPoints] GW ${gw} is already finalized — forcing preserveRoster to protect the recorded roster.`)
    preserveRoster = true
  }

  const liveStats = await fetchFplLive(gw)

  // Re-scoring a finished gameweek: refresh the points on the rows already
  // recorded for it instead of rebuilding from today's squads. Rosters change
  // between gameweeks (transfers, mid-season auctions, players leaving the
  // league), so rebuilding would retroactively credit a past gameweek to
  // whoever holds the slot now. gameweek_points is the historical record of
  // who actually played that week, so only `points` may move — which is what
  // FPL bonus/appeal adjustments actually change.
  if (preserveRoster) {
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
      // A player missing from this GW's live response (a deleted/reissued
      // FPL element — rare, but has happened) is not the same as a player
      // who genuinely scored 0. Leave their historical points untouched
      // rather than overwriting real points with a false zero.
      if (!stats) continue
      const basePoints = stats.total_points
      const { error } = await supabase
        .from("gameweek_points")
        .update({ points: row.is_captain ? basePoints * 2 : basePoints, stat_breakdown: stats })
        .eq("id", row.id)
      if (error) throw new Error(`syncGameweekPoints update: ${error.message}`)
      updated++
    }
    return { synced: updated, teams: 0, preservedRoster: true }
  }

  const [{ data: teams, error: teamsErr }, { data: allRoster, error: rosterErr }] = await Promise.all([
    supabase.from("teams").select("id"),
    supabase
      .from("roster_entries")
      .select("id, team_id, player_id, slot_type, bench_order, base_price, is_captain, is_vice_captain, player:players(position)")
      .in("slot_type", ["starting", "bench"]),
  ])
  // Bail out BEFORE touching gameweek_points if either read failed — a
  // transient error here must never reach the delete below, or a scored
  // gameweek gets wiped with nothing to replace it.
  if (teamsErr) throw new Error(`syncGameweekPoints teams read: ${teamsErr.message}`)
  if (rosterErr) throw new Error(`syncGameweekPoints roster read: ${rosterErr.message}`)
  if (!teams || teams.length === 0) return { synced: 0, teams: 0 }

  // Delete existing non-penalty rows for this GW so re-sync is safe
  const { error: deleteErr } = await supabase
    .from("gameweek_points")
    .delete()
    .eq("gameweek", gw)
    .not("player_id", "is", null)
  if (deleteErr) throw new Error(`syncGameweekPoints delete: ${deleteErr.message}`)

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
    // Snapshot of the bench priority this gameweek actually scored against —
    // the input applyAutoSubs used. roster_entries.bench_order moves as soon
    // as the team reshuffles for the next gameweek, so without recording it
    // here a past gameweek's substitution order becomes unexplainable.
    bench_order: number | null
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

    // Only run auto-subs once the gameweek is finished (real FPL doesn't
    // resolve subs mid-gameweek — a starter with 0 minutes so far may simply
    // not have kicked off yet) and only when the starting XI is complete.
    const effectiveXI = opts.gwFinished && starting.length === SQUAD_RULES.starting
      ? applyAutoSubs(starting, bench, liveStats)
      : starting.map(e => ({ entry: e, wasSubbedIn: false, subbedOutPlayerId: undefined as number | undefined }))

    // Same reasoning for the captain→VC fallback — only resolve it once the
    // gameweek is finished; while live, show the designated captain doubled
    // (or not, if they haven't scored yet) with no early armband swap.
    const captainId = opts.gwFinished
      ? determineEffectiveCaptain(entries, effectiveXI, liveStats)
      : (entries.find(e => e.is_captain)?.player_id ?? null)
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
        bench_order: entry.bench_order,
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
        bench_order: entry.bench_order,
      })
    }
  }

  if (rows.length > 0) {
    const { error: insertErr } = await supabase.from("gameweek_points").insert(rows)
    // The rows for this GW were already deleted above — a failed insert here
    // must surface as an error (not a silent {synced:0}), or the gameweek is
    // left permanently empty with no way to tell it apart from "nothing to
    // sync yet".
    if (insertErr) throw new Error(`syncGameweekPoints insert: ${insertErr.message}`)
  }

  // This is the run that resolved auto-subs and the captain->VC fallback —
  // the roster this gameweek scored against is now permanent. Mark it
  // finalized so no later sync (even one that forgets to pass
  // preserveRoster) can ever rebuild it from a since-changed roster, and so
  // src/lib/lineup-lock.ts can lift the deadline lock for it.
  if (opts.gwFinished) {
    const { error: finalizeErr } = await supabase
      .from("gameweek_scoring_status")
      .upsert({ gameweek: gw, finalized_by: "sync" }, { onConflict: "gameweek", ignoreDuplicates: true })
    if (finalizeErr) throw new Error(`syncGameweekPoints finalize: ${finalizeErr.message}`)
  }

  return { synced: rows.length, teams: teams.length, finalized: !!opts.gwFinished }
}

// =============================================
// DROP PENALTIES
// =============================================

/**
 * Attaches every not-yet-applied drop penalty to gw — "not yet applied" means
 * a team_transfer_records row with a penalty (points_penalty < 0) whose
 * applied_gameweek is still null. A penalty only ever gets picked up once,
 * whichever gameweek happens to be scored/simulated next, so this is
 * naturally idempotent per GW without needing a delete-then-reinsert dance.
 * rpc_apply_drop_penalties (see the applied_gameweek migration) does the
 * claim-and-write atomically, so a partial failure can't double- or
 * half-apply a penalty.
 */
export async function applyDropPenalties(
  gw: number,
  supabase: SupabaseClient,
): Promise<{ penaltyRows: number }> {
  const { data, error } = await supabase.rpc("rpc_apply_drop_penalties", { p_gameweek: gw })
  if (error) throw new Error(`applyDropPenalties: ${error.message}`)
  return { penaltyRows: (data as number) ?? 0 }
}

/**
 * The manual/admin "sync this gameweek now" flow, reached through the
 * /api/scoring/sync route (SYNC_SECRET bearer or admin session over HTTP).
 * The admin control on the Overview page posts to that route — see
 * src/components/standings/SyncGameweekCard.tsx.
 *
 * `finalize: true` is the manual escape hatch for a gameweek that would
 * otherwise never finalize on its own (e.g. a fixture postponed out of its
 * gameweek entirely, so FPL never marks it finished) — see the wedge risk
 * noted in src/lib/lineup-lock.ts. It means "treat FPL as having reported
 * this gameweek finished", so for the LIVE gameweek it runs the same
 * rebuild a natural finalization would: auto-subs, the captain→VC fallback,
 * and drop penalties, after which syncGameweekPoints writes the
 * gameweek_scoring_status row itself.
 *
 * It deliberately does NOT force a rebuild of a past gameweek. Rosters move
 * on, so there is no way to reconstruct that gameweek's auto-subs from
 * today's squads; a past gameweek only gets the status row written, which
 * lifts the lineup lock without rewriting history.
 */
export async function runManualGameweekSync(
  gw: number,
  supabase: SupabaseClient,
  opts: { finalize?: boolean } = {},
): Promise<{ gameweek: number; penaltyRows: number } & Awaited<ReturnType<typeof syncGameweekPoints>>> {
  // Only the live gameweek is rebuilt from current squads. For any earlier
  // gameweek, refresh points on the rows already recorded for it so that
  // transfers and mid-season auctions cannot rewrite past results. Fails
  // safe: if FPL reports no active gameweek (pre-season, between seasons, or
  // a bootstrap hiccup) every gameweek counts as past, so a stray manual
  // sync can never rebuild history from current squads. Also preserved once
  // a gameweek is finalized (see gameweek_scoring_status) — computed here,
  // not left to syncGameweekPoints's internal safety net, because
  // preserveRoster also gates the drop-penalty application below.
  const bootstrap = await fetchFplBootstrap()
  const currentEvent = bootstrap.events.find(e => e.is_current) ?? null
  const preserveRoster =
    currentEvent === null || gw !== currentEvent.id || await isGameweekFinalized(gw, supabase)

  // finalize means "act as though FPL had flipped events[].finished". Passing
  // it through as gwFinished (rather than writing the status row up front) is
  // the whole point: auto-subs and the captain→VC fallback are gated on this
  // flag, and writing the row first would flip preserveRoster above to true,
  // sending the sync down the refresh-only path — permanently freezing a
  // gameweek whose auto-subs had never run and now never could.
  const pointsResult = await syncGameweekPoints(gw, supabase, {
    preserveRoster,
    gwFinished: opts.finalize === true ? true : currentEvent?.finished,
  })
  // A pending drop penalty must only ever attach to the live/next gameweek
  // actually being scored for the first time — not to a preserveRoster
  // re-sync of an older GW (e.g. refreshing a past GW after an FPL bonus
  // correction), which would permanently steal a penalty meant for later.
  const penaltyResult = preserveRoster
    ? { penaltyRows: 0 }
    : await applyDropPenalties(gw, supabase)

  // syncGameweekPoints writes the status row itself on the rebuild path (it
  // reports that back as `finalized`). The preserveRoster path returns before
  // reaching that, so a force-finalize of a past or already-recorded gameweek
  // still needs it written here — that case cannot be rebuilt, but it must
  // still be able to lift a stuck lineup lock.
  //
  // Written AFTER the sync on purpose: finalizing first and then failing the
  // rebuild would leave the gameweek frozen with whatever partial rows it had.
  if (opts.finalize === true && !pointsResult.finalized) {
    const { error: finalizeErr } = await supabase
      .from("gameweek_scoring_status")
      .upsert({ gameweek: gw, finalized_by: "manual" }, { onConflict: "gameweek", ignoreDuplicates: true })
    if (finalizeErr) throw new Error(`runManualGameweekSync finalize: ${finalizeErr.message}`)
    pointsResult.finalized = true
  }

  return { gameweek: gw, ...pointsResult, ...penaltyResult }
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
  penalized_gws: number[]
  latest_gw: number | null
  latest_gw_points: number | null
  position_change: number
}

export async function getStandings(supabase: SupabaseClient): Promise<StandingRow[]> {
  const [{ data: teams }, { data: pointRows }, { data: penaltyRows }] = await Promise.all([
    supabase.from("teams").select("id, display_name, short_name, color"),
    // Explicit .range() — without one, an unbounded select falls back to
    // Supabase's default page size (commonly 1000), which a full season for
    // even this 7-team league (7 * 15 * 38 ≈ 4,000 rows) can exceed, silently
    // truncating standings partway through the season. 20,000 is comfortable
    // headroom; a real cap would need explicit pagination, not a bigger number.
    supabase.from("gameweek_points").select("team_id, gameweek, points").eq("counted", true).range(0, 19999),
    supabase.from("team_transfer_records").select("team_id, applied_gameweek").not("applied_gameweek", "is", null),
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
      penalized_gws: [],
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

  for (const row of penaltyRows ?? []) {
    if (!standings[row.team_id]) continue
    standings[row.team_id].penalized_gws.push(row.applied_gameweek)
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
  const [{ data: pointRows, error: pointsErr }, { data: teams }, { data: penaltyRows }] = await Promise.all([
    supabase
      .from("gameweek_points")
      // gameweek_points has two FKs to players (player_id, subbed_out_player_id) —
      // the embed must be disambiguated or PostgREST errors with "more than one
      // relationship was found" and silently returns no data.
      .select("team_id, player_id, points, was_subbed_in, counted, is_captain, player:players!gameweek_points_player_id_fkey(web_name, first_name, second_name, fpl_team_short)")
      .eq("gameweek", gw)
      .not("player_id", "is", null),
    supabase.from("teams").select("id, display_name, short_name, color"),
    supabase.from("team_transfer_records").select("team_id, points_penalty").eq("applied_gameweek", gw),
  ])
  if (pointsErr) throw new Error(`getGameweekHighlights: ${pointsErr.message}`)

  // Player of the week — highest individual points among players who
  // actually counted towards their team's total (excludes subbed-out
  // starters and unused bench players — an unused bench haul shouldn't be
  // crowned). Displayed as the player's own points, not the captain-doubled
  // stored value, since "Player of the Week" is about individual output.
  //
  // Rank on that same un-doubled value. gameweek_points.points stores the
  // captain's haul already doubled, so ranking on the raw column crowned a
  // captain who scored less than the actual top scorer — and then displayed
  // the halved figure, showing a lower number than the player it beat.
  let playerOfTheWeek: GameweekHighlights["playerOfTheWeek"] = null
  const countedRows = (pointRows ?? []).filter((r: { counted: boolean }) => r.counted)
  if (countedRows.length > 0) {
    const individual = (r: { points: number; is_captain: boolean }) =>
      r.is_captain ? r.points / 2 : r.points
    const best = [...countedRows].sort((a, b) => individual(b) - individual(a))[0]
    if (best?.player) {
      const p = best.player as { web_name: string; first_name: string; second_name: string; fpl_team_short: string }
      playerOfTheWeek = {
        player_name: `${p.first_name} ${p.second_name}`,
        web_name: p.web_name,
        team_name: p.fpl_team_short,
        points: individual(best),
        was_subbed_in: best.was_subbed_in,
      }
    }
  }

  // Top team — highest sum of points for the GW (only rows that counted
  // towards the team's total, i.e. the effective Starting XI), including any
  // drop-quota penalty applied to this GW — matches getStandings, which also
  // includes penalty rows in a team's total for the GW they're applied to.
  let topTeam: GameweekHighlights["topTeam"] = null
  if (pointRows && teams) {
    const teamMap = Object.fromEntries((teams as { id: string; display_name: string; short_name: string; color: string }[]).map(t => [t.id, t]))
    const totals: Record<string, number> = {}
    for (const row of pointRows) {
      if (!row.counted) continue
      totals[row.team_id] = (totals[row.team_id] ?? 0) + row.points
    }
    for (const row of penaltyRows ?? []) {
      totals[row.team_id] = (totals[row.team_id] ?? 0) + row.points_penalty
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
  // FPL's own pre-computed points breakdown, unpacked from stat_breakdown.explain
  // (src/lib/points-breakdown.ts). Null/empty when stat_breakdown itself is
  // null, or for a row synced before `explain` was captured — callers
  // should fall back to a category-only display in that case, not fail.
  points_breakdown: PointsBreakdownLine[] | null
  subbed_out_player_id: number | null
  subbed_out_web_name: string | null
  slot_type: "starting" | "bench"
  counted: boolean
  /**
   * Bench priority (1–4) as it stood when this gameweek was scored. Null for
   * starting-XI rows, and for every row of a gameweek scored before the
   * column existed — callers must fall back rather than render a blank pip.
   */
  bench_order: number | null
}

export interface TeamGameweekPerformance {
  gameweek: number
  team_total: number
  points_penalty: number | null
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
  const [{ data, error }, { data: penaltyRows, error: penaltyErr }] = await Promise.all([
    supabase
      .from("gameweek_points")
      // gameweek_points has two FKs to players (player_id, subbed_out_player_id) —
      // the embed must be disambiguated or PostgREST errors with "more than one
      // relationship was found" and silently returns no data.
      .select("player_id, points, was_subbed_in, is_captain, stat_breakdown, subbed_out_player_id, slot_type, counted, bench_order, player:players!gameweek_points_player_id_fkey(web_name, position)")
      .eq("team_id", teamId)
      .eq("gameweek", gw)
      .not("player_id", "is", null),
    supabase
      .from("team_transfer_records")
      .select("points_penalty")
      .eq("team_id", teamId)
      .eq("applied_gameweek", gw),
  ])
  if (error) throw new Error(`getTeamGameweekPerformance: ${error.message}`)
  if (penaltyErr) throw new Error(`getTeamGameweekPerformance: ${penaltyErr.message}`)

  const points_penalty = (penaltyRows ?? []).reduce((sum: number, r: { points_penalty: number }) => sum + r.points_penalty, 0) || null

  type Row = {
    player_id: number
    points: number
    was_subbed_in: boolean
    is_captain: boolean
    stat_breakdown: GameweekStatBreakdown | null
    subbed_out_player_id: number | null
    slot_type: "starting" | "bench" | null
    counted: boolean
    bench_order: number | null
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
      points_breakdown: r.stat_breakdown ? computePointsBreakdown(r.stat_breakdown) : null,
      subbed_out_player_id: r.subbed_out_player_id,
      subbed_out_web_name: r.subbed_out_player_id != null ? subbedOutNames[r.subbed_out_player_id] ?? null : null,
      // Rows synced before this column existed have no slot_type — treat as starting
      // since only effective-XI rows were ever written back then.
      slot_type: r.slot_type ?? "starting",
      counted: r.counted,
      bench_order: r.bench_order,
    }))
    .sort((a, b) => POSITION_ORDER.indexOf(a.position) - POSITION_ORDER.indexOf(b.position))

  const starting = players.filter(p => p.slot_type === "starting")
  // Bench is ordered by the priority this gameweek actually scored against,
  // so it reads the same way round as the roster view's bench. Gameweeks
  // scored before bench_order was recorded have null throughout and keep the
  // position ordering from the sort above — `?? Infinity` would otherwise
  // scramble a partially-null set, but a gameweek is all-or-nothing here.
  const bench = players
    .filter(p => p.slot_type === "bench")
    .sort((a, b) => (a.bench_order ?? Number.MAX_SAFE_INTEGER) - (b.bench_order ?? Number.MAX_SAFE_INTEGER))
  const team_total = players.filter(p => p.counted).reduce((s, p) => s + p.points, 0) + (points_penalty ?? 0)

  return { gameweek: gw, team_total, points_penalty, starting, bench }
}
