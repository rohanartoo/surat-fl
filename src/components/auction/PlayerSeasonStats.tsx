import type { Player } from "@/types"

/** Season-to-date FPL totals grid — shared by the live lot console and the view-only stats dialog. */
export function PlayerSeasonStats({ player }: { player: Player }) {
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
    <div className="grid grid-cols-4 gap-2">
      {stats.map(({ label, value }) => (
        <div key={label} className="bg-secondary rounded-md p-2 text-center">
          <p className="text-[9px] uppercase tracking-widest font-medium text-muted-foreground leading-none mb-1">{label}</p>
          <p className="text-base font-semibold font-mono">{value}</p>
        </div>
      ))}
    </div>
  )
}
