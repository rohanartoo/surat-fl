import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { getProfile } from "@/lib/roles"

function createClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * POST /api/chat/send
 * Body: { message: string, auction_id?: string, guest_name?: string }
 *
 * Authenticated users: author_name resolved server-side (short_name for teams,
 * display_name for AM/admin). guest_name is ignored.
 *
 * Guests (no session): guest_name required (1–20 chars), validated against
 * existing team names, checked against kick list.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient()
  const body = await request.json().catch(() => ({}))
  const { message, auction_id, guest_name } = body

  if (typeof message !== "string" || message.trim().length === 0 || message.length > 500) {
    return NextResponse.json({ error: "Message must be 1–500 characters." }, { status: 400 })
  }

  const profile = await getProfile()

  // ── Authenticated user ──────────────────────────────────────────────────────
  if (profile) {
    let authorName = profile.display_name ?? profile.username ?? "Unknown"

    // Team role: use their team's short_name
    if (profile.role === "team" && profile.team_id) {
      const { data: team } = await supabase
        .from("teams").select("short_name").eq("id", profile.team_id).single()
      if (team?.short_name) authorName = team.short_name
    }

    const { error } = await supabase.from("chat_messages").insert({
      auction_id: auction_id ?? null,
      user_id: profile.id,
      author_name: authorName,
      is_guest: false,
      message: message.trim(),
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // ── Guest user ──────────────────────────────────────────────────────────────
  if (typeof guest_name !== "string" || guest_name.trim().length === 0 || guest_name.length > 20) {
    return NextResponse.json({ error: "Choose a chat name (1–20 characters)." }, { status: 400 })
  }

  const trimmedName = guest_name.trim()

  // Check against team names (case-insensitive)
  const { data: teams } = await supabase.from("teams").select("short_name, display_name")
  const reserved = new Set(
    (teams ?? []).flatMap(t => [t.short_name?.toLowerCase(), t.display_name?.toLowerCase()]).filter(Boolean)
  )
  if (reserved.has(trimmedName.toLowerCase())) {
    return NextResponse.json({ error: "That name is reserved for a league team. Please choose a different name." }, { status: 400 })
  }

  // Check kick list
  const { data: kick } = await supabase
    .from("chat_kicks").select("id").eq("guest_name", trimmedName).maybeSingle()
  if (kick) {
    return NextResponse.json({ error: "You have been removed from chat." }, { status: 403 })
  }

  const { error } = await supabase.from("chat_messages").insert({
    auction_id: auction_id ?? null,
    user_id: null,
    author_name: trimmedName,
    is_guest: true,
    message: message.trim(),
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
