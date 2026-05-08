import { createClient } from "@/lib/supabase/server"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatMoney, positionColor, cn } from "@/lib/utils"
import type { LeagueTeam, RosterEntry, Player, Position } from "@/types"
import { SQUAD_RULES } from "@/types"

const POSITION_ORDER: Position[] = ["GK", "DEF", "MID", "FWD"]

async function getAllTeams() {
  const supabase = await createClient()

  const { data: teams } = await supabase.from("teams").select("*").order("name")
  const { data: roster } = await supabase
    .from("roster_entries")
    .select("*, player:players(*)")
    .eq("is_active", true)

  return { teams: teams ?? [], roster: roster ?? [] }
}

export default async function TeamsPage() {
  const { teams, roster } = await getAllTeams()

  const rosterByTeam = (roster as (RosterEntry & { player: Player })[]).reduce<
    Record<string, (RosterEntry & { player: Player })[]>
  >((acc, entry) => {
    if (!acc[entry.team_id]) acc[entry.team_id] = []
    acc[entry.team_id].push(entry)
    return acc
  }, {})

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">All Teams</h1>
        <p className="text-sm text-muted-foreground mt-1">{teams.length} teams in the league</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {teams.map((team: LeagueTeam) => {
          const entries = rosterByTeam[team.id] ?? []
          const byPos = POSITION_ORDER.reduce<Record<Position, (RosterEntry & { player: Player })[]>>(
            (acc, pos) => {
              acc[pos] = entries.filter((e) => e.player.position === pos)
              return acc
            },
            { GK: [], DEF: [], MID: [], FWD: [] }
          )

          return (
            <Card key={team.id} className="border-border/60">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <Link href={`/team/${team.id}`}>
                    <CardTitle className="text-base hover:text-emerald-500 transition-colors cursor-pointer">
                      {team.name}
                    </CardTitle>
                  </Link>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-xs">
                      {formatMoney(team.budget)}
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      {entries.length}/15
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-4 gap-3">
                  {POSITION_ORDER.map((pos) => {
                    const players = byPos[pos]
                    const slots = SQUAD_RULES.slots[pos]
                    return (
                      <div key={pos} className="space-y-1">
                        <p className={cn("text-xs font-medium", positionColor(pos))}>{pos}</p>
                        {players.map((e) => (
                          <p key={e.id} className="text-xs text-foreground leading-snug truncate" title={e.player.web_name}>
                            {e.player.web_name}
                          </p>
                        ))}
                        {Array.from({ length: slots - players.length }).map((_, i) => (
                          <p key={i} className="text-xs text-muted-foreground/40 italic">—</p>
                        ))}
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
