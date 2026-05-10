"use client"

import { useState, useEffect, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import type { Role } from "@/types"

export interface ChatMessage {
  id: string
  auction_id: string | null
  user_id: string | null
  author_name: string
  is_guest: boolean
  message: string
  created_at: string
}

interface ChatPanelProps {
  auctionId?: string
  myUserId: string | null
  myRole: Role
  isAdmin: boolean
  initialMessages: ChatMessage[]
  initialKickedNames: string[]
}

const GUEST_NAME_KEY = "surat_chat_guest_name"

export function ChatPanel({
  auctionId,
  myUserId,
  myRole,
  isAdmin,
  initialMessages,
  initialKickedNames,
}: ChatPanelProps) {
  const supabase = createClient()
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [kickedNames, setKickedNames] = useState<string[]>(initialKickedNames)
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Guest name flow
  const isGuest = myRole === "guest"
  const [guestName, setGuestName] = useState<string>(() => {
    if (typeof window !== "undefined") return localStorage.getItem(GUEST_NAME_KEY) ?? ""
    return ""
  })
  const [guestNameInput, setGuestNameInput] = useState("")
  const [guestNameError, setGuestNameError] = useState<string | null>(null)

  const bottomRef = useRef<HTMLDivElement>(null)
  const isKicked = isGuest && kickedNames.some(n => n.toLowerCase() === guestName.toLowerCase())

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // Realtime subscriptions
  useEffect(() => {
    const msgChannel = supabase
      .channel(`chat-messages-${auctionId ?? "league"}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        (payload) => {
          const msg = payload.new as ChatMessage
          // Filter to correct context (auction vs league)
          const belongs = auctionId ? msg.auction_id === auctionId : msg.auction_id === null
          if (belongs) setMessages(prev => [...prev, msg])
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "chat_messages" },
        (payload) => {
          setMessages(prev => prev.filter(m => m.id !== payload.old.id))
        }
      )
      .subscribe()

    const kickChannel = supabase
      .channel("chat-kicks")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_kicks" },
        (payload) => {
          setKickedNames(prev => [...prev, payload.new.guest_name])
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "chat_kicks" },
        (payload) => {
          setKickedNames(prev => prev.filter(n => n !== payload.old.guest_name))
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(msgChannel)
      supabase.removeChannel(kickChannel)
    }
  }, [supabase, auctionId])

  async function saveGuestName() {
    const name = guestNameInput.trim()
    if (!name || name.length > 20) {
      setGuestNameError("Name must be 1–20 characters.")
      return
    }
    // Quick client-side check — server validates too
    setGuestName(name)
    localStorage.setItem(GUEST_NAME_KEY, name)
    setGuestNameInput("")
    setGuestNameError(null)
  }

  async function sendMessage() {
    const text = input.trim()
    if (!text) return
    setSending(true)
    setError(null)
    try {
      const body: Record<string, string> = { message: text }
      if (auctionId) body.auction_id = auctionId
      if (isGuest) body.guest_name = guestName

      const res = await fetch("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Failed to send."); return }
      setInput("")
    } finally {
      setSending(false)
    }
  }

  async function deleteMessage(id: string) {
    await fetch(`/api/chat/message/${id}`, { method: "DELETE" })
  }

  async function kickGuest(name: string) {
    await fetch("/api/chat/kick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guest_name: name }),
    })
  }

  async function unkickGuest(name: string) {
    await fetch(`/api/chat/kick/${encodeURIComponent(name)}`, { method: "DELETE" })
  }

  function formatTime(iso: string) {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }

  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="pb-2 shrink-0">
        <CardTitle className="text-sm">
          {auctionId ? "Auction Chat" : "League Chat"}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col flex-1 p-3 pt-0 min-h-0 gap-2">

        {/* Message list */}
        <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-0">
          {messages.length === 0 && (
            <p className="text-xs text-muted-foreground italic text-center py-4">
              No messages yet. Say something!
            </p>
          )}
          {messages.map(msg => (
            <div key={msg.id} className="group flex items-start gap-1.5">
              <div className="flex-1 min-w-0">
                <span className="text-xs font-semibold text-foreground">{msg.author_name}</span>
                {msg.is_guest && (
                  <Badge variant="outline" className="ml-1 text-[9px] h-3.5 px-1 py-0 text-muted-foreground">guest</Badge>
                )}
                <span className="text-[10px] text-muted-foreground ml-1">{formatTime(msg.created_at)}</span>
                <p className="text-xs text-foreground/90 break-words">{msg.message}</p>
              </div>
              {isAdmin && (
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button
                    className="text-[10px] text-muted-foreground hover:text-destructive"
                    onClick={() => deleteMessage(msg.id)}
                    title="Delete message"
                  >×</button>
                  {msg.is_guest && (
                    <button
                      className="text-[10px] text-muted-foreground hover:text-amber-500"
                      onClick={() => kickGuest(msg.author_name)}
                      title="Kick guest"
                    >kick</button>
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <Separator />

        {/* Input area */}
        {isGuest && !guestName ? (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Choose a chat name to participate:</p>
            <div className="flex gap-1.5">
              <Input
                className="h-7 text-xs"
                placeholder="Your name..."
                value={guestNameInput}
                onChange={e => setGuestNameInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && saveGuestName()}
                maxLength={20}
              />
              <Button size="sm" className="h-7 text-xs px-2" onClick={saveGuestName}>Set</Button>
            </div>
            {guestNameError && <p className="text-xs text-destructive">{guestNameError}</p>}
          </div>
        ) : isKicked ? (
          <p className="text-xs text-destructive text-center py-1">You have been removed from chat.</p>
        ) : (
          <div className="space-y-1">
            <div className="flex gap-1.5">
              <Input
                className="h-7 text-xs"
                placeholder="Say something..."
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !sending && sendMessage()}
                maxLength={500}
                disabled={sending}
              />
              <Button
                size="sm"
                className="h-7 text-xs px-2 shrink-0"
                disabled={sending || !input.trim()}
                onClick={sendMessage}
              >
                Send
              </Button>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        )}

        {/* Admin moderation panel */}
        {isAdmin && kickedNames.length > 0 && (
          <div className="mt-1 space-y-1">
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Kicked guests</p>
            {kickedNames.map(name => (
              <div key={name} className={cn("flex items-center justify-between text-xs")}>
                <span className="text-muted-foreground">{name}</span>
                <button
                  className="text-[10px] text-muted-foreground hover:text-emerald-500"
                  onClick={() => unkickGuest(name)}
                >un-kick</button>
              </div>
            ))}
          </div>
        )}

      </CardContent>
    </Card>
  )
}
