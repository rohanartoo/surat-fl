import { repairCaptaincy } from "@/lib/auction-engine"

/**
 * Re-checks a team's Starting XI captain/vice-captain flags and backfills
 * them via repairCaptaincy if either holder has left the Starting XI (e.g.
 * benched, dropped, or traded away). Shared by any endpoint that can change
 * who's in a team's Starting XI.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function repairTeamCaptaincy(supabase: any, teamId: string): Promise<{ captain_id: string | null; vice_captain_id: string | null }> {
  const { data: starters } = await supabase
    .from("roster_entries")
    .select("id, base_price, is_captain, is_vice_captain")
    .eq("team_id", teamId)
    .eq("slot_type", "starting")

  const starting = (starters ?? []) as { id: string; base_price: number; is_captain: boolean; is_vice_captain: boolean }[]
  const { captainId, viceCaptainId, changed } = repairCaptaincy(starting)

  if (changed) {
    await supabase.from("roster_entries").update({ is_captain: false }).eq("team_id", teamId)
    await supabase.from("roster_entries").update({ is_vice_captain: false }).eq("team_id", teamId)
    if (captainId) await supabase.from("roster_entries").update({ is_captain: true }).eq("id", captainId)
    if (viceCaptainId) await supabase.from("roster_entries").update({ is_vice_captain: true }).eq("id", viceCaptainId)
  }

  return { captain_id: captainId, vice_captain_id: viceCaptainId }
}
