import { NextResponse } from "next/server"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { syncFplPlayers } from "@/lib/fpl"
import { verifySyncSecret } from "@/lib/auth"

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (!verifySyncSecret(authHeader)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const supabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const result = await syncFplPlayers(supabase)
    return NextResponse.json({ ...result, ok: true })
  } catch (err) {
    console.error("[fpl/sync] error:", err)
    const message = err instanceof Error
      ? err.message
      : typeof err === "object"
        ? JSON.stringify(err)
        : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// Also allow GET for manual browser trigger during dev
export async function GET() {
  return NextResponse.json({ message: "POST to /api/fpl/sync with Authorization header to sync players" })
}
