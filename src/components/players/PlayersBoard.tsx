"use client"

import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PlayerListRow } from "./PlayerListRow"
import { SORT_OPTIONS, sortPlayers, type SortKey } from "@/lib/player-sort"
import { POSITION_ORDER } from "@/lib/auction-engine"
import type { PlayerOwner } from "@/lib/drops"
import type { Player, Position } from "@/types"

/**
 * Scouting view of the whole player pool, one tab per position. All state
 * (tab, search, sort, hide-drafted, expanded row) is local to the viewer.
 * Ownership comes pre-resolved from the server with staged drops already
 * masked for viewers who mustn't see them.
 */
export function PlayersBoard({
  players,
  owners,
}: {
  players: Player[]
  owners: Record<number, PlayerOwner>
}) {
  const [position, setPosition] = useState<Position>("GK")
  const [search, setSearch] = useState("")
  const [sortBy, setSortBy] = useState<SortKey>("tsb")
  // On by default: scouting is mostly about players you could actually bid on.
  const [hideDrafted, setHideDrafted] = useState(true)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const byPosition = useMemo(() => {
    const q = search.toLowerCase()
    const groups: Record<Position, Player[]> = { GK: [], DEF: [], MID: [], FWD: [] }
    for (const p of players) {
      if (hideDrafted && owners[p.id]) continue
      if (q && !p.web_name.toLowerCase().includes(q) && !p.fpl_team_short.toLowerCase().includes(q)) continue
      groups[p.position]?.push(p)
    }
    for (const pos of POSITION_ORDER) sortPlayers(groups[pos], sortBy)
    return groups
  }, [players, owners, search, sortBy, hideDrafted])

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3 space-y-3">
        <Input
          placeholder="Search player or club…"
          className="h-8 text-sm"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1" role="group" aria-label="Sort players">
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
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-emerald-500 cursor-pointer"
              checked={hideDrafted}
              onChange={e => setHideDrafted(e.target.checked)}
            />
            Hide drafted players
          </label>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <Tabs value={position} onValueChange={v => setPosition(v as Position)}>
          <div className="px-4 pb-3">
            <TabsList className="grid w-full grid-cols-4">
              {POSITION_ORDER.map(pos => (
                <TabsTrigger key={pos} value={pos} className="text-xs gap-1.5">
                  {pos}
                  <span className="font-mono text-[10px] text-muted-foreground">{byPosition[pos].length}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {POSITION_ORDER.map(pos => (
            <TabsContent key={pos} value={pos} className="mt-0 border-t border-border/30">
              {byPosition[pos].length === 0 ? (
                <p className="text-sm text-muted-foreground italic px-4 py-6 text-center">No players match.</p>
              ) : (
                <div className="divide-y divide-border/30">
                  {byPosition[pos].map(player => {
                    const owner = owners[player.id]
                    return (
                      <PlayerListRow
                        key={player.id}
                        player={player}
                        sortBy={sortBy}
                        isExpanded={expandedId === player.id}
                        onToggle={() => setExpandedId(expandedId === player.id ? null : player.id)}
                        muted={!!owner}
                        tag={owner && <OwnerTag owner={owner} />}
                      />
                    )
                  })}
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  )
}

function OwnerTag({ owner }: { owner: PlayerOwner }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-px text-[10px] font-medium text-muted-foreground shrink-0"
      title={owner.staged ? `Staged drop by ${owner.short_name}` : `Drafted by ${owner.short_name}`}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: owner.color }} />
      {owner.short_name}
      {owner.staged && <span className="text-amber-500">· staged drop</span>}
    </span>
  )
}
