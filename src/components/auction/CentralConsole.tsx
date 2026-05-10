"use client"

import { useAuction } from "./AuctionProvider"
import { AuctionTimer } from "./AuctionTimer"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatMoney, statusColor, statusLabel, cn } from "@/lib/utils"
import { PositionBadge } from "@/components/ui/PositionBadge"
import { getMinNextBid } from "@/lib/auction-engine"

export function CentralConsole() {
  const { currentLot } = useAuction()

  if (!currentLot) {
    return (
      <Card className="border-border/60 border-dashed">
        <CardContent className="py-12 flex flex-col items-center justify-center text-center gap-2">
          <p className="text-sm font-medium text-muted-foreground">No player nominated</p>
          <p className="text-xs text-muted-foreground">
            The Auction Master will nominate a player to start bidding.
          </p>
        </CardContent>
      </Card>
    )
  }

  const { player, phase, current_bid, timer_started_at } = currentLot
  const minNextBid = getMinNextBid(current_bid ?? null, player.base_price)

  const stats: { label: string; value: string | number }[] = [
    { label: "Total pts",    value: player.total_points },
    { label: "Goals",        value: player.goals_scored },
    { label: "Assists",      value: player.assists },
    { label: "Clean sheets", value: player.clean_sheets },
    { label: "Bonus",        value: player.bonus },
    { label: "Yellow cards", value: player.yellow_cards },
    { label: "Red cards",    value: player.red_cards },
    { label: "Minutes",      value: player.minutes },
  ]

  return (
    <Card className={cn(
      "border",
      phase === "bidding"  && "border-emerald-500/40 bg-emerald-500/5",
      phase === "interest" && "border-amber-500/40 bg-amber-500/5",
      phase === "concluded" && "border-border/60 opacity-60",
      phase === "pending"  && "border-border/60",
    )}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <PositionBadge position={player.position} className="w-auto px-2" />
              {player.status !== "a" && (
                <Badge
                  variant="outline"
                  className={cn("text-xs border-0", statusColor(player.status))}
                >
                  {statusLabel(player.status)}
                </Badge>
              )}
            </div>
            <CardTitle className="text-xl leading-tight">{player.web_name}</CardTitle>
            <p className="text-sm text-muted-foreground mt-0.5">{player.fpl_team}</p>
            {player.news && (
              <p className="text-xs text-amber-500 mt-1 leading-snug">{player.news}</p>
            )}
          </div>

          {/* Current bid / phase status */}
          <div className="text-right shrink-0">
            {current_bid !== null ? (
              <>
                <p className="text-2xl font-semibold font-mono text-emerald-500">
                  {formatMoney(current_bid)}
                </p>
                <p className="text-xs text-muted-foreground">current bid</p>
                {phase === "bidding" && (
                  <p className="text-xs font-mono text-amber-500 mt-1">
                    min next: {formatMoney(minNextBid)}
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="text-2xl font-semibold font-mono text-muted-foreground">
                  {formatMoney(player.base_price)}
                </p>
                <p className="text-xs text-muted-foreground">base price</p>
                {phase === "bidding" && (
                  <p className="text-xs font-mono text-amber-500 mt-1">
                    min bid: {formatMoney(minNextBid)}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Timer (shown only during interest phase) */}
        <AuctionTimer
          timerStartedAt={timer_started_at}
          phase={phase as "interest" | "bidding" | "pending" | "concluded"}
        />

        {/* Stats grid */}
        <div className="grid grid-cols-4 gap-2">
          {stats.map(({ label, value }) => (
            <div key={label} className="bg-secondary/50 rounded-md p-2 text-center">
              <p className="text-xs text-muted-foreground leading-none mb-1">{label}</p>
              <p className="text-base font-semibold font-mono">{value}</p>
            </div>
          ))}
        </div>

        {/* Phase badge */}
        <div className="flex justify-end">
          <Badge
            variant="outline"
            className={cn(
              "text-xs capitalize",
              phase === "interest"  && "border-amber-500/50 text-amber-500",
              phase === "bidding"   && "border-emerald-500/50 text-emerald-500",
              phase === "concluded" && "border-border text-muted-foreground",
            )}
          >
            {phase === "interest" ? "Interest phase" : phase === "bidding" ? "Bidding open" : phase}
          </Badge>
        </div>
      </CardContent>
    </Card>
  )
}
