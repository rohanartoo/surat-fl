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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { TeamGameweekPerformance } from "@/lib/scoring"
import { SQUAD_RULES } from "@/types"

const SEASON_LENGTH = 38

// Fallback-only now (see PlayerPointsRow) — used when a player has a
// stat_breakdown but no points_breakdown (old data synced before that field
// existed, or a same-render FPL scoring-rules fetch failure). Narrowed to
// the specific known numeric keys rather than `keyof GameweekStatBreakdown`
// so adding an optional field there (e.g. defensive_contribution) doesn't
// widen this indexing to a possibly-undefined lookup.
const STAT_LABELS: {
  key: "goals_scored" | "assists" | "clean_sheets" | "goals_conceded" | "own_goals"
     | "penalties_saved" | "penalties_missed" | "saves" | "bonus" | "yellow_cards" | "red_cards"
  label: string
}[] = [
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

  const hasData = !!data && (data.starting.length > 0 || data.bench.length > 0)
  const autoSubs = [...(data?.starting ?? []), ...(data?.bench ?? [])].filter(p => p.was_subbed_in)

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
        ) : !hasData ? (
          <p className="text-sm text-muted-foreground italic py-4 text-center">
            No scoring data for GW {selectedGw} yet.
          </p>
        ) : (
          <TooltipProvider delayDuration={150}>
            {data!.starting.length < SQUAD_RULES.starting && (
              <p className="text-xs text-amber-500 bg-amber-500/10 px-3 py-2 rounded-md">
                ⚠ Only {data!.starting.length}/{SQUAD_RULES.starting} Starting XI slots were filled this gameweek —
                no auto-subs were possible for the missing slots, so the team total reflects fewer than a full XI.
              </p>
            )}
            <div className="flex items-baseline justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Team total</p>
              <div className="flex items-baseline gap-2">
                {data!.points_penalty !== null && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-xs font-mono text-amber-500 cursor-help">
                        ({data!.points_penalty} penalty)
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="text-xs">
                      Drop-quota penalty applied this gameweek
                    </TooltipContent>
                  </Tooltip>
                )}
                <p className={cn("text-2xl font-semibold font-mono", data!.points_penalty !== null && "text-amber-500")}>
                  {data!.team_total}
                  {data!.points_penalty !== null && "*"}
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Starting XI</p>
              <div className="space-y-1">
                {data!.starting.map(p => (
                  <PlayerPointsRow key={p.player_id} player={p} />
                ))}
              </div>
            </div>

            {data!.bench.length > 0 && (
              <div className="space-y-1.5 pt-2 border-t border-border/40">
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Bench</p>
                <div className="space-y-1">
                  {data!.bench.map(p => (
                    <PlayerPointsRow key={p.player_id} player={p} />
                  ))}
                </div>
              </div>
            )}

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
          </TooltipProvider>
        )}
      </CardContent>
    </Card>
  )
}

function formatSigned(n: number): string {
  return n > 0 ? `+${n}` : `${n}`
}

function PlayerPointsRow({ player }: { player: TeamGameweekPerformance["starting"][number] }) {
  const breakdown = player.stat_breakdown
  // points_breakdown sums to stat_breakdown.total_points — the player's own
  // RAW points, before captain doubling. player.points is the doubled value
  // actually displayed, so a captain needs an explicit extra line or the
  // tooltip's own numbers wouldn't visibly add up to the number shown.
  const pointsBreakdown = player.points_breakdown
  const breakdownSum = pointsBreakdown?.reduce((s, l) => s + l.points, 0) ?? 0
  const captainBonus = player.is_captain && pointsBreakdown ? player.points - breakdownSum : 0

  // Fallback path — stat_breakdown exists but has no `explain` (a row
  // synced before that field was captured): fall back to the old
  // category-only display rather than showing nothing.
  const activeStats = !pointsBreakdown && breakdown
    ? STAT_LABELS.filter(({ key }) => breakdown[key] > 0)
    : []

  const pointsEl = (
    <span className={cn(
      "text-sm font-mono font-semibold shrink-0 ml-2",
      !player.counted && "font-normal",
      breakdown && "underline decoration-dotted decoration-muted-foreground/50 underline-offset-2 cursor-help",
    )}>
      {player.points}
    </span>
  )

  return (
    <div className={cn(
      "flex items-center justify-between py-2 px-2.5 rounded-md",
      player.is_captain && "bg-amber-500/10 ring-1 ring-amber-500/30",
      !player.counted && "opacity-50",
    )}>
      <div className="flex items-center gap-2.5 min-w-0">
        <PositionBadge position={player.position} />
        <div className="min-w-0 flex items-center gap-1.5">
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
          {!player.counted && (
            <Badge variant="outline" className="text-[10px] h-4 px-1 py-0 text-muted-foreground border-border/50">
              {player.slot_type === "starting" ? "Subbed out" : "Unused"}
            </Badge>
          )}
        </div>
      </div>
      {breakdown ? (
        <Tooltip>
          <TooltipTrigger asChild>{pointsEl}</TooltipTrigger>
          <TooltipContent side="left" className="text-xs">
            {pointsBreakdown ? (
              pointsBreakdown.length > 0 ? (
                <div className="space-y-0.5 min-w-[9rem]">
                  {pointsBreakdown.map(line => (
                    <div key={line.label} className="flex items-center justify-between gap-4">
                      <span>{line.label}</span>
                      <span className={cn("font-mono", line.points < 0 ? "text-rose-400" : "text-emerald-400")}>
                        {formatSigned(line.points)}
                      </span>
                    </div>
                  ))}
                  {captainBonus !== 0 && (
                    <div className="flex items-center justify-between gap-4 pt-0.5 border-t border-border/40 mt-1">
                      <span>×2 Captain bonus</span>
                      <span className="font-mono text-emerald-400">{formatSigned(captainBonus)}</span>
                    </div>
                  )}
                </div>
              ) : "Did not play"
            ) : activeStats.length > 0
              ? activeStats.map(({ key, label }) => `${label}${breakdown[key] > 1 ? ` ×${breakdown[key]}` : ""}`).join(" · ")
              : breakdown.minutes > 0 ? `${breakdown.minutes} mins` : "Did not play"}
          </TooltipContent>
        </Tooltip>
      ) : pointsEl}
    </div>
  )
}
