import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/lib/roles"
import { ChatPanel } from "@/components/chat/ChatPanel"
import type { ChatMessage } from "@/components/chat/ChatPanel"
import type { Role } from "@/types"

export default async function ChatPage() {
  const supabase = await createClient()
  const profile = await getProfile()

  const [{ data: chatData }, { data: kickData }] = await Promise.all([
    supabase
      .from("chat_messages")
      .select("id, auction_id, user_id, author_name, is_guest, message, created_at")
      .is("auction_id", null)
      .order("created_at", { ascending: true })
      .limit(100),
    supabase.from("chat_kicks").select("guest_name"),
  ])

  const messages = (chatData ?? []) as ChatMessage[]
  const kickedNames = (kickData ?? []).map((k: { guest_name: string }) => k.guest_name)

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">League Chat</h1>
        <p className="text-sm text-muted-foreground mt-1">The league banter room. Keep it clean-ish.</p>
      </div>
      <div className="h-[600px]">
        <ChatPanel
          myUserId={profile?.id ?? null}
          myRole={(profile?.role ?? "guest") as Role}
          isAdmin={profile?.role === "admin"}
          initialMessages={messages}
          initialKickedNames={kickedNames}
        />
      </div>
    </div>
  )
}
