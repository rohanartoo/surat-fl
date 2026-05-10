import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/lib/roles"
import { getStandings, getLastSyncedGameweek, getGameweekHighlights } from "@/lib/scoring"
import { fetchCurrentGameweek } from "@/lib/fpl"
import { StandingsTable } from "@/components/standings/StandingsTable"
import { Card, CardContent } from "@/components/ui/card"

export default async function DashboardPage() {
  const supabase = await createClient()

  const [profile, standings, currentGw, lastGw] = await Promise.all([
    getProfile(),
    getStandings(supabase),
    fetchCurrentGameweek(),
    getLastSyncedGameweek(supabase),
  ])

  const highlights = lastGw ? await getGameweekHighlights(lastGw, supabase) : null

  const gameweeks = Array.from(
    new Set(standings.flatMap(r => Object.keys(r.by_gameweek).map(Number)))
  ).sort((a, b) => a - b)

  const seasonStart = new Date().getMonth() + 1 >= 8 ? new Date().getFullYear() : new Date().getFullYear() - 1
  const season = `${seasonStart}/${String(seasonStart + 1).slice(-2)}`
  const subtitle = currentGw
    ? `Gameweek ${currentGw} · ${season} season`
    : `${season} season`

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">League Overview</h1>
        <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
      </div>

      {highlights && (highlights.playerOfTheWeek || highlights.topTeam) && (
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
            Gameweek {highlights.gameweek} highlights
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {highlights.playerOfTheWeek && (
              <Card className="border-border/60">
                <CardContent className="pt-5 pb-4 space-y-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Player of the Week</p>
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-lg font-semibold leading-tight">
                        {highlights.playerOfTheWeek.web_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {highlights.playerOfTheWeek.team_name}
                        {highlights.playerOfTheWeek.was_subbed_in && " · subbed in"}
                      </p>
                    </div>
                    <p className="text-3xl font-bold font-mono text-emerald-500">
                      {highlights.playerOfTheWeek.points}
                      <span className="text-sm font-normal text-muted-foreground ml-1">pts</span>
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {highlights.topTeam && (
              <Card className="border-border/60">
                <CardContent className="pt-5 pb-4 space-y-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Top Team</p>
                  <div className="flex items-end justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: highlights.topTeam.color }}
                      />
                      <div>
                        <p className="text-lg font-semibold leading-tight">
                          {highlights.topTeam.display_name}
                        </p>
                        <p className="text-xs text-muted-foreground">{highlights.topTeam.short_name}</p>
                      </div>
                    </div>
                    <p className="text-3xl font-bold font-mono text-amber-500">
                      {highlights.topTeam.points}
                      <span className="text-sm font-normal text-muted-foreground ml-1">pts</span>
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
          Standings
        </p>
        <StandingsTable
          standings={standings}
          gameweeks={gameweeks}
          myTeamId={profile?.team_id ?? undefined}
        />
      </div>
    </div>
  )
}
