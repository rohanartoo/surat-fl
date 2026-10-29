"use client"

import { useRouter } from "next/navigation"
import { useTransition } from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export interface AuctionOption {
  id: string
  label: string
}

/**
 * Switches which auction the history page shows by putting the id in the URL
 * (?auction=…), so the server component does the filtering and a given
 * auction's history is a shareable link.
 */
export function AuctionPicker({
  auctions,
  selectedId,
}: {
  auctions: AuctionOption[]
  selectedId: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  return (
    <Select
      value={selectedId}
      onValueChange={id => startTransition(() => router.push(`/history?auction=${id}`))}
      disabled={isPending}
    >
      <SelectTrigger className="h-9 w-full sm:w-[320px] text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {auctions.map(a => (
          <SelectItem key={a.id} value={a.id} className="text-sm">
            {a.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
