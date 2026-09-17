"use client"

import { useState, useMemo } from "react"
import { useAuction } from "./AuctionProvider"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn, formatMoney, positionColor, statusColor, statusLabel } from "@/lib/utils"
import { PositionBadge } from "@/components/ui/PositionBadge"
import { PlayerStatsDialog } from "./PlayerStatsDialog"
import { roleIsAM } from "@/lib/role-utils"
import type { Player, Position } from "@/types"

// Per-viewer display order only — never persisted or shared, so it can't
// change what anyone else (including the AM) sees. "tsb" matches the
// server's selected_by_percent order, so the default view is unchanged.
type SortKey = "tsb" | "points" | "price"

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "tsb",    label: "Selected %" },
  { key: "points", label: "Points" },
  { key: "price",  label: "Price" },
]

function sortValue(player: Player, key: SortKey): number {
  if (key === "points") return player.total_points
  if (key === "price") return player.base_price
  return player.selected_by_percent
}

export function PlayerSelectionPanel() {
  const { auction, currentLot, availablePlayers, myRole, refresh } = useAuction()
  const [search, setSearch] = useState("")
  const [opening, setOpening] = useState<number | null>(null)
  const [sortBy, setSortBy] = useState<SortKey>("tsb")
  const [viewing, setViewing] = useState<Player | null>(null)

  const isAM = roleIsAM(myRole)
  const currentPosition = auction?.current_position_category as Position | null
  const hasOpenLot = currentLot !== null && currentLot.phase !== "concluded"

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    const matches = availablePlayers.filter(p => {
      if (currentPosition && p.position !== currentPosition) return false
      if (!q) return true
      return (
        p.web_name.toLowerCase().includes(q) ||
        p.fpl_team_short.toLowerCase().includes(q)
      )
    })
    if (sortBy === "tsb") return matches
    return matches.sort((a, b) =>
      sortValue(b, sortBy) - sortValue(a, sortBy) ||
      b.selected_by_percent - a.selected_by_percent
    )
  }, [availablePlayers, currentPosition, search, sortBy])

  async function openLot(playerId: number) {
    if (!auction) return
    setOpening(playerId)
    try {
      const res = await fetch("/api/auction/open-lot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auction_id: auction.id, player_id: playerId }),
      })
      if (!res.ok) {
        const data = await res.json()
        alert(data.error ?? "Failed to open lot.")
        return
      }
      await refresh()
    } finally {
      setOpening(null)
    }
  }

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            Available Players
            {currentPosition && (
              <span className={cn("ml-2 text-sm font-normal", positionColor(currentPosition))}>
                — {currentPosition}
              </span>
            )}
          </CardTitle>
          <Badge variant="secondary" className="font-mono text-xs">
            {filtered.length}
          </Badge>
        </div>
        <Input
          placeholder="Search player or club…"
          className="h-8 text-sm mt-2"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="flex items-center gap-1 mt-2" role="group" aria-label="Sort players">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">Sort</span>
          {SORT_OPTIONS.map(({ key, label }) => (
            <Button
              key={key}
              size="sm"
              variant={sortBy === key ? "secondary" : "ghost"}
              className="h-6 text-xs px-2"
              aria-pressed={sortBy === key}
              onClick={() => setSortBy(key)}
            >
              {label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-[480px] overflow-y-auto divide-y divide-border/30">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground italic px-4 py-6 text-center">
              No available players.
            </p>
          ) : (
            filtered.map(player => (
              <PlayerRow
                key={player.id}
                player={player}
                isAM={isAM}
                canOpen={isAM && !hasOpenLot && auction?.status === "active"}
                isOpening={opening === player.id}
                onOpen={() => openLot(player.id)}
                onView={() => setViewing(player)}
              />
            ))
          )}
        </div>
      </CardContent>
      <PlayerStatsDialog
        player={viewing}
        onOpenChange={open => { if (!open) setViewing(null) }}
      />
    </Card>
  )
}

function PlayerRow({
  player,
  isAM,
  canOpen,
  isOpening,
  onOpen,
  onView,
}: {
  player: Player
  isAM: boolean
  canOpen: boolean
  isOpening: boolean
  onOpen: () => void
  onView: () => void
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 hover:bg-accent/40 transition-colors group">
      <button
        type="button"
        className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer focus-visible:outline-none focus-visible:underline"
        onClick={onView}
        title="View stats"
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
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{player.fpl_team_short}</p>
        </div>
      </button>
      <div className="flex items-center gap-3 shrink-0 ml-2">
        <span className="text-[10px] font-mono text-muted-foreground/60" title="Selected by (FPL)">
          {player.selected_by_percent}%
        </span>
        <span className="text-xs font-mono text-muted-foreground">
          {formatMoney(player.base_price)}
        </span>
        {canOpen && (
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-xs px-2 opacity-0 group-hover:opacity-100 transition-opacity"
            disabled={isOpening}
            onClick={e => { e.stopPropagation(); onOpen() }}
          >
            {isOpening ? "…" : "Nominate"}
          </Button>
        )}
      </div>
    </div>
  )
}
