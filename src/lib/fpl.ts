import type { SupabaseClient } from "@supabase/supabase-js"
import type { FplBootstrap, FplPlayer, FplFixture, FplExplainFixture } from "@/types"
import { positionLabel } from "@/lib/utils"

const FPL_BASE = "https://fantasy.premierleague.com/api"

export interface FplLiveStats {
  minutes: number
  total_points: number
  goals_scored: number
  assists: number
  clean_sheets: number
  goals_conceded: number
  own_goals: number
  penalties_saved: number
  penalties_missed: number
  yellow_cards: number
  red_cards: number
  saves: number
  bonus: number
  // Raw defensive-actions count — see the matching comment on
  // GameweekStatBreakdown.defensive_contribution (src/types/index.ts).
  // Optional here too so existing test fixtures/call sites that predate
  // this field don't all need updating for an unrelated stat.
  defensive_contribution?: number
  // FPL's own pre-computed points breakdown — see FplExplainFixture and
  // src/lib/points-breakdown.ts. Lives alongside `stats` (not inside it) in
  // FPL's raw response, merged in here so the whole thing can be stored
  // as-is into gameweek_points.stat_breakdown. Optional so existing test
  // fixtures/call sites unrelated to the breakdown feature don't all need
  // updating.
  explain?: FplExplainFixture[]
}

export async function fetchFplLive(gw: number): Promise<Record<number, FplLiveStats>> {
  const res = await fetch(`${FPL_BASE}/event/${gw}/live/`, {
    headers: { "User-Agent": "Mozilla/5.0" },
    cache: "no-store",
  })
  if (!res.ok) throw new Error(`FPL live API error: ${res.status}`)
  const data: { elements: { id: number; stats: Omit<FplLiveStats, "explain">; explain: FplExplainFixture[] }[] } = await res.json()
  return Object.fromEntries(data.elements.map(e => [e.id, { ...e.stats, explain: e.explain }]))
}

export async function fetchFplBootstrap(): Promise<FplBootstrap> {
  const res = await fetch(`${FPL_BASE}/bootstrap-static/`, {
    headers: { "User-Agent": "Mozilla/5.0" },
    next: { revalidate: 3600 },
  })
  if (!res.ok) throw new Error(`FPL API error: ${res.status}`)
  return res.json()
}

export async function fetchFplFixtures(): Promise<FplFixture[]> {
  const res = await fetch(`${FPL_BASE}/fixtures/`, {
    headers: { "User-Agent": "Mozilla/5.0" },
    next: { revalidate: 3600 },
  })
  if (!res.ok) throw new Error(`FPL fixtures API error: ${res.status}`)
  return res.json()
}

/**
 * Returns the current gameweek number, or null if no gameweek is currently active.
 * Uses bootstrap-static events — finds the event where is_current is true.
 */
export async function fetchCurrentGameweek(): Promise<number | null> {
  try {
    const bootstrap = await fetchFplBootstrap()
    const current = bootstrap.events.find(e => e.is_current)
    return current?.id ?? null
  } catch {
    return null
  }
}

export function mapFplPlayer(player: FplPlayer, teamMap: Record<number, { name: string; short_name: string }>) {
  return {
    id: player.id,
    first_name: player.first_name,
    second_name: player.second_name,
    web_name: player.web_name,
    position: positionLabel(player.element_type),
    fpl_team: teamMap[player.team]?.name ?? "",
    fpl_team_short: teamMap[player.team]?.short_name ?? "",
    selected_by_percent: parseFloat(player.selected_by_percent),
    total_points: player.total_points,
    goals_scored: player.goals_scored,
    assists: player.assists,
    clean_sheets: player.clean_sheets,
    bonus: player.bonus,
    yellow_cards: player.yellow_cards,
    red_cards: player.red_cards,
    minutes: player.minutes,
    // base_price is deliberately NOT set here. This object is upserted on
    // conflict, so including it would reset every player's auction-won price
    // back to £1m on every FPL refresh — wiping the opening-bid floors that
    // later auctions depend on. New rows get £1m from the column default;
    // existing rows keep whatever the last auction set. Season rollover
    // resets prices explicitly in /api/admin/reset.
    fpl_cost: player.now_cost / 10,
    status: player.status,
    news: player.news,
    updated_at: new Date().toISOString(),
  }
}

// rpc_prune_stale_players only protects a player from deletion if it has
// roster/auction/drop/scoring history — pre-auction, nobody has any of
// that, so a single incomplete/truncated FPL fetch (rate limit, network
// hiccup — anything short of an outright HTTP error, which is all
// fetchFplBootstrap checks for) would otherwise delete real players it
// just didn't happen to see this time, with nothing to stop it. Skip
// pruning if the new sync is suspiciously smaller than what's already
// stored, rather than trusting a single fetch unconditionally.
const PRUNE_SAFETY_THRESHOLD = 0.9

/**
 * Fetches the current FPL bootstrap data and upserts every player (points,
 * selected_by_percent, status/news, etc. — never base_price, see
 * mapFplPlayer's comment), then prunes any player no longer in FPL's feed
 * (unless the sync looks anomalously incomplete — see PRUNE_SAFETY_THRESHOLD).
 * Shared by the cron-triggered /api/fpl/sync route and the AM/admin-triggered
 * manual sync action, so both paths do exactly the same work.
 */
