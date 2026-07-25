"use client"

import { useAuction } from "./AuctionProvider"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatMoney } from "@/lib/utils"
import type { AuctionLogEntry, LeagueTeam } from "@/types"

function logLine(entry: AuctionLogEntry, teams: LeagueTeam[]): string {
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
    case "assignment_undone":
      return `↩️ ${p.player_name} assignment to ${p.team_name} undone`
    case "lot_no_interest":
      return `⏭ ${p.player_name ?? "Player"} passed — no interest`
    case "lot_returned_to_pool":
      return `🔁 ${p.player_name ?? "Player"} returned to pool — no bids placed`
    case "bidding_started": {
      const count = (p.interested_count as number) ?? 0
      const firstBidder = teams.find(t => t.id === p.first_bidder_id)
      return firstBidder
        ? `🔔 Bidding started — ${count} team${count === 1 ? "" : "s"} interested, ${firstBidder.short_name} up first`
        : `🔔 Bidding started — ${count} team${count === 1 ? "" : "s"} interested`
    }
    case "position_advanced":
      return `➡️ Position advanced: ${p.from} → ${p.to}`
    case "bid_undone":
      return `↩️ ${p.team_name} undid their bid of ${formatMoney(p.undone_amount as number)}`
    default:
      // Fallback for any action_type not explicitly handled above — never
      // show the raw snake_case identifier.
      return entry.action_type.replace(/_/g, " ")
  }
}

export function AuctionLog() {
  const { log, teams } = useAuction()

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
                <p className="text-xs text-foreground leading-snug">{logLine(entry, teams)}</p>
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
