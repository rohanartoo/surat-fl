import type { Role } from "@/types"

export const ROLE_LEVEL: Record<Role, number> = {
  admin:          4,
  auction_master: 3,
  team:           2,
  guest:          1,
}

export function roleIsAM(role: Role): boolean {
  return ROLE_LEVEL[role] >= ROLE_LEVEL["auction_master"]
}

export function roleIsAdmin(role: Role): boolean {
  return role === "admin"
}
