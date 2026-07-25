import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { requireRole } from "@/lib/roles"

function createClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * GET /api/admin/simulate-gw/check?gws=38,39,40
 * Admin only. Returns { exists: boolean, existing: number[] } — which of the
 * given gameweeks already have rows in gameweek_points.
 */
export async function GET(request: NextRequest) {
  try {
    await requireRole("admin")
  } catch {
    return NextResponse.json({ error: "Admin only." }, { status: 403 })
  }

  const raw = request.nextUrl.searchParams.get("gws") ?? request.nextUrl.searchParams.get("gw") ?? ""
  const gws = raw.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
  if (gws.length === 0) return NextResponse.json({ error: "gws param required." }, { status: 400 })

  const supabase = createClient()
  const { data } = await supabase
    .from("gameweek_points")
    .select("gameweek")
    .in("gameweek", gws)

  const existing = [...new Set((data ?? []).map(r => r.gameweek))].sort((a, b) => a - b)
  return NextResponse.json({ exists: existing.length > 0, existing })
}
