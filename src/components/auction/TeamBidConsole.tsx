"use client"

import { useState, useEffect } from "react"
import { useAuction } from "./AuctionProvider"
import { useApiAction } from "@/hooks/useApiAction"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { PositionBadge } from "@/components/ui/PositionBadge"
import { formatMoney, cn } from "@/lib/utils"
import { getMinNextBid, getMaxBid } from "@/lib/auction-engine"
import type { LeagueTeam, Bid, Position } from "@/types"
import { SQUAD_RULES } from "@/types"

// ── Per-team row ──────────────────────────────────────────────────────────────

function TeamBidRow({
  team, bid, phase, filledSlots, position, isCurrentTurn,
}: {
  team: LeagueTeam
  bid: Bid | undefined
  phase: "interest" | "bidding"
  filledSlots: number
  position: Position
  isCurrentTurn: boolean
}) {
  const isFull = filledSlots >= SQUAD_RULES.slots[position]
  const isFolded = bid?.is_folded
  const isInterested = bid?.is_interested
  const notInterested = bid !== undefined && !isInterested

  return (
    <div className={cn(
      "flex items-center justify-between py-2 px-3 rounded-md transition-colors",
      isCurrentTurn && "bg-amber-500/15 ring-2 ring-amber-500/50",
      (isFull || isFolded || notInterested) && "opacity-40",
    )}>
      <div className="flex items-center gap-2">
        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: team.color }} />
        <span className="text-sm font-medium">{team.short_name}</span>
        {isCurrentTurn && phase === "bidding" && (
          <Badge variant="outline" className="text-[10px] h-4 px-1 text-amber-500 border-amber-500/40 animate-pulse">
            Turn
          </Badge>
        )}
        {isFull && <Badge variant="secondary" className="text-[10px] h-4 px-1">Full</Badge>}
        {isFolded && <Badge variant="outline" className="text-[10px] h-4 px-1 text-muted-foreground">Folded</Badge>}
        {notInterested && phase === "interest" && (
          <Badge variant="outline" className="text-[10px] h-4 px-1 text-muted-foreground">Passed</Badge>
        )}
        {isInterested && phase === "interest" && (
          <Badge variant="outline" className="text-[10px] h-4 px-1 text-emerald-500 border-emerald-500/30">In</Badge>
        )}
      </div>
      <div className="text-right">
        {bid?.amount != null ? (
          <>
            <span className="text-sm font-mono font-medium">{formatMoney(bid.amount)}</span>
            <p className="text-[10px] font-mono text-muted-foreground">
              {formatMoney(team.budget - bid.amount)} left if wins
            </p>
          </>
        ) : (
          <span className="text-xs font-mono text-muted-foreground">{formatMoney(team.budget)}</span>
        )}
      </div>
    </div>
  )
}

// ── My action panel ───────────────────────────────────────────────────────────

