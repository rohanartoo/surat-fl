"use client"

import { useRef, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { PositionBadge } from "@/components/ui/PositionBadge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import type { TeamGameweekPerformance } from "@/lib/scoring"

const SEASON_LENGTH = 38

const STAT_LABELS: { key: keyof NonNullable<TeamGameweekPerformance["players"][number]["stat_breakdown"]>; label: string }[] = [
  { key: "goals_scored", label: "Goals" },
  { key: "assists", label: "Assists" },
  { key: "clean_sheets", label: "Clean sheet" },
  { key: "goals_conceded", label: "Conceded" },
  { key: "own_goals", label: "Own goals" },
  { key: "penalties_saved", label: "Pens saved" },
  { key: "penalties_missed", label: "Pens missed" },
  { key: "saves", label: "Saves" },
  { key: "bonus", label: "Bonus" },
  { key: "yellow_cards", label: "Yellow" },
  { key: "red_cards", label: "Red" },
]

async function fetchPerformance(teamId: string, gw: number): Promise<TeamGameweekPerformance | null> {
  const res = await fetch("/api/scoring/team-gameweek", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ team_id: teamId, gameweek: gw }),
  })
  if (!res.ok) return null
  return res.json()
}

interface Props {
  teamId: string
  currentGw: number
  initialGw: number
  initialData: TeamGameweekPerformance | null
}

export function GameweekPerformance({ teamId, currentGw, initialGw, initialData }: Props) {
  const [selectedGw, setSelectedGw] = useState(initialGw)
  const [data, setData] = useState<TeamGameweekPerformance | null>(initialData)
  const [loading, setLoading] = useState(false)
  // Ignore a slow response if the user has since picked a different GW.
  const latestRequestGw = useRef(initialGw)

  async function handleGwChange(gw: number) {
    setSelectedGw(gw)
    latestRequestGw.current = gw

    setLoading(true)
    try {
      const result = await fetchPerformance(teamId, gw)
      if (latestRequestGw.current === gw) setData(result)
    } catch (e) {
      console.error("Failed to fetch GW performance:", e)
    } finally {
      if (latestRequestGw.current === gw) setLoading(false)
    }
  }

  const autoSubs = (data?.players ?? []).filter(p => p.was_subbed_in)

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base">Gameweek Performance</CardTitle>
        <Select value={String(selectedGw)} onValueChange={v => handleGwChange(Number(v))}>
          <SelectTrigger className="w-28 h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: SEASON_LENGTH }, (_, i) => i + 1).map(gw => (
              <SelectItem key={gw} value={String(gw)} disabled={gw > currentGw}>
                GW {gw}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground italic py-4 text-center">Loading…</p>
        ) : !data || data.players.length === 0 ? (
          <p className="text-sm text-muted-foreground italic py-4 text-center">
            No scoring data for GW {selectedGw} yet.
          </p>
        ) : (
          <>
            <div className="flex items-baseline justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Team total</p>
              <p className="text-2xl font-semibold font-mono">{data.team_total}</p>
            </div>

            <div className="space-y-1">
              {data.players.map(p => (
                <PlayerPointsRow key={p.player_id} player={p} />
              ))}
            </div>

            {autoSubs.length > 0 && (
              <div className="space-y-1.5 pt-2 border-t border-border/40">
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Auto-subs</p>
                {autoSubs.map(p => (
                  <p key={p.player_id} className="text-xs text-muted-foreground">
                    <span className="text-foreground font-medium">{p.web_name}</span>
                    {" came on for "}
                    <span className="text-foreground font-medium">{p.subbed_out_web_name ?? "unknown player"}</span>
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function PlayerPointsRow({ player }: { player: TeamGameweekPerformance["players"][number] }) {
  const breakdown = player.stat_breakdown
  const activeStats = breakdown
    ? STAT_LABELS.filter(({ key }) => {
        const value = breakdown[key]
        return key === "clean_sheets" ? value > 0 : (value as number) > 0
      })
    : []

  return (
    <div className={cn(
      "flex items-center justify-between py-2 px-2.5 rounded-md",
      player.is_captain && "bg-amber-500/10 ring-1 ring-amber-500/30",
    )}>
      <div className="flex items-center gap-2.5 min-w-0">
        <PositionBadge position={player.position} />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium truncate">{player.web_name}</p>
            {player.is_captain && (
              <Badge variant="secondary" className="text-[10px] h-4 px-1 py-0 uppercase bg-amber-500/20 text-amber-600 border-0">
                C ×2
              </Badge>
            )}
            {player.was_subbed_in && (
              <Badge variant="outline" className="text-[10px] h-4 px-1 py-0 text-emerald-500 border-emerald-500/30">
                Sub
              </Badge>
            )}
          </div>
          {activeStats.length > 0 ? (
            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
              {activeStats.map(({ key, label }) => `${label}${breakdown![key] > 1 ? ` ×${breakdown![key]}` : ""}`).join(" · ")}
            </p>
          ) : breakdown ? (
            <p className="text-[11px] text-muted-foreground/70 mt-0.5 italic">
              {breakdown.minutes > 0 ? `${breakdown.minutes} mins` : "Did not play"}
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground/50 mt-0.5 italic">No detailed breakdown available</p>
          )}
        </div>
      </div>
      <span className="text-sm font-mono font-semibold shrink-0 ml-2">{player.points}</span>
    </div>
  )
}
