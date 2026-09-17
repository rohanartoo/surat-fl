import { NextRequest, NextResponse } from "next/server"
import { getProfile } from "@/lib/roles"
import { fetchFplPlayerSummary } from "@/lib/fpl"

type Params = { params: Promise<{ id: string }> }

// ─────────────────────────────────────────────
// GET — read-only recent form + upcoming fixtures for one player, shown in
// the auction page's stats dialog. Any signed-in role (including guest) may
// read; src/proxy.ts doesn't guard /api routes, so the session check is here.
// ─────────────────────────────────────────────
export async function GET(_request: NextRequest, { params }: Params) {
  const profile = await getProfile()
  if (!profile) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 })
  }

  const { id } = await params
  const playerId = Number(id)
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(playerId) || playerId <= 0) {
    return NextResponse.json({ error: "Invalid player id." }, { status: 400 })
  }

  try {
    return NextResponse.json(await fetchFplPlayerSummary(playerId))
  } catch (e) {
    console.error(`[fpl/player/${playerId}]`, e)
    return NextResponse.json({ error: "Could not load recent form from FPL." }, { status: 502 })
  }
}
