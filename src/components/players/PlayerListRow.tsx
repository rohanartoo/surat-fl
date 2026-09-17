"use client"

import type { ReactNode } from "react"
import { PositionBadge } from "@/components/ui/PositionBadge"
import { PlayerStatsPanel } from "./PlayerStatsPanel"
import { cn, formatMoney, statusColor, statusLabel } from "@/lib/utils"
import type { SortKey } from "@/lib/player-sort"
import type { Player } from "@/types"

/**
 * One player in a scrollable/scannable list, with view-only stats that
 * expand accordion-style underneath when the row is clicked. Shared by the
 * auction pool and the Players scouting page; the callers own which row is
 * expanded, so only one opens at a time.
 */
export function PlayerListRow({
  player,
  sortBy,
  isExpanded,
  onToggle,
  tag,
  actions,
  muted = false,
}: {
  player: Player
  sortBy: SortKey
  isExpanded: boolean
  onToggle: () => void
  /** Shown beside the name — e.g. the owning team on the Players page. */
  tag?: ReactNode
  /** Trailing controls — e.g. the AM's Nominate button on the auction page. */
  actions?: ReactNode
  /** De-emphasise the row (e.g. already drafted) without hiding it. */
  muted?: boolean
}) {
  return (
    <>
      <div data-player-id={player.id} className={cn(
        "flex items-center justify-between px-4 py-2.5 hover:bg-accent/40 transition-colors group",
        isExpanded && "bg-accent/60 hover:bg-accent/60",
      )}>
        <button
          type="button"
          className={cn(
            "flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer focus-visible:outline-none focus-visible:underline",
            muted && !isExpanded && "opacity-60",
          )}
          onClick={onToggle}
          aria-expanded={isExpanded}
          title={isExpanded ? "Hide stats" : "View stats"}
        >
          <PositionBadge position={player.position} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-medium leading-none truncate">{player.web_name}</p>
              {player.status !== "a" && (
                <span className={cn("text-[10px] font-medium", statusColor(player.status))}>
                  {statusLabel(player.status)}
                </span>
              )}
              {tag}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{player.fpl_team_short}</p>
          </div>
        </button>
        <div className="flex items-center gap-3 shrink-0 ml-2">
          {/* The figure the list is sorted by — FPL season points when sorting
              by Points, otherwise selected-by % (price is always shown). */}
          {sortBy === "points" ? (
            <span className="text-xs font-mono font-semibold" title="Total FPL points this season">
              {player.total_points} pts
            </span>
          ) : (
            <span className="text-[10px] font-mono text-muted-foreground/60" title="Selected by (FPL)">
              {player.selected_by_percent}%
            </span>
          )}
          <span className="text-xs font-mono text-muted-foreground">
            {formatMoney(player.base_price)}
          </span>
          {actions}
        </div>
      </div>
      {isExpanded && (
        <div className="bg-accent/20 px-3 py-2.5">
          <PlayerStatsPanel player={player} />
        </div>
      )}
    </>
  )
}
