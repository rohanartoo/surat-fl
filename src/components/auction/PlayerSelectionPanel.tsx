"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useAuction } from "./AuctionProvider"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn, positionColor } from "@/lib/utils"
import { PlayerListRow } from "@/components/players/PlayerListRow"
import { SORT_OPTIONS, sortPlayers, type SortKey } from "@/lib/player-sort"
import { roleIsAM } from "@/lib/role-utils"
import type { Player, Position } from "@/types"

export function PlayerSelectionPanel() {
  const { auction, currentLot, availablePlayers, myRole, refresh } = useAuction()
  const [search, setSearch] = useState("")
  const [opening, setOpening] = useState<number | null>(null)
  const [sortBy, setSortBy] = useState<SortKey>("tsb")
  const [viewing, setViewing] = useState<Player | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const viewingId = viewing?.id ?? null

  // Stats expand under the clicked row inside the scrolling list, so align
  // that row to the top of the list to keep the expanded stats in view.
  // Scrolls only the list container, never the page.
  useEffect(() => {
    const list = listRef.current
    if (viewingId === null || !list) return
    const row = list.querySelector<HTMLElement>(`[data-player-id="${viewingId}"]`)
    if (!row) return
    const offset = row.getBoundingClientRect().top - list.getBoundingClientRect().top
    list.scrollTo({ top: list.scrollTop + offset, behavior: "smooth" })
  }, [viewingId])

  const isAM = roleIsAM(myRole)
  const currentPosition = auction?.current_position_category as Position | null
  const hasOpenLot = currentLot !== null && currentLot.phase !== "concluded"

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return sortPlayers(availablePlayers.filter(p => {
      if (currentPosition && p.position !== currentPosition) return false
      if (!q) return true
      return (
        p.web_name.toLowerCase().includes(q) ||
        p.fpl_team_short.toLowerCase().includes(q)
      )
    }), sortBy)
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
        <Link href="/players" className="text-xs text-muted-foreground hover:text-emerald-500 transition-colors w-fit">
          Scout all positions →
        </Link>
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
        <div ref={listRef} className="max-h-[480px] overflow-y-auto divide-y divide-border/30">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground italic px-4 py-6 text-center">
              No available players.
            </p>
          ) : (
            filtered.map(player => (
              <PlayerListRow
                key={player.id}
                player={player}
                sortBy={sortBy}
                isExpanded={viewingId === player.id}
                onToggle={() => setViewing(viewingId === player.id ? null : player)}
                actions={isAM && !hasOpenLot && auction?.status === "active" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-xs px-2 opacity-0 group-hover:opacity-100 transition-opacity"
                    disabled={opening === player.id}
                    onClick={e => { e.stopPropagation(); openLot(player.id) }}
                  >
                    {opening === player.id ? "…" : "Nominate"}
                  </Button>
                )}
              />
            ))
          )}
        </div>
      </CardContent>
    </Card>
  )
}
