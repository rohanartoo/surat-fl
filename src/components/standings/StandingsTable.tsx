import { cn } from "@/lib/utils"
import type { StandingRow } from "@/lib/scoring"

interface Props {
  standings: StandingRow[]
  gameweeks: number[]
  myTeamId?: string
}

function MovementIndicator({ change }: { change: number }) {
  if (change > 0) return (
    <span className="text-[10px] font-bold text-emerald-500 leading-none">▲{change}</span>
  )
  if (change < 0) return (
    <span className="text-[10px] font-bold text-rose-500 leading-none">▼{Math.abs(change)}</span>
  )
  return null
}

export function StandingsTable({ standings, gameweeks, myTeamId }: Props) {
  if (standings.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic text-center py-12">
        No points recorded yet.
      </p>
    )
  }

  const latestGw = standings[0]?.latest_gw ?? null
  // Historical GW columns — all except the latest
  const historyGws = latestGw !== null ? gameweeks.filter(gw => gw !== latestGw) : gameweeks

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/60">
            <th className="text-left font-medium text-muted-foreground pb-3 pr-4 w-10">#</th>
            <th className="text-left font-medium text-muted-foreground pb-3 pr-4">Team</th>
            {latestGw !== null && (
              <th className="text-center font-semibold text-foreground pb-3 px-3 w-16 tabular-nums">
                GW{latestGw}
              </th>
            )}
            <th className="text-right font-medium text-foreground pb-3 px-4 w-16">Total</th>
            {historyGws.map(gw => (
              <th key={gw} className="text-center font-medium text-muted-foreground pb-3 px-3 w-12 tabular-nums">
                GW{gw}
              </th>
            ))}
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
                  isFirst && !isMe && "bg-amber-500/10",
                  isMe && "bg-emerald-500/15 border-l-2 border-emerald-500",
                )}
              >
                {/* Rank + movement */}
                <td className="py-3 pr-4">
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground font-mono text-xs w-3 text-right">
                      {isFirst ? "🥇" : idx + 1}
                    </span>
                    <MovementIndicator change={row.position_change} />
                  </div>
                </td>

                {/* Team */}
                <td className="py-3 pr-4">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: row.color }} />
                    <div>
                      <p className="font-medium leading-none">{row.display_name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{row.short_name}</p>
                    </div>
                  </div>
                </td>

                {/* Latest GW score */}
                {latestGw !== null && (
                  <td className="py-3 px-3 text-center font-mono font-semibold tabular-nums">
                    {row.latest_gw_points ?? "—"}
                  </td>
                )}

                {/* Total */}
                <td className={cn(
                  "py-3 px-4 text-right font-mono font-semibold tabular-nums",
                  isFirst ? "text-amber-500" : "text-foreground",
                )}>
                  {row.total_points}
                </td>

                {/* Historical GW columns */}
                {historyGws.map(gw => (
                  <td key={gw} className="py-3 px-3 text-center font-mono text-xs text-foreground/60 tabular-nums">
                    {row.by_gameweek[gw] !== undefined ? row.by_gameweek[gw] : "—"}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
