import { NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { requireRole } from "@/lib/roles"
import { getLastSyncedGameweek } from "@/lib/scoring"

function createClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * GET /api/admin/simulate-gw/next
 * Admin only. Returns { nextGameweek } — one past whatever GW currently has
 * the most recent rows in gameweek_points (or GW1 if none yet).
 */
export async function GET() {
  try {
    await requireRole("admin")
  } catch {
    return NextResponse.json({ error: "Admin only." }, { status: 403 })
  }

  const supabase = createClient()
  const lastSynced = await getLastSyncedGameweek(supabase)
  return NextResponse.json({ nextGameweek: (lastSynced ?? 0) + 1 })
}
