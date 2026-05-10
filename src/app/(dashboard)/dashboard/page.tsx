import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/lib/roles"
import { getStandings } from "@/lib/scoring"
import { fetchCurrentGameweek } from "@/lib/fpl"
import { StandingsTable } from "@/components/standings/StandingsTable"

export default async function DashboardPage() {
  const supabase = await createClient()

  const [profile, standings, currentGw] = await Promise.all([
    getProfile(),
    getStandings(supabase),
    fetchCurrentGameweek(),
  ])

  const gameweeks = Array.from(
    new Set(standings.flatMap(r => Object.keys(r.by_gameweek).map(Number)))
  ).sort((a, b) => a - b)

  const subtitle = currentGw
    ? `Gameweek ${currentGw} · 2025/26 season`
    : "2025/26 season"

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">League Overview</h1>
        <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
      </div>

      <StandingsTable
        standings={standings}
        gameweeks={gameweeks}
        myTeamId={profile?.team_id ?? undefined}
      />
    </div>
  )
}
