"use client"

import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { MoreVertical } from "lucide-react"
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
    <PitchSlot
      // The sortable ref/transform go on PitchSlot's own outer element rather
      // than a wrapper around it: that element is the flex item the row
      // sizes, and an extra shrink-wrapping wrapper would break the
      // percentage width slots use to fit five across.
      outerRef={setNodeRef}
      outerStyle={{ transform: CSS.Transform.toString(transform), transition }}
      position={entry.player.position}
      name={entry.player.web_name}
      subtitle={subtitle}
      value={formatMoney(entry.base_price)}
      benchNumber={benchNumber}
      onClick={canEdit ? onSelect : undefined}
      // The whole card is the drag handle now — a pitch slot is too small
      // to carry a separate grip target the way the old list row did.
      handleProps={canEdit ? { ...attributes, ...listeners } : undefined}
      outerClassName={cn(isDragging && "opacity-40", dimmed && "opacity-40")}
      className={cn(
        isSelected && "!border-primary ring-1 ring-primary/60",
        isEligible && "!border-emerald-500 ring-1 ring-emerald-500/60",
        // `manipulation`, NOT `none`: it still suppresses the 300ms
        // double-tap-zoom delay so tap-to-swap feels instant, but leaves
        // scrolling intact. `none` here made the whole squad area
        // unscrollable on a phone, since the pitch fills the viewport.
        canEdit && "touch-manipulation select-none",
      )}
      // Pass undefined, not an empty fragment, when there's nothing to show —
      // a fragment is always truthy and would render an empty corner pip on
      // every card that isn't captain or vice-captain.
      marker={
        entry.is_captain ? <span className="text-[9px] font-bold uppercase leading-none text-amber-500">C</span>
        : entry.is_vice_captain ? <span className="text-[9px] font-bold uppercase leading-none text-muted-foreground">VC</span>
        : undefined
      }
      // Sits outside the card element so the dropdown trigger never inherits
      // the drag listeners — otherwise opening the menu starts a drag.
      actions={canEdit ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            {/* 32x32 tap target: mostly transparent padding around a small
                visible dot. A bare 16px control is roughly a third of the
                minimum comfortable touch target and was genuinely hard to
                hit on a phone. Anchored inside the card's own bounds so the
                enlarged area can't steal taps from the neighbouring card. */}
            <button
              type="button"
              aria-label={`Actions for ${entry.player.web_name}`}
              onClick={e => e.stopPropagation()}
              onPointerDown={e => e.stopPropagation()}
              onTouchStart={e => e.stopPropagation()}
              className="group absolute right-0 top-0 z-[2] flex h-8 w-8 items-start justify-end p-1 touch-manipulation"
            >
              <span className="flex h-4 w-4 items-center justify-center rounded-full border border-border bg-card text-muted-foreground group-hover:text-foreground group-focus-visible:ring-1 group-focus-visible:ring-ring">
                <MoreVertical className="h-2.5 w-2.5" />
              </span>
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
      ) : undefined}
    />
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
