"use client"

import { useAuction } from "./AuctionProvider"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatMoney } from "@/lib/utils"
import { PositionBadge } from "@/components/ui/PositionBadge"

export function BidResultPanel() {
  const { lastConcludedLot, teams } = useAuction()

  if (!lastConcludedLot || lastConcludedLot.winning_team_id === null) return null

  const { player, winning_team_id, winning_bid } = lastConcludedLot
  const winningTeam = teams.find(t => t.id === winning_team_id)

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">Last result</CardTitle>
      </CardHeader>
      <CardContent className="pb-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <PositionBadge position={player.position} className="w-auto px-2" />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{player.web_name}</p>
              <p className="text-xs text-muted-foreground">{player.fpl_team_short}</p>
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-semibold font-mono text-emerald-500">
              {winning_bid !== null ? formatMoney(winning_bid) : "—"}
            </p>
            {winningTeam && (
              <div className="flex items-center justify-end gap-1 mt-0.5">
                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: winningTeam.color }} />
                <p className="text-xs text-muted-foreground">{winningTeam.short_name}</p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
