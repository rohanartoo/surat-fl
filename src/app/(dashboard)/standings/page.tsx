import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/lib/roles"
import { getStandings } from "@/lib/scoring"
import { StandingsTable } from "@/components/standings/StandingsTable"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

async function SyncForm() {
  return (
    <form
      action={async (data: FormData) => {
        "use server"
        const gw = parseInt(data.get("gameweek") as string, 10)
        if (!Number.isInteger(gw)) return
        await fetch(`${process.env.NEXT_PUBLIC_SITE_URL}/api/scoring/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gameweek: gw }),
        })
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
          <StandingsTable standings={standings} gameweeks={gameweeks} />
        </CardContent>
      </Card>
    </div>
  )
}
