import { NextResponse } from "next/server"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { fetchFplBootstrap, mapFplPlayer } from "@/lib/fpl"

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.SYNC_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const bootstrap = await fetchFplBootstrap()
    const supabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const teamMap = bootstrap.teams.reduce<Record<number, { name: string; short_name: string }>>(
      (acc, t) => { acc[t.id] = { name: t.name, short_name: t.short_name }; return acc },
      {}
    )

    const players = bootstrap.elements.map((p) => mapFplPlayer(p, teamMap))

    // Upsert in batches of 500
    const batchSize = 500
    for (let i = 0; i < players.length; i += batchSize) {
      const batch = players.slice(i, i + batchSize)
      const { error } = await supabase
        .from("players")
        .upsert(batch, { onConflict: "id" })

      if (error) {
        console.error("[fpl/sync] upsert error:", JSON.stringify(error))
        throw error
      }
    }

    return NextResponse.json({ synced: players.length, ok: true })
  } catch (err) {
    console.error("[fpl/sync] error:", err)
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// Also allow GET for manual browser trigger during dev
export async function GET() {
  return NextResponse.json({ message: "POST to /api/fpl/sync with Authorization header to sync players" })
}
