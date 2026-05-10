import { getProfile } from "@/lib/roles"
import { createClient } from "@/lib/supabase/server"
import { TeamNameCard, UsernameCard, PasswordCard } from "@/components/settings/TeamSettingsForm"
import { CreateUserForm } from "@/components/settings/CreateUserForm"
import { DangerZoneCard } from "@/components/settings/DangerZoneCard"

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
  const isAdmin = profile.role === "admin"

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your account.</p>
      </div>

      {/* Row 1 — Username + Password side by side */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <UsernameCard currentUsername={profile.username} />
        <PasswordCard />
      </div>

      {/* Row 2 — Team Name (only if linked to a team) */}
      {team && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <TeamNameCard teamId={team.id} teamDisplayName={team.display_name} />
        </div>
      )}

      {/* Admin section — Create User + Danger Zone side by side */}
      {isAdmin && (
        <>
          <div>
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">Admin</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <CreateUserForm teams={allTeams} />
              <DangerZoneCard />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
