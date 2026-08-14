"use client"

import { useEffect } from "react"
import { useAuction } from "./AuctionProvider"
import { Card } from "@/components/ui/card"
import { PositionBadge } from "@/components/ui/PositionBadge"
import { formatMoney, cn } from "@/lib/utils"
import { turnsUntilTeamBids } from "@/lib/auction-engine"

const NORMAL_TITLE = "Surat FL"

// "At a glance" summary for a team's own Auction tab: current player, who's
// leading the bid and for how much, and how many turns away the viewer is
// from bidding — consolidated from CentralConsole/TeamBidConsole, which
// require scrolling to piece together on a mobile single-column layout.
export function AuctionBanner() {
  const { auction, currentLot, bids, teams, myTeamId, myRole } = useAuction()

  const isMyTurn = !!(
    currentLot &&
    currentLot.phase === "bidding" &&
    myTeamId &&
    currentLot.current_turn_team_id === myTeamId
  )

  useEffect(() => {
    if (isMyTurn) {
      document.title = "🔔 Your turn — " + NORMAL_TITLE
    } else {
      document.title = NORMAL_TITLE
    }
    return () => { document.title = NORMAL_TITLE }
  }, [isMyTurn])

  if (myRole !== "team" || !myTeamId) return null

  const auctionOrder = auction?.auction_order ?? []

  let headline: React.ReactNode
  let subline: React.ReactNode = null
  let emphasis: "idle" | "interest" | "bidding" | "myturn" = "idle"

  if (!currentLot || currentLot.phase === "pending" || currentLot.phase === "concluded") {
    headline = "No player currently up for bid."
  } else {
    const { player, phase, current_bid, current_bidder_id, current_turn_team_id } = currentLot

    if (phase === "interest") {
      emphasis = "interest"
      headline = (
        <>
          <PositionBadge position={player.position} className="w-auto px-1.5 mr-1.5" />
          {player.web_name} — deciding who&apos;s in.
        </>
      )
    } else {
      // phase === "bidding"
      const leader = current_bidder_id ? teams.find(t => t.id === current_bidder_id) : null
      const isMe = leader?.id === myTeamId

      if (!leader || current_bid === null) {
        const firstBidder = current_turn_team_id ? teams.find(t => t.id === current_turn_team_id) : null
        emphasis = "bidding"
        headline = (
          <>
            <PositionBadge position={player.position} className="w-auto px-1.5 mr-1.5" />
            {player.web_name} — bidding open, awaiting opening bid
            {firstBidder ? ` from ${firstBidder.short_name}` : ""}.
          </>
        )
      } else {
        emphasis = "bidding"
        headline = (
          <>
            <PositionBadge position={player.position} className="w-auto px-1.5 mr-1.5" />
            {isMe ? "You're" : `${leader.short_name} is`} leading the bid for{" "}
            <span className="font-semibold text-foreground">{player.web_name}</span> at{" "}
            <span className="font-mono font-semibold text-emerald-500">{formatMoney(current_bid)}</span>.
          </>
        )
      }

      const myBid = bids.find(b => b.team_id === myTeamId)
      if (myBid?.is_folded) {
        subline = "You've folded — out of this one."
      } else {
        const eligibleIds = new Set(
          auctionOrder.filter(id => {
            const b = bids.find(bid => bid.team_id === id)
            return b ? !b.is_folded : false
          })
        )
        const turns = turnsUntilTeamBids(auctionOrder, current_turn_team_id, eligibleIds, myTeamId)
        if (turns === 0) {
          emphasis = "myturn"
          subline = "It's your turn to bid!"
        } else if (turns !== null) {
          subline = `You'll be up in ${turns} bid${turns === 1 ? "" : "s"}.`
        }
      }
    }
  }

  return (
    <Card
      className={cn(
        "sticky top-20 z-10 px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap",
        emphasis === "myturn" && "border-amber-500/60 bg-amber-500/10",
        emphasis === "bidding" && "border-emerald-500/40 bg-emerald-500/5",
        emphasis === "interest" && "border-amber-500/40 bg-amber-500/5",
        emphasis === "idle" && "border-border/60",
      )}
    >
      <p className="text-sm flex items-center flex-wrap">{headline}</p>
      {subline && (
        <p className={cn(
          "text-sm font-medium shrink-0",
          emphasis === "myturn" ? "text-amber-500" : "text-muted-foreground",
        )}>
          {subline}
        </p>
      )}
    </Card>
  )
}
