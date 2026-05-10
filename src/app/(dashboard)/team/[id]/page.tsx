import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/lib/roles"
import { notFound } from "next/navigation"
import { SquadManager } from "@/components/team/SquadManager"
import { AdminTeamControls } from "@/components/settings/AdminTeamControls"
import { getDropQuota } from "@/lib/drops"
import type { LeagueTeam, Player, RosterEntry, DropQuotaSummary, AuctionType } from "@/types"

interface PageProps {
  params: Promise<{ id: string }>
}

async function getTeamData(id: string) {
  const supabase = await createClient()

  const [{ data: team }, { data: roster }, { data: auction }, { data: teamProfile }] = await Promise.all([
    supabase.from("teams").select("*").eq("id", id).single(),
    supabase.from("roster_entries").select("*, player:players(*)").eq("team_id", id).order("base_price", { ascending: false }),
    supabase.from("auctions").select("id, type, status").in("status", ["pending", "active"]).maybeSingle(),
    // Fetch the profile linked to this team (for admin controls)
    supabase.from("profiles").select("id, username").eq("team_id", id).maybeSingle(),
  ])

  if (!team) return null

  return {
    team: team as LeagueTeam,
    roster: (roster ?? []) as (RosterEntry & { player: Player })[],
    auction: auction ?? null,
    teamProfile: teamProfile as { id: string; username: string } | null,
  }
}

export default async function TeamPage({ params }: PageProps) {
  const { id } = await params
  const [data, profile] = await Promise.all([getTeamData(id), getProfile()])
  if (!data) notFound()

  const { team, roster, auction, teamProfile } = data
  const isAdmin = profile?.role === "admin"
  const canEdit = isAdmin || profile?.team_id === team.id

  // Compute drop quota for the owning team if there's an active/pending auction
  let quotaSummary: DropQuotaSummary | undefined
  if (auction && (profile?.team_id === team.id || isAdmin)) {
    const supabase = await createClient()
    quotaSummary = await getDropQuota(team.id, auction.id, auction.type as AuctionType, supabase)
  }

  const dropsLocked = auction?.status === "active"

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{team.display_name}</h1>
          {!canEdit && (
            <p className="text-xs text-muted-foreground mt-1">Read-only view</p>
          )}
        </div>
        <div
          className="w-3 h-3 rounded-full mt-2"
          style={{ backgroundColor: team.color }}
          title={team.short_name}
        />
      </div>

      <SquadManager
        initialRoster={roster}
        teamBudget={team.budget}
        canEdit={canEdit}
        quotaSummary={quotaSummary}
        dropsLocked={dropsLocked}
      />

      {/* Admin controls — only visible to admin, only when the team has a linked profile */}
      {isAdmin && teamProfile && (
        <AdminTeamControls
          teamId={team.id}
          teamDisplayName={team.display_name}
          targetUserId={teamProfile.id}
          targetUsername={teamProfile.username}
        />
      )}
    </div>
  )
}
