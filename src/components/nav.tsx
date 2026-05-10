"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { LayoutDashboard, Gavel, Users, Trophy, Settings, LogOut, MessageCircle } from "lucide-react"
import type { Role } from "@/types"

const navItems = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/auction", label: "Auction", icon: Gavel },
  { href: "/teams", label: "Teams", icon: Users },
  { href: "/standings", label: "Standings", icon: Trophy },
  { href: "/chat",      label: "Chat",      icon: MessageCircle },
  { href: "/settings",  label: "Settings",  icon: Settings },
]

const roleBadgeStyle: Record<Role, string> = {
  admin:          "bg-rose-500/15 text-rose-500 border-rose-500/30",
  auction_master: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  team:           "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  guest:          "bg-secondary text-muted-foreground border-border",
}

const roleLabel: Record<Role, string> = {
  admin:          "Admin",
  auction_master: "AM",
  team:           "Team",
  guest:          "Guest",
}

interface NavProps {
  displayName: string | null
  role: Role
}

export function Nav({ displayName, role }: NavProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function signOut() {
    await supabase.auth.signOut()
    router.push("/login")
    router.refresh()
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/80 backdrop-blur-sm">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between">
          {/* Logo */}
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-emerald-500 flex items-center justify-center">
              <span className="text-white font-bold text-xs">S</span>
            </div>
            <span className="font-semibold tracking-tight text-sm">Surat FL</span>
          </Link>

          {/* Nav links */}
          <nav className="flex items-center gap-1">
            {navItems.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href}>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "gap-1.5 text-muted-foreground hover:text-foreground",
                    pathname === href && "text-foreground bg-accent"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </Button>
              </Link>
            ))}
          </nav>

          {/* Right: identity + actions */}
          <div className="flex items-center gap-2">
            {displayName && (
              <div className="flex items-center gap-1.5">
                <Badge
                  variant="outline"
                  className={cn("text-[10px] h-5 px-1.5 font-medium", roleBadgeStyle[role])}
                >
                  {roleLabel[role]}
                </Badge>
                <span className="text-sm font-medium text-foreground">{displayName}</span>
              </div>
            )}
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              onClick={signOut}
              aria-label="Sign out"
              className="text-muted-foreground hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}
