import { NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { getProfile } from "@/lib/roles"
import { runManualGameweekSync } from "@/lib/scoring"
import { verifySyncSecret } from "@/lib/auth"

function createClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(request: Request) {
  // Two auth paths: scheduled cron (Bearer token) or admin session
  const authHeader = request.headers.get("authorization")
  const isScheduled = verifySyncSecret(authHeader)

  if (!isScheduled) {
    const profile = await getProfile()
    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  try {
    const { gameweek, finalize } = await request.json()
    if (!Number.isInteger(gameweek) || gameweek < 1 || gameweek > 38) {
      return NextResponse.json({ error: "gameweek must be an integer between 1 and 38" }, { status: 400 })
    }

    const supabase = createClient()
    const result = await runManualGameweekSync(gameweek, supabase, { finalize: finalize === true })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error("[scoring/sync] error:", err)
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
