import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { requireRole } from "@/lib/roles"
import { getTeamGameweekPerformance } from "@/lib/scoring"

function createClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function err(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

/**
 * POST /api/scoring/team-gameweek
 * Body: { team_id: string, gameweek: number }
 * Visible to everyone (any logged-in role) — same as the Teams overview
 * page, squad and budgets are already public within the league.
 */
export async function POST(request: NextRequest) {
  try {
    await requireRole("guest")
  } catch {
    return err("Requires role: guest", 403)
  }

  const { team_id, gameweek } = await request.json().catch(() => ({}))
  if (!team_id || typeof gameweek !== "number") {
    return err("team_id and gameweek required.")
  }

  const supabase = createClient()
  const performance = await getTeamGameweekPerformance(team_id, gameweek, supabase)
  return NextResponse.json(performance)
}
