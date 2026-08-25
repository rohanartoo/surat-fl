"use client"

import { useMemo, useRef, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Pitch, PitchSlot, groupByPosition } from "./Pitch"
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
  /**
   * player_id → display index, defining the within-row order. Team Selection
   * owns this ordering and this view mirrors it, so the same position row
   * never renders in two different orders across the two pitches. Players
   * absent from it (a past gameweek's squad member since transferred out)
   * sort to the end of their row.
   */
  rosterOrder?: Record<number, number>
}

export function GameweekPerformance({ teamId, currentGw, initialGw, initialData, rosterOrder }: Props) {
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

  const orderMap = useMemo(
    () => rosterOrder ? new Map(Object.entries(rosterOrder).map(([id, i]) => [Number(id), i])) : null,
    [rosterOrder],
  )

  // A starter who played no minutes but still COUNTED — the bench was
  // exhausted (or no sub kept the formation legal), so they stayed in the XI
  // scoring zero. Without a marker they're indistinguishable from an
  // ordinary blank, which hides the fact that the auto-sub couldn't help.
  // Distinct from `!counted` starters, who were successfully subbed out.
  const blankedIds = useMemo(() => {
    const ids = new Set<number>()
    for (const p of data?.starting ?? []) {
      if (p.counted && !p.was_subbed_in && (p.stat_breakdown?.minutes ?? 0) === 0) ids.add(p.player_id)
    }
    return ids
  }, [data])

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

            <Pitch
              rows={orderMap
                ? groupByPosition(data!.starting, p => p.position, orderMap, p => p.player_id)
                    .map(row => row.map(p => (
                      <PlayerPointsRow key={p.player_id} player={p} blanked={blankedIds.has(p.player_id)} />
                    )))
                : groupByPosition(data!.starting, p => p.position)
                    .map(row => row.map(p => (
                      <PlayerPointsRow key={p.player_id} player={p} blanked={blankedIds.has(p.player_id)} />
                    )))}
              bench={data!.bench.map(p => (
                <PlayerPointsRow key={p.player_id} player={p} blanked={false} />
              ))}
              footer={
                (autoSubs.length > 0 || blankedIds.size > 0) && (
                  <div className="mt-2 rounded-[calc(var(--radius)-2px)] border border-border/60 px-3 py-2.5 space-y-1">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground text-center mb-1.5">
                      Auto-subs
                    </p>
                    {autoSubs.map(p => (
                      <p key={p.player_id} className="text-xs text-muted-foreground">
                        <span className="text-emerald-500 font-bold mr-1">↑</span>
                        <span className="text-foreground font-medium">{p.web_name}</span>
                        {" came on for "}
                        <span className="text-foreground font-medium">{p.subbed_out_web_name ?? "unknown player"}</span>
                      </p>
                    ))}
                    {data!.starting.filter(p => blankedIds.has(p.player_id)).map(p => (
                      <p key={p.player_id} className="text-xs text-muted-foreground">
                        <span className="text-amber-500 font-bold mr-1">!</span>
                        <span className="text-foreground font-medium">{p.web_name}</span>
                        {" blanked — no legal substitute remained, so they counted for 0"}
                      </p>
                    ))}
                  </div>
                )
              }
            />
          </TooltipProvider>
        )}
      </CardContent>
    </Card>
  )
}

function formatSigned(n: number): string {
  return n > 0 ? `+${n}` : `${n}`
}

function PlayerPointsRow({
  player,
  blanked,
}: {
  player: TeamGameweekPerformance["starting"][number]
  /** Counted starter who played 0 minutes — see blankedIds above. */
  blanked: boolean
}) {
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

  // Subbed out (a starter who didn't count) vs came on (a bench player who
  // did) vs blanked-but-stuck-in — three visually distinct states, matching
  // FPL's own Points view where players stay where the manager PICKED them
  // and the swap is annotated rather than re-ordered.
  const subbedOut = player.slot_type === "starting" && !player.counted
  const slot = (
    <PitchSlot
      position={player.position}
      name={player.web_name}
      value={player.points}
      title={breakdown ? undefined : "No stats recorded"}
      className={cn(
        player.is_captain && "bg-amber-500/10",
        player.was_subbed_in && "!border-emerald-500 ring-1 ring-emerald-500/50",
        blanked && "!border-amber-500 ring-1 ring-amber-500/50",
        (subbedOut || (!player.counted && player.slot_type === "bench")) && "opacity-45",
        breakdown && "cursor-help",
      )}
      topRight={
        <>
          {player.is_captain && (
            <Badge variant="secondary" className="h-3.5 border-0 bg-amber-500/20 px-1 py-0 text-[9px] uppercase text-amber-600">
              C ×2
            </Badge>
          )}
          {player.was_subbed_in && <span className="text-[11px] font-bold leading-none text-emerald-500" title="Came on">↑</span>}
          {subbedOut && <span className="text-[11px] font-bold leading-none text-rose-500" title="Subbed out">↓</span>}
          {blanked && <span className="text-[11px] font-extrabold leading-none text-amber-500" title="Blanked — no substitute available">!</span>}
        </>
      }
    />
  )

  return (
    <>
      {breakdown ? (
        <Tooltip>
          <TooltipTrigger asChild><div>{slot}</div></TooltipTrigger>
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
      ) : slot}
    </>
  )
}
