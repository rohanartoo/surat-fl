"use client"

import { useEffect, useState } from "react"

interface Props {
  deadline: string
  gameweek: number
}

/** The countdown only surfaces this close to the deadline — further out it's
 * just noise; teams don't need a week-long ticking reminder. */
export const COUNTDOWN_VISIBLE_WINDOW_MS = 6 * 60 * 60 * 1000

export function formatCountdown(ms: number): string {
  if (ms <= 0) return "now"
  const totalSeconds = Math.floor(ms / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

/**
 * Countdown to the next lineup deadline (src/lib/lineup-lock.ts). Modelled
 * directly on AuctionTimer's tick()-then-setInterval-with-cleanup shape —
 * ticks once a second rather than every 250ms since the horizon here is
 * hours/days, not seconds.
 */
export function DeadlineBanner({ deadline, gameweek }: Props) {
  const [remaining, setRemaining] = useState<number | null>(null)

  useEffect(() => {
    function tick() {
      setRemaining(new Date(deadline).getTime() - Date.now())
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [deadline])

  if (remaining === null || remaining > COUNTDOWN_VISIBLE_WINDOW_MS) return null

  const deadlineLabel = new Date(deadline).toLocaleString(undefined, {
    weekday: "short", hour: "numeric", minute: "2-digit",
  })

  return (
    <p className="text-xs text-muted-foreground bg-secondary/50 px-3 py-2 rounded-md">
      GW {gameweek} lineup deadline: {deadlineLabel} · {formatCountdown(remaining)}
    </p>
  )
}
