import type { FplBootstrap, FplPlayer } from "@/types"
import { positionLabel } from "@/lib/utils"

const FPL_BASE = "https://fantasy.premierleague.com/api"

export async function fetchFplBootstrap(): Promise<FplBootstrap> {
  const res = await fetch(`${FPL_BASE}/bootstrap-static/`, {
    next: { revalidate: 3600 }, // cache for 1 hour
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
    fpl_cost: player.now_cost / 10,
    status: player.status,
    news: player.news,
    updated_at: new Date().toISOString(),
  }
}
