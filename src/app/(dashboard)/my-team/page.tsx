import { redirect } from "next/navigation"
import { getProfile } from "@/lib/roles"

/**
 * Thin nav shortcut — resolves the logged-in team's own id and redirects to
 * the existing /team/[id] page (squad management + gameweek performance)
 * rather than duplicating any of its logic.
 */
export default async function MyTeamPage() {
  const profile = await getProfile()
  if (!profile?.team_id) redirect("/dashboard")
  redirect(`/team/${profile.team_id}`)
}
