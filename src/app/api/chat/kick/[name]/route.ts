import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { requireRole } from "@/lib/roles"

function createClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/** DELETE /api/chat/kick/[name] — admin only, removes a guest name from the kick list */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  try {
    await requireRole("admin")
  } catch {
    return NextResponse.json({ error: "Admin only." }, { status: 403 })
  }

  const { name } = await params
  const supabase = createClient()
  const { error } = await supabase.from("chat_kicks").delete().eq("guest_name", decodeURIComponent(name))
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