export async function syncFplPlayers(supabase: SupabaseClient): Promise<{
  synced: number
  pruned: number
  pruneSkipped?: boolean
  warning?: string
}> {
  const { count: beforeCount } = await supabase
    .from("players")
    .select("id", { count: "exact", head: true })

  const bootstrap = await fetchFplBootstrap()

  const teamMap = bootstrap.teams.reduce<Record<number, { name: string; short_name: string }>>(
    (acc, t) => { acc[t.id] = { name: t.name, short_name: t.short_name }; return acc },
    {}
  )

  const players = bootstrap.elements.map((p) => mapFplPlayer(p, teamMap))

  const batchSize = 500
  for (let i = 0; i < players.length; i += batchSize) {
    const batch = players.slice(i, i + batchSize)
    const { error } = await supabase.from("players").upsert(batch, { onConflict: "id" })
    if (error) {
      console.error("[syncFplPlayers] upsert error:", JSON.stringify(error))
      throw error
    }
  }

  if (beforeCount !== null && beforeCount > 50 && players.length < beforeCount * PRUNE_SAFETY_THRESHOLD) {
    const warning = `Sync returned ${players.length} players, well below the ${beforeCount} already stored. Skipped removing any players this time to avoid deleting real ones — try syncing again, and only investigate further if it stays low.`
    console.warn("[syncFplPlayers]", warning)
    return { synced: players.length, pruned: 0, pruneSkipped: true, warning }
  }

  // Remove any player no longer in FPL's feed (reissued element ids,
  // relegated/departed clubs) — see 20260726000001_prune_stale_players.sql.
  // Never touches a player with any roster/auction/drop/scoring history.
  const currentIds = players.map((p) => p.id)
  const { data: pruneResult, error: pruneErr } = await supabase
    .rpc("rpc_prune_stale_players", { p_current_ids: currentIds })
    .single()
  if (pruneErr) {
    console.error("[syncFplPlayers] prune error:", JSON.stringify(pruneErr))
    throw pruneErr
  }

  return { synced: players.length, pruned: (pruneResult as { pruned: number }).pruned }
}

/**
 * Fetches FPL's current fixture list and upserts every fixture (team names
 * denormalized onto the row so joining against players.fpl_team is a plain
 * string match — see 20260816000000_fixtures.sql). No prune step: unlike
 * player elements, FPL's fixture list doesn't shrink between syncs.
 */
export async function syncFixtures(supabase: SupabaseClient): Promise<{ synced: number }> {
  const [bootstrap, fixtures] = await Promise.all([fetchFplBootstrap(), fetchFplFixtures()])

  const teamMap = bootstrap.teams.reduce<Record<number, { name: string; short_name: string }>>(
    (acc, t) => { acc[t.id] = { name: t.name, short_name: t.short_name }; return acc },
    {}
  )

  const rows = fixtures.map((f) => ({
    id: f.id,
    event: f.event,
    team_h_name: teamMap[f.team_h]?.name ?? "",
    team_a_name: teamMap[f.team_a]?.name ?? "",
    team_h_short: teamMap[f.team_h]?.short_name ?? "",
    team_a_short: teamMap[f.team_a]?.short_name ?? "",
    kickoff_time: f.kickoff_time,
    finished: f.finished,
  }))

  const batchSize = 500
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    const { error } = await supabase.from("fixtures").upsert(batch, { onConflict: "id" })
    if (error) {
      console.error("[syncFixtures] upsert error:", JSON.stringify(error))
      throw error
    }
  }

  return { synced: rows.length }
}

/**
 * Maps each PL club to its opponent(s) in the next gameweek that hasn't
 * finished yet — deliberately distinct from fetchCurrentGameweek(), which
 * drives GameweekPerformance's past-results default view. An array handles
 * the rare double-gameweek case; a club with no entry has a blank gameweek.
 */
export async function getUpcomingOpponents(
  supabase: SupabaseClient
): Promise<Record<string, { opponent_short: string; is_home: boolean }[]>> {
  const { data: nextRow } = await supabase
    .from("fixtures")
    .select("event")
    .eq("finished", false)
    .not("event", "is", null)
    .order("event", { ascending: true })
    .limit(1)
    .maybeSingle()

  const byTeam: Record<string, { opponent_short: string; is_home: boolean }[]> = {}
  const nextEvent = (nextRow as { event: number } | null)?.event
  if (nextEvent === undefined || nextEvent === null) return byTeam

  const { data: fixturesData } = await supabase
    .from("fixtures")
    .select("team_h_name, team_a_name, team_h_short, team_a_short")
    .eq("event", nextEvent)

  for (const f of (fixturesData ?? []) as { team_h_name: string; team_a_name: string; team_h_short: string; team_a_short: string }[]) {
    (byTeam[f.team_h_name] ??= []).push({ opponent_short: f.team_a_short, is_home: true })
    ;(byTeam[f.team_a_name] ??= []).push({ opponent_short: f.team_h_short, is_home: false })
  }

  return byTeam
}
