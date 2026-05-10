import { Nav } from "@/components/nav"
import { getProfile } from "@/lib/roles"

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile()

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Nav displayName={profile?.display_name ?? null} role={profile?.role ?? "guest"} />
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  )
}
