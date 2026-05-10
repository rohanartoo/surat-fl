import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { requireRole } from "@/lib/roles"

function createClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/** POST /api/chat/kick — admin only, adds a guest name to the kick list */
export async function POST(request: NextRequest) {
  try {
    await requireRole("admin")
  } catch {
    return NextResponse.json({ error: "Admin only." }, { status: 403 })
  }

  const { guest_name } = await request.json().catch(() => ({}))
  if (typeof guest_name !== "string" || guest_name.trim().length === 0) {
    return NextResponse.json({ error: "guest_name required." }, { status: 400 })
  }

  const supabase = createClient()
  const { error } = await supabase.from("chat_kicks")
    .upsert({ guest_name: guest_name.trim() }, { onConflict: "guest_name" })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
