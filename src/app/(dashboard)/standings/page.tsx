import { createClient as createServiceClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { getProfile, requireRole } from "@/lib/roles"
import { getStandings, runManualGameweekSync } from "@/lib/scoring"
import { StandingsTable } from "@/components/standings/StandingsTable"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

async function SyncForm() {
  return (
    <form
      action={async (data: FormData) => {
        "use server"
        // Calls the shared sync logic directly rather than making a
        // self-referential fetch back into this app's own /api/scoring/sync
        // route — that fetch used `${process.env.NEXT_PUBLIC_SITE_URL}/...`,
        // which threw "Failed to parse URL from undefined/..." in production
        // whenever that env var wasn't set, taking this whole page down with
        // a generic Server Action error. requireRole checks the caller is
        // admin via the cookie session, but the actual sync runs on a
        // service-role client — gameweek_scoring_status's write policy is
        // service_role-only (see its migration), and syncGameweekPoints
        // writes there once a gameweek is finalized, so the cookie-session
        // client isn't sufficient here even though it can write
        // gameweek_points directly.
        await requireRole("admin")
        const gw = parseInt(data.get("gameweek") as string, 10)
        if (!Number.isInteger(gw)) return
        const supabase = createServiceClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        )
        await runManualGameweekSync(gw, supabase)
      }}
      className="flex gap-2 items-end"
    >
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground font-medium" htmlFor="gw-input">
          Gameweek
        </label>
        <Input id="gw-input" name="gameweek" type="number" min={1} max={38} className="w-20 h-8 text-sm" placeholder="1" />
      </div>
      <Button size="sm" type="submit" variant="outline">Sync GW points</Button>
    </form>
  )
}

export default async function StandingsPage() {
  const supabase = await createClient()
  const [standings, profile] = await Promise.all([
    getStandings(supabase),
    getProfile(),
  ])

  const isAdmin = profile?.role === "admin"

  // Derive the set of gameweeks that have data, sorted ascending
  const gwSet = new Set<number>()
  for (const row of standings) {
    for (const gw of Object.keys(row.by_gameweek)) gwSet.add(Number(gw))
  }
  const gameweeks = [...gwSet].sort((a, b) => a - b)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Standings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {gameweeks.length > 0
              ? `${gameweeks.length} gameweek${gameweeks.length > 1 ? "s" : ""} scored`
              : "No gameweeks scored yet"}
          </p>
        </div>
        {isAdmin && <SyncForm />}
      </div>

      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">League Table</CardTitle>
        </CardHeader>
        <CardContent>
          <StandingsTable standings={standings} gameweeks={gameweeks} myTeamId={profile?.team_id ?? undefined} />
        </CardContent>
      </Card>
    </div>
  )
}
