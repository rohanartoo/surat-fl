import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname
  const isAuthPage = pathname.startsWith("/login")
  const isApiRoute = pathname.startsWith("/api")
  const isPublic   = isAuthPage || isApiRoute || pathname === "/"

  // Unauthenticated + not a public/api route → redirect to login
  if (!user && !isPublic) {
    return NextResponse.redirect(new URL("/login", request.url))
  }

  // Already logged in → skip login page
  if (user && isAuthPage) {
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }

  // Fetch role and attach to request headers for downstream use
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, team_id, display_name")
      .eq("id", user.id)
      .single()

    if (profile) {
      supabaseResponse.headers.set("x-user-role",     profile.role)
      supabaseResponse.headers.set("x-user-team-id",  profile.team_id ?? "")
      supabaseResponse.headers.set("x-user-name",     profile.display_name)
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
