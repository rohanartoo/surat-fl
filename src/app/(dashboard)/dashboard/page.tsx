import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { formatMoney, positionColor } from "@/lib/utils"
import Link from "next/link"
import type { LeagueTeam, RosterEntry } from "@/types"

async function getLeagueOverview() {
  const supabase = await createClient()

  const { data: teams, error: teamsError } = await supabase
    .from("teams")
    .select("*")
    .order("budget", { ascending: false })

  if (teamsError) console.error("[dashboard] teams error:", teamsError)

  const { data: rosters } = await supabase
    .from("roster_entries")
    .select("team_id")
    .in("slot_type", ["starting", "bench"])

  return { teams: teams ?? [], rosters: rosters ?? [] }
}

function TeamCard({ team, playerCount }: { team: LeagueTeam; playerCount: number }) {
  const slotsLeft = 15 - playerCount
  const budgetPct = team.budget

  return (
    <Link href={`/team/${team.id}`}>
      <Card className="group cursor-pointer transition-all hover:border-border hover:shadow-md hover:shadow-black/5 dark:hover:shadow-black/20">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-base font-semibold group-hover:text-emerald-500 transition-colors">
                {team.display_name}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{team.short_name}</p>
            </div>
            <Badge variant="outline" className="text-xs font-mono">
              {playerCount}/15
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Budget bar */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Budget remaining</span>
              <span className="font-mono font-medium text-foreground">{formatMoney(team.budget)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${Math.min(budgetPct, 100)}%` }}
              />
            </div>
          </div>

          <div className="flex gap-3 text-xs text-muted-foreground">
            <span>
              <span className="font-medium text-foreground">{slotsLeft}</span> slot{slotsLeft !== 1 ? "s" : ""} left
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

export default async function DashboardPage() {
  const { teams, rosters } = await getLeagueOverview()

  const playerCountByTeam = (rosters as { team_id: string }[]).reduce<Record<string, number>>((acc, entry) => {
    acc[entry.team_id] = (acc[entry.team_id] ?? 0) + 1
    return acc
  }, {})

  const totalBudget = teams.reduce((sum: number, t: LeagueTeam) => sum + t.budget, 0)
  const totalPlayers = (rosters as unknown[]).length

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">League Overview</h1>
        <p className="text-sm text-muted-foreground mt-1">2025/26 season</p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Teams", value: teams.length },
          { label: "Players drafted", value: totalPlayers },
          { label: "Total budget left", value: formatMoney(totalBudget) },
          { label: "Avg per team", value: formatMoney(totalBudget / Math.max(teams.length, 1)) },
        ].map(({ label, value }) => (
          <Card key={label} className="border-border/60">
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-2xl font-semibold tracking-tight mt-1 font-mono">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Teams grid */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">Teams</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {teams.length === 0 ? (
            Array.from({ length: 7 }).map((_, i) => (
              <Card key={i} className="border-border/60">
                <CardHeader className="pb-3">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-3 w-16 mt-1" />
                </CardHeader>
                <CardContent className="space-y-3">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-1.5 w-full rounded-full" />
                </CardContent>
              </Card>
            ))
          ) : (
            teams.map((team: LeagueTeam) => (
              <TeamCard
                key={team.id}
                team={team}
                playerCount={playerCountByTeam[team.id] ?? 0}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
