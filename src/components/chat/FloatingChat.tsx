"use client"

import { useState, useEffect } from "react"
import { MessageCircle, X } from "lucide-react"
import { ChatPanel } from "./ChatPanel"
import type { ChatMessage } from "./ChatPanel"
import type { Role } from "@/types"

interface FloatingChatProps {
  myUserId: string | null
  myRole: Role
  isAdmin: boolean
}

export function FloatingChat({ myUserId, myRole, isAdmin }: FloatingChatProps) {
  const [open, setOpen] = useState(false)
  const [auctionId, setAuctionId] = useState<string | undefined>(undefined)
  const [initialMessages, setInitialMessages] = useState<ChatMessage[]>([])
  const [initialKickedNames, setInitialKickedNames] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)

  // On open, fetch active auction + initial chat messages
  useEffect(() => {
    if (!open || loaded) return

    async function load() {
      // Check for active/pending auction
      const auctionRes = await fetch("/api/chat/context")
      if (auctionRes.ok) {
        const { auction_id, messages, kicked_names } = await auctionRes.json()
        setAuctionId(auction_id ?? undefined)
        setInitialMessages(messages ?? [])
        setInitialKickedNames(kicked_names ?? [])
      }
      setLoaded(true)
    }

    load()
  }, [open, loaded])

  // Reset loaded state when closed so re-open refreshes messages
  function toggle() {
    if (open) {
      setOpen(false)
      setLoaded(false)
    } else {
      setOpen(true)
    }
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {/* Chat panel */}
      {open && loaded && (
        <div
          className="shadow-2xl rounded-xl overflow-auto border border-border"
          style={{ width: 288, height: 380, resize: "both", minWidth: 220, minHeight: 280, maxWidth: 480, maxHeight: 640 }}
        >
          <ChatPanel
            auctionId={auctionId}
            myUserId={myUserId}
            myRole={myRole}
            isAdmin={isAdmin}
            initialMessages={initialMessages}
            initialKickedNames={initialKickedNames}
          />
        </div>
      )}

      {open && !loaded && (
        <div className="w-72 h-[380px] shadow-2xl rounded-xl border border-border bg-card flex items-center justify-center">
          <p className="text-xs text-muted-foreground">Loading chat…</p>
        </div>
      )}

      {/* Toggle button */}
      <button
        onClick={toggle}
        className="w-12 h-12 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg flex items-center justify-center transition-colors"
        aria-label={open ? "Close chat" : "Open chat"}
      >
        {open ? <X className="w-5 h-5" /> : <MessageCircle className="w-5 h-5" />}
      </button>
    </div>
  )
}
