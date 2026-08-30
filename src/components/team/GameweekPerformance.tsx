"use client"

import { useMemo, useRef, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Pitch, PitchSlot, groupByPosition } from "./Pitch"
import { cn } from "@/lib/utils"
import type { TeamGameweekPerformance } from "@/lib/scoring"
import { SQUAD_RULES } from "@/types"

const SEASON_LENGTH = 38

// Matches the tooltip's old delayDuration, so a mouse crossing fifteen cards
// still doesn't strobe through fifteen popovers.
const HOVER_DELAY_MS = 150

/** Which popover is open — a player_id, or the team-total penalty note. */
type OpenKey = number | "penalty"

/**
 * These breakdowns used to be Radix tooltips, which by design never open on
 * touch: the trigger's onPointerMove returns early for `pointerType: "touch"`
 * and onPointerDown suppresses the focus-open path, so on a phone the
 * breakdown was unreachable by any gesture. Popover is click-driven, so touch
 * works natively; hover is layered back on here for fine pointers, guarded by
 * the same pointerType check Radix's own tooltip uses. Testing the pointer at
 * event time (rather than a media query) is deliberate — there is no server/
 * client disagreement to hydrate around.
 */
function useBreakdownPopovers() {
  const [openId, setOpenId] = useState<OpenKey | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function cancelHover() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = null
  }

  // Only ever clears itself: a close racing a different card's open (tap A,
  // then tap B — B's pointerdown dismisses A) must not wipe out the newer id.
  function close(id: OpenKey) {
    setOpenId(cur => (cur === id ? null : cur))
  }

  return {
    isOpen: (id: OpenKey) => openId === id,
    onOpenChange: (id: OpenKey) => (open: boolean) => {
      cancelHover()
      if (open) setOpenId(id)
      else close(id)
    },
    /** Spread onto the trigger. Mouse opens on hover; touch falls through to
     *  Popover's own click handling, so it isn't double-triggered. */
    triggerProps: (id: OpenKey) => ({
      onPointerEnter: (e: React.PointerEvent) => {
        if (e.pointerType === "touch") return
        cancelHover()
        hoverTimer.current = setTimeout(() => setOpenId(id), HOVER_DELAY_MS)
      },
      onPointerLeave: (e: React.PointerEvent) => {
        if (e.pointerType === "touch") return
        cancelHover()
        close(id)
      },
      // PitchSlot is a div, so Radix's aria-expanded lands on something with
      // no native keyboard activation — supply it.
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key !== "Enter" && e.key !== " ") return
        e.preventDefault()
        setOpenId(cur => (cur === id ? null : id))
      },
    }),
  }
}

