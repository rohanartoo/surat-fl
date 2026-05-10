"use client"

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
    <div className="pt-2">
      <div className="flex items-center justify-between mb-2 px-1">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {dropsLocked ? "Dropped players" : "Staged drops"}
        </h3>
        {quotaSummary && (
          <span className={`text-xs font-mono font-medium ${quotaSummary.excess > 0 ? "text-destructive" : "text-muted-foreground"}`}>
            {quotaSummary.used}/{quotaSummary.total_free} free
          </span>
        )}
      </div>

      {quotaSummary && quotaSummary.excess > 0 && (
        <p className="text-xs text-destructive bg-destructive/10 px-2 py-1.5 rounded-md mb-2">
          ⚠ {quotaSummary.excess} excess drop{quotaSummary.excess > 1 ? "s" : ""}: {quotaSummary.penalty_points} pts penalty (applied end of gameweek)
        </p>
      )}

      {entries.length > 0 && (
        <div className="space-y-0.5">
          {entries.map(entry => (
            <div
              key={entry.id}
              className="flex items-center justify-between py-2.5 px-2 rounded-md opacity-60 hover:opacity-100 transition-opacity group"
            >
              <div className="flex items-center gap-3">
                <PositionBadge position={entry.player.position} />
                <div>
                  <p className="text-sm font-medium leading-none line-through text-muted-foreground">
                    {entry.player.web_name}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{entry.player.fpl_team_short}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
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
          ))}
        </div>
      )}
    </div>
  )
}
