import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { requireRole, getProfile } from "@/lib/roles"
import type { Role } from "@/types"

const EMAIL_DOMAIN = "surat-fl.internal"

function createAdminClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * POST /api/admin/create-user
 * Admin-only. Creates a Supabase auth user + profile row in one step.
 *
 * Body: { username, password, role, display_name, team_id? }
 */
export async function POST(request: NextRequest) {
  try {
    await requireRole("admin")
  } catch {
    return NextResponse.json({ error: "Admin only." }, { status: 403 })
  }

  const { username, password, role, display_name, team_id } = await request.json()

  if (!username || typeof username !== "string" || username.trim().length < 2) {
    return NextResponse.json({ error: "Username must be at least 2 characters." }, { status: 400 })
  }
  if (!/^[a-z0-9_.-]+$/i.test(username)) {
    return NextResponse.json(
      { error: "Username may only contain letters, numbers, underscores, hyphens, and dots." },
      { status: 400 }
    )
  }
  if (!password || typeof password !== "string" || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 })
  }
  const validRoles: Role[] = ["admin", "auction_master", "team", "guest"]
  if (!validRoles.includes(role)) {
    return NextResponse.json({ error: "Invalid role." }, { status: 400 })
  }
  const callerProfile = await getProfile()
  if (role === "admin" && callerProfile?.role !== "admin") {
    return NextResponse.json({ error: "Only admins can create admin accounts." }, { status: 403 })
  }
  if (!display_name || typeof display_name !== "string" || display_name.trim().length < 1) {
    return NextResponse.json({ error: "Display name is required." }, { status: 400 })
  }

  const supabase = createAdminClient()
  const cleanUsername = username.trim().toLowerCase()
  const email = `${cleanUsername}@${EMAIL_DOMAIN}`

  // Check username not already taken
  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", cleanUsername)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ error: "That username is already taken." }, { status: 409 })
  }

  // Create the auth user
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // skip confirmation email
  })
  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 400 })
  }

  const userId = authData.user.id

  // Insert the profile row (trigger may have already created a skeleton row)
  const { error: profileError } = await supabase
    .from("profiles")
    .upsert({
      id: userId,
      username: cleanUsername,
      display_name: display_name.trim(),
      role,
      team_id: team_id || null,
    })

  if (profileError) {
    // Roll back: delete the auth user we just created
    await supabase.auth.admin.deleteUser(userId)
    return NextResponse.json({ error: profileError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, user_id: userId })
}
