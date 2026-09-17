import type { Player } from "@/types"

// Per-viewer display order only — never persisted or shared, so it can't
// change what anyone else (including the AM) sees. "tsb" matches the
// server's selected_by_percent order, so the default view is unchanged.
export type SortKey = "tsb" | "points" | "price"

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "tsb",    label: "Selected %" },
  { key: "points", label: "Points" },
  { key: "price",  label: "Price" },
]

function sortValue(player: Player, key: SortKey): number {
  if (key === "points") return player.total_points
  if (key === "price") return player.base_price
  return player.selected_by_percent
}

/**
 * Orders a player list for display. "tsb" keeps the given order (callers
 * fetch by selected_by_percent already); points/price sort descending, with
 * selected-by % as the tie-break. Sorts in place and returns the same array —
 * pass a copy (e.g. the result of .filter) if the input must not change.
 */
export function sortPlayers<T extends Player>(players: T[], key: SortKey): T[] {
  if (key === "tsb") return players
  return players.sort((a, b) =>
    sortValue(b, key) - sortValue(a, key) ||
    b.selected_by_percent - a.selected_by_percent
  )
}
