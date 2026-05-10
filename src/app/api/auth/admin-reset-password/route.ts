import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { requireRole } from "@/lib/roles"

/**
 * POST /api/auth/admin-reset-password
 * Admin-only: force-sets a user's password via the Admin SDK.
 * Body: { target_user_id: string, new_password: string }
 */
export async function POST(request: NextRequest) {
  try {
    await requireRole("admin")
    const { target_user_id, new_password } = await request.json()

    if (!target_user_id) return NextResponse.json({ error: "target_user_id required." }, { status: 400 })
    if (!new_password || new_password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 })
    }

    const supabase = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { error } = await supabase.auth.admin.updateUserById(target_user_id, {
      password: new_password,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ success: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error."
    if (message.startsWith("Requires role:")) return NextResponse.json({ error: message }, { status: 403 })
    return NextResponse.json({ error: "Internal server error." }, { status: 500 })
  }
}
