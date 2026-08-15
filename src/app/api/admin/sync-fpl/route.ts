import { NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { requireRole } from "@/lib/roles"
import { syncFplPlayers } from "@/lib/fpl"

// Manual, UI-triggered FPL sync for AM/admin (e.g. right before a draft).
// Deliberately a separate route from /api/fpl/sync rather than adding
// session auth there — CLAUDE.md: don't make cookie-based session auth the
// primary guard on the SYNC_SECRET-gated cron routes. This one holds the
// secret server-side implicitly (service-role client) and gates on role
// instead, then calls the exact same sync logic.
export async function POST() {
  try {
    await requireRole("auction_master")
  } catch (e) {
    const message = e instanceof Error ? e.message : "Forbidden."
    return NextResponse.json({ error: message }, { status: 403 })
  }

  try {
    const supabase = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const result = await syncFplPlayers(supabase)
    return NextResponse.json({ ...result, ok: true })
  } catch (err) {
    console.error("[admin/sync-fpl] error:", err)
    const message = err instanceof Error ? err.message : "Internal server error."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
