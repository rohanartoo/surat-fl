"use client"

import { useAuction } from "./AuctionProvider"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatMoney } from "@/lib/utils"
import type { AuctionLogEntry } from "@/types"

function logLine(entry: AuctionLogEntry): string {
  const p = entry.payload as Record<string, unknown>

  switch (entry.action_type) {
    case "lot_opened":
      return `📋 ${p.player_name} (${p.position}) nominated — base ${formatMoney(p.base_price as number)}`
    case "interest_declared":
      return p.is_interested
        ? `✋ ${p.team_name} is interested`
        : `— ${p.team_name} passed`
    case "bid_placed":
      return `💰 ${p.team_name} bid ${formatMoney(p.amount as number)}`
    case "team_folded":
      return `✗ ${p.team_name} folded`
    case "player_assigned":
      return `✅ ${p.player_name} → ${p.winning_team_name} for ${formatMoney(p.winning_bid as number)}`
    case "lot_no_interest":
      return `⏭ Player passed — no interest`
    default:
      return entry.action_type
  }
}

export function AuctionLog() {
  const { log } = useAuction()

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Auction Log</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-64 overflow-y-auto divide-y divide-border/40">
          {log.length === 0 ? (
            <p className="text-xs text-muted-foreground px-4 py-3 italic">No activity yet.</p>
          ) : (
            log.map((entry) => (
              <div key={entry.id} className="px-4 py-2">
                <p className="text-xs text-foreground leading-snug">{logLine(entry)}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {new Date(entry.created_at).toLocaleTimeString()}
                </p>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  )
}
