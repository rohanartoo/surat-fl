"use client"

import { useState, useMemo } from "react"
import { useAuction } from "./AuctionProvider"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn, formatMoney, positionColor, statusColor, statusLabel } from "@/lib/utils"
import { PositionBadge } from "@/components/ui/PositionBadge"
import { roleIsAM } from "@/lib/role-utils"
import type { Player, Position } from "@/types"

export function PlayerSelectionPanel() {
  const { auction, currentLot, availablePlayers, myRole, refresh } = useAuction()
  const [search, setSearch] = useState("")
  const [opening, setOpening] = useState<number | null>(null)

  const isAM = roleIsAM(myRole)
  const currentPosition = auction?.current_position_category as Position | null
  const hasOpenLot = currentLot !== null && currentLot.phase !== "concluded"

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return availablePlayers.filter(p => {
      if (currentPosition && p.position !== currentPosition) return false
      if (!q) return true
      return (
        p.web_name.toLowerCase().includes(q) ||
        p.fpl_team_short.toLowerCase().includes(q)
      )
    })
  }, [availablePlayers, currentPosition, search])

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
              />
            ))
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function PlayerRow({
  player,
  isAM,
  canOpen,
  isOpening,
  onOpen,
}: {
  player: Player
  isAM: boolean
  canOpen: boolean
  isOpening: boolean
  onOpen: () => void
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 hover:bg-accent/40 transition-colors group">
      <div className="flex items-center gap-3 min-w-0">
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
      </div>
      <div className="flex items-center gap-3 shrink-0 ml-2">
        <span className="text-xs font-mono text-muted-foreground">
          {formatMoney(player.base_price)}
        </span>
        {canOpen && (
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-xs px-2 opacity-0 group-hover:opacity-100 transition-opacity"
            disabled={isOpening}
            onClick={onOpen}
          >
            {isOpening ? "…" : "Nominate"}
          </Button>
        )}
      </div>
    </div>
  )
}
