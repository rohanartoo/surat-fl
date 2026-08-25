"use client"

import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { MoreVertical } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { PitchSlot } from "./Pitch"
import { formatMoney, cn } from "@/lib/utils"
import type { RosterEntry, Player } from "@/types"

interface Props {
  entry: RosterEntry & { player: Player }
  opponents?: { opponent_short: string; is_home: boolean }[]
  benchNumber?: number
  canEdit: boolean
  onSetCaptain: (entryId: string) => void
  onSetVC: (entryId: string) => void
  onMarkDrop: (entryId: string) => void
  isSelected?: boolean
  isEligible?: boolean
  dimmed?: boolean
  onSelect?: () => void
}

function opponentLabel(opponents?: { opponent_short: string; is_home: boolean }[]) {
  if (!opponents || opponents.length === 0) return null
  return opponents.map(o => `${o.opponent_short} (${o.is_home ? "H" : "A"})`).join(", ")
}

export function PlayerCard({
  entry,
  opponents,
  benchNumber,
  canEdit,
  onSetCaptain,
  onSetVC,
  onMarkDrop,
  isSelected,
  isEligible,
  dimmed,
  onSelect,
}: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entry.id, disabled: !canEdit })

  const oppLabel = opponentLabel(opponents)
  const subtitle = oppLabel
    ? `${entry.player.fpl_team_short} · ${oppLabel}`
    : entry.player.fpl_team_short

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="relative"
    >
      <PitchSlot
        position={entry.player.position}
        name={entry.player.web_name}
        subtitle={subtitle}
        value={formatMoney(entry.base_price)}
        benchNumber={benchNumber}
        onClick={canEdit ? onSelect : undefined}
        // The whole card is the drag handle now — a pitch slot is too small
        // to carry a separate grip target the way the old list row did.
        handleProps={canEdit ? { ...attributes, ...listeners } : undefined}
        className={cn(
          isDragging && "opacity-40",
          isSelected && "!border-primary ring-1 ring-primary/60",
          isEligible && "!border-emerald-500 ring-1 ring-emerald-500/60",
          dimmed && "opacity-40",
          canEdit && "touch-none select-none",
        )}
        topRight={
          <>
            {entry.is_captain && (
              <Badge variant="secondary" className="h-3.5 border-0 bg-amber-500/20 px-1 py-0 text-[9px] uppercase text-amber-600">C</Badge>
            )}
            {entry.is_vice_captain && (
              <Badge variant="secondary" className="h-3.5 px-1 py-0 text-[9px] uppercase">VC</Badge>
            )}
          </>
        }
      />

      {/* Actions sit outside PitchSlot so the dropdown trigger never inherits
          the drag listeners — otherwise opening the menu starts a drag. */}
      {canEdit && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Actions for ${entry.player.web_name}`}
              onClick={e => e.stopPropagation()}
              onPointerDown={e => e.stopPropagation()}
              className="absolute -right-1 -top-1 z-[2] flex h-4 w-4 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
            >
              <MoreVertical className="h-2.5 w-2.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={e => e.stopPropagation()}>
            {entry.slot_type === "starting" && !entry.is_captain && (
              <DropdownMenuItem onClick={() => onSetCaptain(entry.id)}>Make Captain</DropdownMenuItem>
            )}
            {entry.slot_type === "starting" && !entry.is_vice_captain && (
              <DropdownMenuItem onClick={() => onSetVC(entry.id)}>Make Vice-Captain</DropdownMenuItem>
            )}
            <DropdownMenuItem className="text-destructive" onClick={() => onMarkDrop(entry.id)}>
              Drop
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

/** Non-draggable copy used inside DragOverlay. */
export function PlayerCardOverlay({ entry, benchNumber }: Pick<Props, "entry" | "benchNumber">) {
  return (
    <PitchSlot
      position={entry.player.position}
      name={entry.player.web_name}
      subtitle={entry.player.fpl_team_short}
      value={formatMoney(entry.base_price)}
      benchNumber={benchNumber}
      className="rotate-1 scale-[1.04] border-primary/40 shadow-2xl"
    />
  )
}
