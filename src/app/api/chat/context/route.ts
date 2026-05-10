import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

/**
 * GET /api/chat/context
 * Returns the active auction ID (if any) + last 50 chat messages for that context
 * + current kick list. Used by FloatingChat on open.
 * When no auction is active, returns league chat (auction_id IS NULL).
 */
export async function GET() {
  const supabase = await createClient()

  const { data: auction } = await supabase
    .from("auctions")
    .select("id")
    .in("status", ["pending", "active"])
    .maybeSingle()

  const auctionId: string | null = auction?.id ?? null

  let messagesQuery = supabase
    .from("chat_messages")
    .select("id, auction_id, user_id, author_name, is_guest, message, created_at")
    .order("created_at", { ascending: true })
    .limit(50)

  messagesQuery = auctionId
    ? messagesQuery.eq("auction_id", auctionId)
    : messagesQuery.is("auction_id", null)

  const [{ data: messages }, { data: kicks }] = await Promise.all([
    messagesQuery,
    supabase.from("chat_kicks").select("guest_name"),
  ])

  return NextResponse.json({
    auction_id: auctionId,
    messages: messages ?? [],
    kicked_names: (kicks ?? []).map((k: { guest_name: string }) => k.guest_name),
  })
}
