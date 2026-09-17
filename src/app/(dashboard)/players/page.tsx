import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/lib/roles"
import { buildPlayerOwners } from "@/lib/drops"
import { PlayersBoard } from "@/components/players/PlayersBoard"
import type { Player, Role, SlotType } from "@/types"

export default async function PlayersPage() {
  const supabase = await createClient()

  const [{ data: playersData }, { data: rosterRows }, { data: teams }, profile] = await Promise.all([
    supabase.from("players").select("*").order("selected_by_percent", { ascending: false }),
    supabase.from("roster_entries").select("team_id, player_id, slot_type"),
    supabase.from("teams").select("id, short_name, color"),
    getProfile(),
  ])

  // Resolved server-side so other teams' staged drops never reach the browser
  // (see buildPlayerOwners / canSeeStagedDrops in src/lib/drops.ts).
  const owners = buildPlayerOwners(
    (rosterRows ?? []) as { team_id: string; player_id: number; slot_type: SlotType }[],
    (teams ?? []) as { id: string; short_name: string; color: string }[],
    { role: (profile?.role ?? "guest") as Role, teamId: profile?.team_id },
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Players</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Scout every player by position — click a player for season stats, recent form and fixtures.
        </p>
      </div>

      <PlayersBoard players={(playersData ?? []) as Player[]} owners={owners} />
    </div>
  )
}
