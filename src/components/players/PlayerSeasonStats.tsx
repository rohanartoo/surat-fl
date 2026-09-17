import { cn } from "@/lib/utils"
import type { Player } from "@/types"

/**
 * Season-to-date FPL totals grid — shared by the live lot console and the
 * view-only stats expanded in the player list (`compact`, tighter to fit
 * inside a list row).
 */
export function PlayerSeasonStats({ player, compact = false }: { player: Player; compact?: boolean }) {
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
    <div className={cn("grid grid-cols-4", compact ? "gap-1.5" : "gap-2")}>
      {stats.map(({ label, value }) => (
        <div key={label} className={cn("bg-secondary rounded-md text-center", compact ? "px-1.5 py-1" : "p-2")}>
          <p className={cn(
            "text-[9px] uppercase tracking-widest font-medium text-muted-foreground leading-none",
            compact ? "mb-0.5" : "mb-1",
          )}>{label}</p>
          <p className={cn("font-semibold font-mono", compact ? "text-sm" : "text-base")}>{value}</p>
        </div>
      ))}
    </div>
  )
}
