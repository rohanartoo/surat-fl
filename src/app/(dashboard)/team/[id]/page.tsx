import { createClient } from "@/lib/supabase/server"
import { notFound } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { formatMoney, positionColor, cn } from "@/lib/utils"
import type { LeagueTeam, Player, RosterEntry, Position } from "@/types"
import { SQUAD_RULES } from "@/types"

const POSITION_ORDER: Position[] = ["GK", "DEF", "MID", "FWD"]
const POSITION_LABELS: Record<Position, string> = {
  GK: "Goalkeepers",
  DEF: "Defenders",
  MID: "Midfielders",
  FWD: "Forwards",
}

interface PageProps {
  params: Promise<{ id: string }>
}

async function getTeamData(id: string) {
  const supabase = await createClient()

  const { data: team } = await supabase
    .from("teams")
    .select("*")
    .eq("id", id)
    .single()

  if (!team) return null

  const { data: roster } = await supabase
    .from("roster_entries")
    .select("*, player:players(*)")
    .eq("team_id", id)
    .eq("is_active", true)
    .order("purchase_price", { ascending: false })

  return { team, roster: roster ?? [] }
}

function PlayerRow({ entry }: { entry: RosterEntry & { player: Player } }) {
  return (
    <div className="flex items-center justify-between py-2.5 px-1 rounded-md hover:bg-accent/50 transition-colors group">
      <div className="flex items-center gap-3">
        <Badge
          variant="outline"
          className={cn("text-xs w-10 justify-center font-medium border-0 bg-secondary", positionColor(entry.player.position))}
        >
          {entry.player.position}
        </Badge>
        <div>
          <p className="text-sm font-medium leading-none">{entry.player.web_name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{entry.player.fpl_team_short}</p>
        </div>
      </div>
      <span className="text-sm font-mono font-medium text-muted-foreground group-hover:text-foreground transition-colors">
        {formatMoney(entry.purchase_price)}
      </span>
    </div>
  )
}

export default async function TeamPage({ params }: PageProps) {
  const { id } = await params
  const data = await getTeamData(id)
  if (!data) notFound()

  const { team, roster } = data

  const byPosition = POSITION_ORDER.reduce<Record<Position, (RosterEntry & { player: Player })[]>>((acc, pos) => {
    acc[pos] = (roster as (RosterEntry & { player: Player })[]).filter((e) => e.player.position === pos)
    return acc
  }, { GK: [], DEF: [], MID: [], FWD: [] })

  const totalSpent = (roster as RosterEntry[]).reduce((sum, e) => sum + e.purchase_price, 0)
  const slotsLeft = SQUAD_RULES.total - roster.length
  const minToFill = slotsLeft * SQUAD_RULES.min_bid

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{team.name}</h1>
          <p className="text-sm text-muted-foreground mt-1">{roster.length} of 15 players</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold tracking-tight font-mono text-emerald-500">
            {formatMoney(team.budget)}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">available budget</p>
        </div>
      </div>

      {/* Budget summary */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Spent", value: formatMoney(totalSpent) },
          { label: "Slots left", value: slotsLeft.toString() },
          { label: "Min to fill", value: formatMoney(minToFill) },
        ].map(({ label, value }) => (
          <Card key={label} className="border-border/60">
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-lg font-semibold font-mono mt-0.5">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Roster by position */}
      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Squad</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {POSITION_ORDER.map((pos, i) => {
            const players = byPosition[pos]
            const slots = SQUAD_RULES.slots[pos]
            const empty = slots - players.length

            return (
              <div key={pos}>
                {i > 0 && <Separator className="mb-4" />}
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {POSITION_LABELS[pos]}
                  </p>
                  <span className="text-xs text-muted-foreground font-mono">
                    {players.length}/{slots}
                  </span>
                </div>

                <div className="space-y-0.5">
                  {players.map((entry) => (
                    <PlayerRow key={entry.id} entry={entry} />
                  ))}
                  {Array.from({ length: empty }).map((_, i) => (
                    <div
                      key={`empty-${i}`}
                      className="flex items-center gap-3 py-2.5 px-1 opacity-40"
                    >
                      <div className="w-10 h-5 rounded border border-dashed border-border" />
                      <p className="text-xs text-muted-foreground italic">Empty slot</p>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}
