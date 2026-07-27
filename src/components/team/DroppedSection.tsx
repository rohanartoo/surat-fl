"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PositionBadge } from "@/components/ui/PositionBadge"
import { formatMoney } from "@/lib/utils"
import type { RosterEntry, Player, DropQuotaSummary } from "@/types"

interface Props {
  entries: (RosterEntry & { player: Player })[]
  canEdit: boolean
  onReturnFromDrop: (entryId: string) => void
  quotaSummary?: DropQuotaSummary
  dropsLocked?: boolean
}

export function DroppedSection({ entries, canEdit, onReturnFromDrop, quotaSummary, dropsLocked }: Props) {
  if (entries.length === 0 && !quotaSummary) return null

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-base">{dropsLocked ? "Dropped players" : "Staged drops"}</CardTitle>
        {quotaSummary && (
          <Badge
            variant="secondary"
            className={`font-mono text-xs ${quotaSummary.excess > 0 ? "text-destructive" : ""}`}
          >
            {quotaSummary.used}/{quotaSummary.total_free} free
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-0.5 px-3 pb-3">
        {quotaSummary && quotaSummary.excess > 0 && (
          <p className="text-xs text-destructive bg-destructive/10 px-2 py-1.5 rounded-md mb-2">
            ⚠ {quotaSummary.excess} excess drop{quotaSummary.excess > 1 ? "s" : ""}: {quotaSummary.penalty_points} pts penalty (applied end of gameweek)
          </p>
        )}

        {entries.length > 0 ? (
          entries.map(entry => (
            <div
              key={entry.id}
              className="flex items-center justify-between py-2.5 px-2 rounded-md opacity-60 hover:opacity-100 transition-opacity group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <PositionBadge position={entry.player.position} />
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-none line-through text-muted-foreground truncate">
                    {entry.player.web_name}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{entry.player.fpl_team_short}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-sm font-mono text-muted-foreground">{formatMoney(entry.base_price)}</span>
                {canEdit && (
                  dropsLocked
                    ? <span className="text-[10px] text-muted-foreground italic hidden group-hover:inline">Locked</span>
                    : <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-xs hidden group-hover:flex"
                        onClick={() => onReturnFromDrop(entry.id)}
                      >
                        Return
                      </Button>
                )}
              </div>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground italic py-4 text-center">No staged drops.</p>
        )}
      </CardContent>
    </Card>
  )
}
