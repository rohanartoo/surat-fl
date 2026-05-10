import { getProfile } from "@/lib/roles"
import { createClient } from "@/lib/supabase/server"
import { TeamSettingsForm } from "@/components/settings/TeamSettingsForm"
import { CreateUserForm } from "@/components/settings/CreateUserForm"

export default async function SettingsPage() {
  const profile = await getProfile()

  if (!profile || profile.role === "guest") {
    return (
      <div className="max-w-lg space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Settings are not available for guest sessions.
        </p>
      </div>
    )
  }

  const supabase = await createClient()
  const [teamResult, teamsResult] = await Promise.all([
    profile.team_id
      ? supabase.from("teams").select("id, display_name").eq("id", profile.team_id).single()
      : Promise.resolve({ data: null }),
    profile.role === "admin"
      ? supabase.from("teams").select("id, display_name").order("display_name")
      : Promise.resolve({ data: null }),
  ])

  const team = teamResult.data
  const allTeams = teamsResult.data ?? []

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your account credentials.</p>
      </div>

      {team ? (
        <TeamSettingsForm
          currentUsername={profile.username}
          teamId={team.id}
          teamDisplayName={team.display_name}
        />
      ) : (
        // Admin / AM with no team_id — only password change available
        <TeamSettingsForm
          currentUsername={profile.username}
          teamId=""
          teamDisplayName=""
        />
      )}

      {profile.role === "admin" && (
        <CreateUserForm teams={allTeams} />
      )}
    </div>
  )
}
