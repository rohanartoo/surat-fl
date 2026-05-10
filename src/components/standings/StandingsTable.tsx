import { cn } from "@/lib/utils"
import type { StandingRow } from "@/lib/scoring"

interface Props {
  standings: StandingRow[]
  gameweeks: number[]
  myTeamId?: string
}

export function StandingsTable({ standings, gameweeks, myTeamId }: Props) {
  if (standings.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic text-center py-12">
        No points recorded yet.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/60">
            <th className="text-left font-medium text-muted-foreground pb-3 pr-4 w-8">#</th>
            <th className="text-left font-medium text-muted-foreground pb-3 pr-4">Team</th>
            {gameweeks.map(gw => (
              <th key={gw} className="text-center font-medium text-muted-foreground pb-3 px-3 w-12 tabular-nums">
                GW{gw}
              </th>
            ))}
            <th className="text-right font-medium text-foreground pb-3 pl-4 w-16">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {standings.map((row, idx) => {
            const isFirst = idx === 0
            const isMe = myTeamId ? row.team_id === myTeamId : false
            return (
              <tr
                key={row.team_id}
                className={cn(
                  "transition-colors hover:bg-accent/30",
                  isFirst && !isMe && "bg-amber-500/5",
                  isMe && "bg-emerald-500/10 border-l-2 border-emerald-500",
                )}
              >
                <td className="py-3 pr-4 text-muted-foreground font-mono text-xs">
                  {isFirst ? "🥇" : idx + 1}
                </td>
                <td className="py-3 pr-4">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: row.color }} />
                    <div>
                      <p className="font-medium leading-none">{row.display_name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{row.short_name}</p>
                    </div>
                  </div>
                </td>
                {gameweeks.map(gw => (
                  <td key={gw} className="py-3 px-3 text-center font-mono text-xs text-muted-foreground tabular-nums">
                    {row.by_gameweek[gw] !== undefined ? row.by_gameweek[gw] : "—"}
                  </td>
                ))}
                <td className={cn(
                  "py-3 pl-4 text-right font-mono font-semibold tabular-nums",
                  isFirst ? "text-amber-500" : "text-foreground",
                )}>
                  {row.total_points}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
