import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { requireRole, getProfile } from "@/lib/roles"

const EMAIL_DOMAIN = "surat-fl.internal"

function createAdminClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * POST /api/auth/update-username
 * Updates a user's login username (stored as email = username@surat-fl.internal).
 *
 * Two modes:
 *   - Self-update: body = { new_username }  (team/AM/admin role required)
 *   - Admin override: body = { new_username, target_user_id }  (admin only)
 */
export async function POST(request: NextRequest) {
  try {
    const { new_username, target_user_id } = await request.json()

    if (!new_username || typeof new_username !== "string" || new_username.trim().length < 2) {
      return NextResponse.json({ error: "Username must be at least 2 characters." }, { status: 400 })
    }

    // Disallow characters that would break the email format
    if (!/^[a-z0-9_.-]+$/i.test(new_username)) {
      return NextResponse.json(
        { error: "Username may only contain letters, numbers, underscores, hyphens, and dots." },
        { status: 400 },
      )
    }

    const profile = await getProfile()

    let userId: string
    if (target_user_id) {
      // Admin-only: update another user's username
      await requireRole("admin")
      userId = target_user_id
    } else {
      // Self-update: must be authenticated, non-guest
      await requireRole("team")
      if (!profile?.id) return NextResponse.json({ error: "Not authenticated." }, { status: 401 })
      userId = profile.id
    }

    const supabase = createAdminClient()
    const newEmail = `${new_username.trim().toLowerCase()}@${EMAIL_DOMAIN}`

    // Check username isn't already taken
    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", new_username.trim().toLowerCase())
      .neq("id", userId)
      .maybeSingle()

    if (existing) {
      return NextResponse.json({ error: "That username is already taken." }, { status: 409 })
    }

    // Update auth.users.email via Admin SDK (bypasses email confirmation)
    const { error: authError } = await supabase.auth.admin.updateUserById(userId, {
      email: newEmail,
    })
    if (authError) return NextResponse.json({ error: authError.message }, { status: 400 })

    // Update profiles.username
    const { error: profileError } = await supabase
      .from("profiles")
      .update({ username: new_username.trim().toLowerCase() })
      .eq("id", userId)
    if (profileError) return NextResponse.json({ error: profileError.message }, { status: 500 })

    return NextResponse.json({ success: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error."
    if (message.startsWith("Requires role:")) return NextResponse.json({ error: message }, { status: 403 })
    return NextResponse.json({ error: "Internal server error." }, { status: 500 })
  }
}
