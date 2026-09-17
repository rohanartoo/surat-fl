"use client"

import { useEffect, useState } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { PlayerSeasonStats } from "./PlayerSeasonStats"
import { cn } from "@/lib/utils"
import type { Player, PlayerSummary } from "@/types"

// Session-lifetime cache so re-expanding a player doesn't refetch. The route
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

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{children}</h3>
  )
}

/**
 * View-only stats expanded under a player's row in the auction pool, so
 * viewers can click through players without closing anything: season totals
 * from our players table, plus recent form and upcoming fixtures fetched from
 * FPL. Name, club and price are already on the row, so they aren't repeated.
 * Deliberately has no actions — nominating stays on the row.
 */
export function PlayerStatsPanel({ player }: { player: Player }) {
  const [result, setResult] = useState<Result | null>(null)
  const playerId = player.id

  useEffect(() => {
    if (summaryCache.has(playerId)) return
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

  const cached = summaryCache.get(playerId)
  const fetched = result?.playerId === playerId ? result : null
  const summary = cached ?? fetched?.summary ?? null
  const loading = !cached && !fetched
  const failed = !cached && fetched?.summary === null

  return (
    <div className="space-y-3">
      {player.news && (
        <p className="text-[11px] text-amber-500 leading-snug">{player.news}</p>
      )}

      <section className="space-y-1.5">
        <SectionHeading>Season</SectionHeading>
        <PlayerSeasonStats player={player} compact />
      </section>

      <section className="space-y-1.5">
        <SectionHeading>Recent form</SectionHeading>
        {loading ? (
          <Skeleton className="h-28 w-full" />
        ) : failed ? (
          <p className="text-xs text-muted-foreground italic">Recent form unavailable right now.</p>
        ) : summary && summary.recent.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No matches played yet this season.</p>
        ) : summary && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[9px] uppercase tracking-wider text-muted-foreground">
                  <th className="text-left font-medium py-0.5">GW</th>
                  <th className="text-left font-medium py-0.5">Opp</th>
                  <th className="text-right font-medium py-0.5">Min</th>
                  <th className="text-right font-medium py-0.5">G</th>
                  <th className="text-right font-medium py-0.5">A</th>
                  <th className="text-right font-medium py-0.5">CS</th>
                  <th className="text-right font-medium py-0.5">Bon</th>
                  <th className="text-right font-medium py-0.5">Pts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30 font-mono">
                {summary.recent.map((r, i) => (
                  <tr key={`${r.round}-${i}`}>
                    <td className="py-1">{r.round}</td>
                    <td className="py-1 font-sans">
                      {r.opponent_short} <span className="text-muted-foreground text-[10px]">({r.was_home ? "H" : "A"})</span>
                    </td>
                    <td className="py-1 text-right">{r.minutes}</td>
                    <td className="py-1 text-right">{r.goals_scored}</td>
                    <td className="py-1 text-right">{r.assists}</td>
                    <td className="py-1 text-right">{r.clean_sheets}</td>
                    <td className="py-1 text-right">{r.bonus}</td>
                    <td className="py-1 text-right font-semibold">{r.total_points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {summary && summary.upcoming.length > 0 && (
        <section className="space-y-1.5">
          <SectionHeading>Upcoming</SectionHeading>
          <div className="flex flex-wrap gap-1.5">
            {summary.upcoming.map((f, i) => (
              <span
                key={`${f.event}-${i}`}
                className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", difficultyClass(f.difficulty))}
                title={`Fixture difficulty ${f.difficulty}/5`}
              >
                GW{f.event} {f.opponent_short} ({f.is_home ? "H" : "A"})
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
