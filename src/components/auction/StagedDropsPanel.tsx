"use client"

import { useState, useEffect } from "react"
import { useAuction } from "./AuctionProvider"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { roleIsAM } from "@/lib/role-utils"

type StagedTeam = {
  team_id: string
  display_name: string
  short_name: string
  color: string
  drops: { player_id: number; web_name: string; position: string }[]
}

/**
 * Read-only view of every team's staged drops for the current auction —
 * AM/admin only. Teams and guests must not see other teams' drops before the
 * auction starts and locks them in (it would hand some teams a competitive
 * edge), so the panel doesn't render or fetch for them, and the
 * staged-detail endpoint rejects them too. See canSeeStagedDrops in
 * src/lib/drops.ts.
 */
export function StagedDropsPanel() {
  const { auction, myRole } = useAuction()
  const [stagedDropTeams, setStagedDropTeams] = useState<StagedTeam[]>([])

  // Eligibility is derived at render time from the current auction, not
  // stored in state — the effect below only ever sets fetched data, never
  // resets it, so stale data from a previous auction simply never renders
  // once eligible flips false (avoids setState-in-effect on the "skip" path).
  const eligible = roleIsAM(myRole) && !!auction && auction.type !== "initial" && ["pending", "active"].includes(auction.status)

  useEffect(() => {
    if (!eligible || !auction) return
    const controller = new AbortController()

    async function load() {
      try {
        const res = await fetch("/api/drops/staged-detail", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ auction_id: auction!.id }),
          signal: controller.signal,
        })
        if (!res.ok) return
        const data = await res.json()
        setStagedDropTeams(data.teams ?? [])
      } catch (e) {
        if ((e as { name?: string })?.name !== "AbortError") console.error("Failed to fetch staged drops:", e)
      }
    }

    load()

    const supabase = createClient()
    const channel = supabase
      .channel("staged-drops")
      .on("postgres_changes", { event: "*", schema: "public", table: "team_drops" }, () => load())
      .subscribe()

    return () => {
      controller.abort()
      supabase.removeChannel(channel)
    }
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
