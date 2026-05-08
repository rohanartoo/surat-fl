import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { cache } from "react"
import type { Role } from "@/types"

/**
 * Role hierarchy (highest to lowest):
 *   admin > auction_master > team > guest
 *
 * Admin is a superset of auction_master — any check for 'auction_master'
 * will also pass for 'admin'.
 */

const ROLE_LEVEL: Record<Role, number> = {
  admin:          4,
  auction_master: 3,
  team:           2,
  guest:          1,
}

/** Returns the current user's profile row, or null if unauthenticated. */
export const getProfile = cache(async () => {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single()

  return data ?? null
})

/** Returns the current user's role, or 'guest' for unauthenticated users. */
export async function getCurrentRole(): Promise<Role> {
  const profile = await getProfile()
  return (profile?.role as Role) ?? "guest"
}

/** Returns true if the current user has at least the required role level. */
export async function hasRole(minRole: Role): Promise<boolean> {
  const role = await getCurrentRole()
  return ROLE_LEVEL[role] >= ROLE_LEVEL[minRole]
}

/** True if the current user is an admin. */
export async function isAdmin(): Promise<boolean> {
  return (await getCurrentRole()) === "admin"
}

/**
 * True if the current user can perform Auction Master actions.
 * Admin inherits all AM permissions.
 */
export async function canActAsAuctionMaster(): Promise<boolean> {
  return hasRole("auction_master")
}

/** True if the current user is a team account. */
export async function isTeam(): Promise<boolean> {
  const role = await getCurrentRole()
  return role === "team"
}

/** True if the current user is a guest (unauthenticated or guest session). */
export async function isGuest(): Promise<boolean> {
  const role = await getCurrentRole()
  return role === "guest"
}

/**
 * Returns the current user's team_id, or null if not a team account.
 */
export async function getMyTeamId(): Promise<string | null> {
  const profile = await getProfile()
  return profile?.team_id ?? null
}

/**
 * Throws an error if the current user does not meet the minimum role.
 * Use in API route handlers to guard actions.
 */
export async function requireRole(minRole: Role): Promise<void> {
  const ok = await hasRole(minRole)
  if (!ok) {
    throw new Error(`Requires role: ${minRole}`)
  }
}

/** Client-side role check helper (pass role from server props). */
export function roleCanEdit(role: Role): boolean {
  return ROLE_LEVEL[role] >= ROLE_LEVEL["team"]
}

export function roleIsAM(role: Role): boolean {
  return ROLE_LEVEL[role] >= ROLE_LEVEL["auction_master"]
}

export function roleIsAdmin(role: Role): boolean {
  return role === "admin"
}
