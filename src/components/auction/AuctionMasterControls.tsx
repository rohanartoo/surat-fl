"use client"

import { useState, useEffect } from "react"
import { useAuction } from "./AuctionProvider"
import { useApiAction } from "@/hooks/useApiAction"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { roleIsAM, roleIsAdmin } from "@/lib/role-utils"
import { formatMoney } from "@/lib/utils"

export function AuctionMasterControls() {
  const { auction, currentLot, bids, teams, myRole, refresh } = useAuction()
  const { post: apiPost, loading, error, setError } = useApiAction("/api/auction")
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)
  const [localOrder, setLocalOrder] = useState<string[] | null>(null)
  const [stagedDropCounts, setStagedDropCounts] = useState<Record<string, number>>({})

  // Fetch staged drop counts when auction is pending and non-initial
  useEffect(() => {
    if (!auction || auction.status !== "pending" || auction.type === "initial") {
      setStagedDropCounts({})
      return
    }
    const fetchDrops = async () => {
      const res = await fetch("/api/drops/staged-counts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auction_id: auction.id }),
      })
      if (res.ok) {
        const data = await res.json()
        setStagedDropCounts(data.counts ?? {})
      }
    }
    fetchDrops()
  }, [auction?.id, auction?.status, auction?.type])

  if (!roleIsAM(myRole)) return null

  async function post(action: string, body: object = {}) {
    const ok = await apiPost(action, body)
    if (ok) await refresh()
    return ok
  }

  async function handleReset() {
    setResetLoading(true)
    setError(null)
    setConfirmReset(false)
    try {
      const res = await fetch("/api/admin/reset", { method: "POST" })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Reset failed.")
        return
      }
      await refresh()
    } finally {
      setResetLoading(false)
    }
  }

  const isAdmin = roleIsAdmin(myRole)

  const resetSection = isAdmin ? (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Dev / Testing</p>
      {confirmReset ? (
        <div className="space-y-1.5">
          <p className="text-xs text-destructive">This will wipe all auctions, rosters, and reset all budgets. Are you sure?</p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              className="flex-1"
              disabled={resetLoading}
              onClick={handleReset}
            >
              Yes, reset everything
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              disabled={resetLoading}
              onClick={() => setConfirmReset(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="w-full text-muted-foreground hover:text-destructive hover:border-destructive/50"
          disabled={resetLoading}
          onClick={() => setConfirmReset(true)}
        >
          Reset to clean slate
        </Button>
      )}
    </div>
  ) : undefined

  // ── No auction yet ────────────────────────────────────────────────────────
  if (!auction) {
    return (
      <AMCard title="Auction Master" resetSection={resetSection}>
        <p className="text-xs text-muted-foreground mb-3">No auction is currently open.</p>
        <div className="flex flex-col gap-2">
          {(["initial", "post_summer", "mini", "post_jan"] as const).map(type => (
            <Button
              key={type}
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => post("create", { type })}
            >
              Create {type.replace("_", "-")} auction
            </Button>
          ))}
        </div>
        {error && <p className="text-xs text-destructive mt-2">{error}</p>}
      </AMCard>
    )
  }

  // ── Auction is pending — show order setup ────────────────────────────────
  if (auction.status === "pending") {
    const savedOrder = (auction.auction_order as string[]) ?? []
    // Use local editing state if set, otherwise fall back to what's saved
    const displayOrder = localOrder ?? savedOrder
    const orderedTeams = displayOrder
      .map(id => teams.find(t => t.id === id))
      .filter(Boolean) as typeof teams

    function moveUp(index: number) {
      if (index === 0) return
      const next = [...displayOrder]
      ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
      setLocalOrder(next)
    }
    function moveDown(index: number) {
      if (index === displayOrder.length - 1) return
      const next = [...displayOrder]
      ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
      setLocalOrder(next)
    }

    async function saveOrder() {
      if (!localOrder) return
      await post("set-order", { auction_id: auction!.id, order: localOrder })
      setLocalOrder(null)
    }

    return (
      <AMCard title="Auction Master" resetSection={resetSection}>
        <div className="space-y-1 mb-3 text-sm">
          <p className="text-muted-foreground">Type: <span className="text-foreground font-medium capitalize">{auction.type.replace("_", "-")}</span></p>
          <p className="text-muted-foreground">Position: <span className="text-foreground font-medium">{auction.current_position_category}</span></p>
        </div>

        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-2">Bid order</p>
        <div className="space-y-1 mb-3">
          {orderedTeams.map((team, i) => (
            <div key={team.id} className="flex items-center gap-2 py-1 px-2 rounded bg-secondary/40">
              <span className="text-xs font-mono text-muted-foreground w-4">{i + 1}</span>
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: team.color }} />
              <span className="text-sm flex-1">{team.short_name}</span>
              <button
                className="text-muted-foreground hover:text-foreground text-xs px-1 disabled:opacity-30"
                disabled={i === 0 || loading}
                onClick={() => moveUp(i)}
              >↑</button>
              <button
                className="text-muted-foreground hover:text-foreground text-xs px-1 disabled:opacity-30"
                disabled={i === orderedTeams.length - 1 || loading}
                onClick={() => moveDown(i)}
              >↓</button>
            </div>
          ))}
        </div>

        {/* Staged drops summary for non-initial auctions */}
        {auction.type !== "initial" && Object.keys(stagedDropCounts).length > 0 && (
          <div className="mb-3">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1.5">Staged drops</p>
            <div className="space-y-1">
              {teams.map(team => {
                const count = stagedDropCounts[team.id] ?? 0
                if (count === 0) return null
                return (
                  <div key={team.id} className="flex items-center justify-between text-xs px-2 py-1 rounded bg-secondary/40">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: team.color }} />
                      <span>{team.short_name}</span>
                    </div>
                    <Badge variant="secondary" className="text-[10px] h-4 px-1 tabular-nums">{count}</Badge>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {localOrder && (
            <Button size="sm" variant="outline" disabled={loading} onClick={saveOrder}>
              Save order
            </Button>
          )}
          <Button
            className="w-full"
            disabled={loading || savedOrder.length === 0}
            onClick={() => post("start", { auction_id: auction.id })}
          >
            {auction.type === "initial" ? "Start Auction" : "Lock Drops & Start Auction"}
          </Button>
        </div>
        {error && <p className="text-xs text-destructive mt-2">{error}</p>}
      </AMCard>
    )
  }

  // ── Auction active, no lot open ───────────────────────────────────────────
  if (auction.status === "active" && !currentLot) {
    return (
      <AMCard title="Auction Master" resetSection={resetSection}>
        <div className="space-y-1 mb-4 text-sm">
          <p className="text-muted-foreground">
            Position:{" "}
            <span className="text-foreground font-medium">{auction.current_position_category}</span>
          </p>
        </div>
        <p className="text-xs text-muted-foreground italic">
          Click "Nominate" on a player in the list to open a lot.
        </p>
        {error && <p className="text-xs text-destructive mt-2">{error}</p>}
      </AMCard>
    )
  }

  // ── Lot is open ───────────────────────────────────────────────────────────
  if (!currentLot) return null

  const { id: lotId, phase, current_bid, current_bidder_id, player } = currentLot

  const activeBidders = bids.filter(b => b.is_interested && !b.is_folded)
  const interestedCount = bids.filter(b => b.is_interested).length

  // For the assign button: winner is the last active bidder (or current high bidder)
  const pendingWinner = activeBidders.length === 1
    ? teams.find(t => t.id === activeBidders[0].team_id)
    : current_bidder_id
      ? teams.find(t => t.id === current_bidder_id)
      : null
  const assignPrice = current_bid ?? player.base_price
  const canAssign = phase === "bidding" && pendingWinner !== null && activeBidders.length <= 1

  return (
    <AMCard title="Auction Master" resetSection={resetSection}>
      <div className="space-y-1 mb-3 text-sm">
        <p className="text-muted-foreground">
          Player: <span className="text-foreground font-medium">{player.web_name}</span>
        </p>
        {current_bid !== null && (
          <p className="text-muted-foreground">
            Current bid:{" "}
            <span className="text-emerald-500 font-medium font-mono">{formatMoney(current_bid)}</span>
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {phase === "interest" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="flex-1"
                disabled={loading}
                onClick={() => post("start-bidding", { lot_id: lotId })}
              >
                Close Interest &amp; Start Bidding
              </Button>
              {interestedCount > 0 && (
                <Badge variant="secondary" className="shrink-0 tabular-nums">
                  {interestedCount} in
                </Badge>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="w-full text-xs text-muted-foreground"
              disabled={loading}
              onClick={() => post("reset-timer", { lot_id: lotId })}
            >
              Reset timer
            </Button>
          </div>
        )}

        {phase === "bidding" && activeBidders.length > 1 && (
          <p className="text-xs text-muted-foreground italic">
            {activeBidders.length} teams still active — waiting for fold or bid.
          </p>
        )}

        {canAssign && pendingWinner && (
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            disabled={loading}
            onClick={() => post("assign-player", { lot_id: lotId })}
          >
            Assign {pendingWinner.short_name} — {formatMoney(assignPrice)}
          </Button>
        )}
      </div>

      {error && <p className="text-xs text-destructive mt-2">{error}</p>}

      <Separator className="my-3" />

      <p className="text-xs text-muted-foreground">
        Phase: <span className="font-medium capitalize">{phase}</span>
      </p>
    </AMCard>
  )
}

function AMCard({
  title,
  children,
  resetSection,
}: {
  title: string
  children: React.ReactNode
  resetSection?: React.ReactNode
}) {
  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-amber-500">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {children}
        {resetSection && (
          <>
            <Separator className="my-3" />
            {resetSection}
          </>
        )}
      </CardContent>
    </Card>
  )
}
