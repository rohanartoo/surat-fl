"use client"

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { PositionBadge } from "@/components/ui/PositionBadge"
import { PlayerSeasonStats } from "./PlayerSeasonStats"
import { cn, formatMoney, statusColor, statusLabel } from "@/lib/utils"
import type { Player, PlayerSummary } from "@/types"

// Session-lifetime cache so re-opening a player doesn't refetch. The route
// itself is also cached server-side (see fetchFplPlayerSummary).
const summaryCache = new Map<number, PlayerSummary>()

type Result = { playerId: number; summary: PlayerSummary | null }

/** FPL fixture difficulty rating (1–5) → chip colour. */
function difficultyClass(difficulty: number): string {
  if (difficulty <= 2) return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
  if (difficulty === 3) return "bg-secondary text-muted-foreground"
  if (difficulty === 4) return "bg-rose-500/15 text-rose-600 dark:text-rose-400"
  return "bg-rose-500/30 text-rose-700 dark:text-rose-300"
}

/**
 * View-only stats for any player in the auction pool: season totals from our
 * players table, plus recent form and upcoming fixtures fetched from FPL.
 * Deliberately has no actions — nominating stays in the player list.
 */
export function PlayerStatsDialog({
  player,
  onOpenChange,
}: {
  player: Player | null
  onOpenChange: (open: boolean) => void
}) {
  const [result, setResult] = useState<Result | null>(null)
  const playerId = player?.id ?? null

  useEffect(() => {
    if (playerId === null || summaryCache.has(playerId)) return
    const controller = new AbortController()
    fetch(`/api/fpl/player/${playerId}`, { signal: controller.signal })
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const summary = (await res.json()) as PlayerSummary
        summaryCache.set(playerId, summary)
        setResult({ playerId, summary })
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ playerId, summary: null })
      })
    return () => controller.abort()
  }, [playerId])

  const cached = playerId !== null ? summaryCache.get(playerId) : undefined
  const fetched = result?.playerId === playerId ? result : null
  const summary = cached ?? fetched?.summary ?? null
  const loading = !cached && !fetched
  const failed = !cached && fetched?.summary === null

  return (
    <Dialog open={player !== null} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-h-[90vh] overflow-y-auto rounded-lg">
        {player && (
          <>
            <DialogHeader className="text-left">
              <div className="flex items-center gap-2">
                <PositionBadge position={player.position} className="w-auto px-2" />
                {player.status !== "a" && (
                  <span className={cn("text-xs font-medium", statusColor(player.status))}>
                    {statusLabel(player.status)}
                  </span>
                )}
              </div>
              <div className="flex items-end justify-between gap-4 pr-6">
                <div className="min-w-0">
                  <DialogTitle className="text-xl font-bold tracking-tight truncate">
                    {player.web_name}
                  </DialogTitle>
                  <DialogDescription>
                    {player.first_name} {player.second_name} · {player.fpl_team}
                  </DialogDescription>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-lg font-bold font-mono">{formatMoney(player.base_price)}</p>
                  <p className="text-[10px] text-muted-foreground">base price</p>
                </div>
              </div>
              {player.news && (
                <p className="text-xs text-amber-500 leading-snug">{player.news}</p>
              )}
            </DialogHeader>

            <section className="space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Season</h3>
              <PlayerSeasonStats player={player} />
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Recent form</h3>
              {loading ? (
                <Skeleton className="h-32 w-full" />
              ) : failed ? (
                <p className="text-sm text-muted-foreground italic">Recent form unavailable right now.</p>
              ) : summary && summary.recent.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No matches played yet this season.</p>
              ) : summary && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        <th className="text-left font-medium py-1">GW</th>
                        <th className="text-left font-medium py-1">Opp</th>
                        <th className="text-right font-medium py-1">Min</th>
                        <th className="text-right font-medium py-1">G</th>
                        <th className="text-right font-medium py-1">A</th>
                        <th className="text-right font-medium py-1">CS</th>
                        <th className="text-right font-medium py-1">Bon</th>
                        <th className="text-right font-medium py-1">Pts</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/30 font-mono">
                      {summary.recent.map((r, i) => (
                        <tr key={`${r.round}-${i}`}>
                          <td className="py-1.5">{r.round}</td>
                          <td className="py-1.5 font-sans">
                            {r.opponent_short} <span className="text-muted-foreground text-xs">({r.was_home ? "H" : "A"})</span>
                          </td>
                          <td className="py-1.5 text-right">{r.minutes}</td>
                          <td className="py-1.5 text-right">{r.goals_scored}</td>
                          <td className="py-1.5 text-right">{r.assists}</td>
                          <td className="py-1.5 text-right">{r.clean_sheets}</td>
                          <td className="py-1.5 text-right">{r.bonus}</td>
                          <td className="py-1.5 text-right font-semibold">{r.total_points}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {summary && summary.upcoming.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Upcoming</h3>
                <div className="flex flex-wrap gap-2">
                  {summary.upcoming.map((f, i) => (
                    <span
                      key={`${f.event}-${i}`}
                      className={cn("rounded-md px-2 py-1 text-xs font-medium", difficultyClass(f.difficulty))}
                      title={`Fixture difficulty ${f.difficulty}/5`}
                    >
                      GW{f.event} {f.opponent_short} ({f.is_home ? "H" : "A"})
                    </span>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
