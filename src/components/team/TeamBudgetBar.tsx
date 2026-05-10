"use client"

import { formatMoney } from "@/lib/utils"
import { SQUAD_RULES } from "@/types"

interface Props {
  budget: number
  totalSpent: number
  activeCount: number
}

export function TeamBudgetBar({ budget, totalSpent, activeCount }: Props) {
  const slotsLeft = Math.max(0, SQUAD_RULES.total - activeCount)
  const minToFill = slotsLeft * SQUAD_RULES.min_bid
  const total = budget + totalSpent
  const spentPct = total > 0 ? Math.min(100, (totalSpent / total) * 100) : 0

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-2xl font-semibold tracking-tight font-mono text-emerald-500">
            {formatMoney(budget)}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">available budget</p>
        </div>
        <div className="text-right text-xs text-muted-foreground space-y-0.5">
          <p>Spent: <span className="font-mono text-foreground">{formatMoney(totalSpent)}</span></p>
          <p>Min to fill: <span className="font-mono text-foreground">{formatMoney(minToFill)}</span></p>
          <p>{activeCount} / {SQUAD_RULES.total} players</p>
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all"
          style={{ width: `${spentPct}%` }}
        />
      </div>
    </div>
  )
}
