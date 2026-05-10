import type { FplBootstrap, FplPlayer } from "@/types"
import { positionLabel } from "@/lib/utils"

const FPL_BASE = "https://fantasy.premierleague.com/api"

export interface FplLiveStats {
  minutes: number
  total_points: number
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
    base_price: 1, // starts at £1m; updated when a player is won at auction
    fpl_cost: player.now_cost / 10,
    status: player.status,
    news: player.news,
    updated_at: new Date().toISOString(),
  }
}