/** Shared by both popovers: never steal focus, and stay clear of the edges. */
const POPOVER_CONTENT_PROPS = {
  side: "top",
  align: "center",
  collisionPadding: 8,
  onOpenAutoFocus: (e: Event) => e.preventDefault(),
  onCloseAutoFocus: (e: Event) => e.preventDefault(),
} as const

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
  const popovers = useBreakdownPopovers()

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
      <CardContent className="space-y-4 px-1 pb-1">
        {loading ? (
          <p className="px-3 text-sm text-muted-foreground italic py-4 text-center">Loading…</p>
        ) : !hasData ? (
          <p className="px-3 text-sm text-muted-foreground italic py-4 text-center">
            No scoring data for GW {selectedGw} yet.
          </p>
        ) : (
          <>
            {data!.starting.length < SQUAD_RULES.starting && (
              <p className="mx-2 text-xs text-amber-500 bg-amber-500/10 px-3 py-2 rounded-md">
                ⚠ Only {data!.starting.length}/{SQUAD_RULES.starting} Starting XI slots were filled this gameweek —
                no auto-subs were possible for the missing slots, so the team total reflects fewer than a full XI.
              </p>
            )}
            <div className="flex items-baseline justify-between px-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Team total</p>
              <div className="flex items-baseline gap-2">
                {data!.points_penalty !== null && (
                  <Popover open={popovers.isOpen("penalty")} onOpenChange={popovers.onOpenChange("penalty")}>
                    <PopoverTrigger asChild>
                      <span
                        role="button"
                        tabIndex={0}
                        {...popovers.triggerProps("penalty")}
                        className="text-xs font-mono text-amber-500 cursor-help"
                      >
                        ({data!.points_penalty} penalty)
                      </span>
                    </PopoverTrigger>
                    <PopoverContent {...POPOVER_CONTENT_PROPS} className="text-xs w-auto">
                      Drop-quota penalty applied this gameweek
                    </PopoverContent>
                  </Popover>
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
                      <PlayerPointsRow key={p.player_id} player={p} blanked={blankedIds.has(p.player_id)} popovers={popovers} />
                    )))
                : groupByPosition(data!.starting, p => p.position)
                    .map(row => row.map(p => (
                      <PlayerPointsRow key={p.player_id} player={p} blanked={blankedIds.has(p.player_id)} popovers={popovers} />
                    )))}
              bench={data!.bench.map(p => (
                <PlayerPointsRow key={p.player_id} player={p} blanked={false} showBenchNumber popovers={popovers} />
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
          </>
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
  showBenchNumber,
  popovers,
}: {
  player: TeamGameweekPerformance["starting"][number]
  /** Counted starter who played 0 minutes — see blankedIds above. */
  blanked: boolean
  /** Bench rows only. The pip is still omitted when bench_order is null
   *  (a gameweek scored before it was recorded) rather than showing a
   *  placeholder the data can't back up. */
  showBenchNumber?: boolean
  /** Open-state is owned by the parent so only one breakdown shows at a time. */
  popovers: ReturnType<typeof useBreakdownPopovers>
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
      benchNumber={showBenchNumber ? player.bench_order ?? undefined : undefined}
      title={breakdown ? undefined : "No stats recorded"}
      // Only the cards that actually have a breakdown become interactive —
      // a card with nothing to show shouldn't take a tab stop. These land on
      // PitchSlot's outer element, the same one Radix's asChild targets.
      {...(breakdown
        ? { role: "button", tabIndex: 0, ...popovers.triggerProps(player.player_id) }
        : {})}
      className={cn(
        player.is_captain && "bg-amber-500/10",
        player.was_subbed_in && "!border-emerald-500 ring-1 ring-emerald-500/50",
        blanked && "!border-amber-500 ring-1 ring-amber-500/50",
        (subbedOut || (!player.counted && player.slot_type === "bench")) && "opacity-45",
        breakdown && "cursor-help",
      )}
      // Built as an array so an all-empty result is undefined rather than a
      // truthy fragment, which would draw an empty corner pip on every
      // ordinary card.
      marker={(() => {
        const bits = [
          player.is_captain && <span key="c" className="text-[9px] font-bold uppercase leading-none text-amber-500">C x2</span>,
          player.was_subbed_in && <span key="i" title="Came on" className="text-[10px] font-bold leading-none text-emerald-500">↑</span>,
          subbedOut && <span key="o" title="Subbed out" className="text-[10px] font-bold leading-none text-rose-500">↓</span>,
          blanked && <span key="b" title="Blanked — no substitute available" className="text-[10px] font-extrabold leading-none text-amber-500">!</span>,
        ].filter(Boolean)
        return bits.length ? <>{bits}</> : undefined
      })()}
    />
  )

  return (
    <>
      {breakdown ? (
        <Popover
          open={popovers.isOpen(player.player_id)}
          onOpenChange={popovers.onOpenChange(player.player_id)}
        >
          <PopoverTrigger asChild>{slot}</PopoverTrigger>
          <PopoverContent {...POPOVER_CONTENT_PROPS} className="text-xs w-auto">
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
          </PopoverContent>
        </Popover>
      ) : slot}
    </>
  )
}
