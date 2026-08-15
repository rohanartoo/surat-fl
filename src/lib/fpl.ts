import type { SupabaseClient } from "@supabase/supabase-js"
import type { FplBootstrap, FplPlayer } from "@/types"
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
}

export async function fetchFplLive(gw: number): Promise<Record<number, FplLiveStats>> {
  const res = await fetch(`${FPL_BASE}/event/${gw}/live/`, {
    headers: { "User-Agent": "Mozilla/5.0" },
    cache: "no-store",
  })
  if (!res.ok) throw new Error(`FPL live API error: ${res.status}`)
  const data: { elements: { id: number; stats: FplLiveStats }[] } = await res.json()
  return Object.fromEntries(data.elements.map(e => [e.id, e.stats]))
}

export async function fetchFplBootstrap(): Promise<FplBootstrap> {
  const res = await fetch(`${FPL_BASE}/bootstrap-static/`, {
    headers: { "User-Agent": "Mozilla/5.0" },
    next: { revalidate: 3600 },
  })
  if (!res.ok) throw new Error(`FPL API error: ${res.status}`)
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

/**
 * Fetches the current FPL bootstrap data and upserts every player (points,
 * selected_by_percent, status/news, etc. — never base_price, see
 * mapFplPlayer's comment), then prunes any player no longer in FPL's feed.
 * Shared by the cron-triggered /api/fpl/sync route and the AM/admin-triggered
 * manual sync action, so both paths do exactly the same work.
 */
export async function syncFplPlayers(supabase: SupabaseClient): Promise<{ synced: number; pruned: number }> {
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
