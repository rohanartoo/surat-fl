"use client"

import { useState, useEffect } from "react"
import { useAuction } from "./AuctionProvider"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

type StagedTeam = {
  team_id: string
  display_name: string
  short_name: string
  color: string
  drops: { player_id: number; web_name: string; position: string }[]
}

/**
 * Read-only, all-roles view of every team's staged drops for the current
 * auction — so teams can see who's dropped what (and infer remaining
 * budget/roster shape) before an auction locks those drops in. Visible from
 * the moment the auction master creates the auction (pending) through when
 * it's live (active), since drops can be staged in either state.
 */
export function StagedDropsPanel() {
  const { auction } = useAuction()
  const [stagedDropTeams, setStagedDropTeams] = useState<StagedTeam[]>([])

  // Eligibility is derived at render time from the current auction, not
  // stored in state — the effect below only ever sets fetched data, never
  // resets it, so stale data from a previous auction simply never renders
  // once eligible flips false (avoids setState-in-effect on the "skip" path).
  const eligible = !!auction && auction.type !== "initial" && ["pending", "active"].includes(auction.status)

  useEffect(() => {
    if (!eligible || !auction) return
    const controller = new AbortController()
    fetch("/api/drops/staged-detail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auction_id: auction.id }),
      signal: controller.signal,
    })
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (data) setStagedDropTeams(data.teams ?? []) })
      .catch(e => { if (e?.name !== "AbortError") console.error("Failed to fetch staged drops:", e) })
    return () => controller.abort()
  }, [eligible, auction?.id])

  if (!eligible || stagedDropTeams.length === 0) return null

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">
          Staged drops ({stagedDropTeams.reduce((s, t) => s + t.drops.length, 0)} total)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {stagedDropTeams.map(team => (
          <div key={team.team_id} className="rounded bg-secondary/40 px-2 py-1.5">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: team.color }} />
                <span className="text-xs font-medium">{team.short_name}</span>
              </div>
              <Badge variant="secondary" className="text-[10px] h-4 px-1 tabular-nums">{team.drops.length}</Badge>
            </div>
            <div className="space-y-0.5 pl-3.5">
              {team.drops.map(p => (
                <div key={p.player_id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="font-mono text-[10px] text-muted-foreground/60 uppercase w-7">{p.position}</span>
                  <span>{p.web_name}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
