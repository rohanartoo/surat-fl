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
 * GET /api/admin/simulate-gw/check?gw=38
 * Admin only. Returns { exists: boolean } — whether gameweek_points already has rows for this GW.
 */
export async function GET(request: NextRequest) {
  try {
    await requireRole("admin")
  } catch {
    return NextResponse.json({ error: "Admin only." }, { status: 403 })
  }

  const gw = parseInt(request.nextUrl.searchParams.get("gw") ?? "", 10)
  if (isNaN(gw)) return NextResponse.json({ error: "gw param required." }, { status: 400 })

  const supabase = createClient()
  const { count } = await supabase
    .from("gameweek_points")
    .select("id", { count: "exact", head: true })
    .eq("gameweek", gw)

  return NextResponse.json({ exists: (count ?? 0) > 0 })
}