function MyBidPanel({
  myTeam, myBid, currentBid, basePrice, myFilledSlots, lotId, phase, isMyTurn, currentBidderId, myTeamId, onAction,
}: {
  myTeam: LeagueTeam
  myBid: Bid | undefined
  currentBid: number | null
  basePrice: number
  myFilledSlots: number
  lotId: string
  phase: "interest" | "bidding"
  isMyTurn: boolean
  currentBidderId: string | null
  myTeamId: string
  onAction: () => Promise<void>
}) {
  const [bidAmount, setBidAmount] = useState("")
  const { post: apiPost, loading, error, setError } = useApiAction("/api/auction")

  useEffect(() => {
    setBidAmount("")
    setError(null)
  }, [currentBid, setError])

  async function post(action: string, body: object) {
    const ok = await apiPost(action, body)
    if (ok) await onAction()
  }

  const emptySlots = SQUAD_RULES.total - myFilledSlots
  const minBid = getMinNextBid(currentBid, basePrice)
  const maxBid = getMaxBid(myTeam.budget, emptySlots)
  const isFolded = myBid?.is_folded
  const canUndo = myBid?.amount != null && currentBidderId === myTeamId && !isMyTurn

  // ── Interest phase ──────────────────────────────────────────────────────────
  if (phase === "interest") {
    const myInterest = myBid?.is_interested
    return (
      <div className="space-y-3 p-4 rounded-lg border border-border/60 bg-secondary/80">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Your action</p>
        <div className="flex gap-2">
          <Button
            className={cn("flex-1", myInterest === true && "border-emerald-500 text-emerald-500")}
            variant={myInterest === true ? "outline" : "default"}
            disabled={loading}
            onClick={() => post("declare-interest", { lot_id: lotId, is_interested: true })}
          >
            {myInterest === true ? "✓ Interested" : "I'm Interested"}
          </Button>
          <Button
            className="flex-1"
            variant={myInterest === false ? "secondary" : "outline"}
            disabled={loading}
            onClick={() => post("declare-interest", { lot_id: lotId, is_interested: false })}
          >
            Pass
          </Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    )
  }

  // ── Bidding phase ───────────────────────────────────────────────────────────
  if (phase === "bidding") {
    if (isFolded) {
      return (
        <div className="p-4 rounded-lg border border-border/60 bg-secondary/80">
          <p className="text-sm text-muted-foreground italic">You folded. Waiting for result…</p>
        </div>
      )
    }

    if (!isMyTurn) {
      return (
        <div className="space-y-3 p-4 rounded-lg border border-border/60 bg-secondary/80">
          <p className="text-sm text-muted-foreground italic">Waiting for other team to bid or fold…</p>
          {canUndo && (
            <Button
              variant="outline"
              size="sm"
              className="w-full text-muted-foreground"
              disabled={loading}
              onClick={() => post("undo-bid", { lot_id: lotId })}
            >
              Undo my bid ({myBid?.amount != null ? formatMoney(myBid.amount) : ""})
            </Button>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )
    }

    return (
      <div className="space-y-3 p-4 rounded-lg border border-amber-500/50 bg-amber-500/10">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-amber-500">Your turn to bid</p>
          <div className="text-xs text-muted-foreground font-mono space-x-3">
            <span>Min: {formatMoney(minBid)}</span>
            <span>Max: {formatMoney(maxBid)}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">£</span>
            <Input
              type="number"
              min={minBid}
              max={maxBid}
              step={1}
              placeholder={String(minBid)}
              className="pl-7 font-mono"
              value={bidAmount}
              onChange={e => setBidAmount(e.target.value)}
              autoFocus
            />
          </div>
          <Button
            className="w-16 shrink-0"
            disabled={loading || !bidAmount}
            onClick={() => {
              const amount = parseInt(bidAmount, 10)
              if (isNaN(amount)) return
              post("place-bid", { lot_id: lotId, amount })
            }}
          >
            Bid
          </Button>
        </div>
        <Button
          variant="outline"
          className="w-full text-muted-foreground hover:text-destructive hover:border-destructive/50"
          disabled={loading}
          onClick={() => post("fold", { lot_id: lotId })}
        >
          Fold
        </Button>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    )
  }

  return null
}

// ── MyActionPanel — exported separately so the page can place it at the top ──

export function MyActionPanel() {
  const { currentLot, bids, teams, myTeamId, myRole, refresh, filledSlotsByTeam } = useAuction()

  if (myRole !== "team" || !myTeamId) return null
  if (!currentLot || currentLot.phase === "concluded" || currentLot.phase === "pending") return null

  const { phase, current_bid, current_bidder_id, player, id: lotId, current_turn_team_id } = currentLot
  const position = player.position as Position
  const myTeam = teams.find(t => t.id === myTeamId)
  const myBid = bids.find(b => b.team_id === myTeamId)
  const isMyTurn = current_turn_team_id === myTeamId

  if (!myTeam) return null

  return (
    <MyBidPanel
      myTeam={myTeam}
      myBid={myBid}
      currentBid={current_bid ?? null}
      basePrice={player.base_price}
      myFilledSlots={Object.values(filledSlotsByTeam[myTeamId] ?? {}).reduce((a, b) => a + b, 0)}
      lotId={lotId}
      phase={phase as "interest" | "bidding"}
      isMyTurn={isMyTurn}
      currentBidderId={current_bidder_id ?? null}
      myTeamId={myTeamId}
      onAction={refresh}
    />
  )
}

// ── Main bid status panel (team rows) ─────────────────────────────────────────

export function TeamBidConsole() {
  const { currentLot, bids, teams, myTeamId, myRole, filledSlotsByTeam } = useAuction()

  if (!currentLot || currentLot.phase === "concluded" || currentLot.phase === "pending") {
    return (
      <Card className="border-border/60">
        <CardContent className="py-8 text-center">
          <p className="text-sm text-muted-foreground">Waiting for next player…</p>
        </CardContent>
      </Card>
    )
  }

  const { phase, player, id: lotId, current_turn_team_id } = currentLot
  const position = player.position as Position
  const turnTeam = current_turn_team_id ? teams.find(t => t.id === current_turn_team_id) : null
  const isMyTurn = current_turn_team_id === myTeamId

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Bids</CardTitle>
          {phase === "bidding" && turnTeam && (
            <p className="text-xs text-amber-500 font-medium">
              {isMyTurn ? "Your turn" : `${turnTeam.short_name}'s turn`}
            </p>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-1 px-3 pb-3">
        {teams.map(team => {
          const bid = bids.find(b => b.team_id === team.id)
          const filled = filledSlotsByTeam[team.id]?.[position] ?? 0
          return (
            <TeamBidRow
              key={team.id}
              team={team}
              bid={bid}
              phase={phase as "interest" | "bidding"}
              filledSlots={filled}
              position={position}
              isCurrentTurn={current_turn_team_id === team.id}
            />
          )
        })}
      </CardContent>
    </Card>
  )
}
