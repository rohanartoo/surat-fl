import { Nav } from "@/components/nav"
import { FloatingChat } from "@/components/chat/FloatingChat"
import { getProfile } from "@/lib/roles"
import type { Role } from "@/types"

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile()

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Nav displayName={profile?.display_name ?? null} role={profile?.role ?? "guest"} />
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
      <FloatingChat
        myUserId={profile?.id ?? null}
        myRole={(profile?.role ?? "guest") as Role}
        isAdmin={profile?.role === "admin"}
      />
    </div>
  )
}
