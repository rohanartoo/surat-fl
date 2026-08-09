"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { AUCTION_TIMER_SECONDS } from "@/types"

interface AuctionTimerProps {
  timerStartedAt: string | null
  phase: "interest" | "bidding" | "pending" | "concluded"
}

export function AuctionTimer({ timerStartedAt, phase }: AuctionTimerProps) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const active = !!timerStartedAt && phase === "interest"

  useEffect(() => {
    // Nothing to tick — render guards below already hide output whenever
    // `!active`, regardless of whatever stale value `secondsLeft` still
    // holds, so there's no need to reset it here (which would mean calling
    // setState synchronously and directly in the effect body).
    if (!active) return

    function tick() {
      const elapsed = (Date.now() - new Date(timerStartedAt!).getTime()) / 1000
      const remaining = Math.max(0, AUCTION_TIMER_SECONDS - elapsed)
      setSecondsLeft(Math.ceil(remaining))
    }

    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [active, timerStartedAt])

  if (phase === "bidding") {
    return (
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        <span className="text-sm font-medium text-emerald-500">Bidding open</span>
      </div>
    )
  }

  if (!active || secondsLeft === null) return null

  const isUrgent = secondsLeft <= 10
  const pct = (secondsLeft / AUCTION_TIMER_SECONDS) * 100

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground uppercase tracking-wider">Interest window</span>
        <span className={cn(
          "text-lg font-mono font-semibold tabular-nums",
          isUrgent ? "text-rose-500" : "text-foreground"
        )}>
          {secondsLeft}s
        </span>
      </div>
      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-250",
            isUrgent ? "bg-rose-500" : "bg-emerald-500"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
