"use client"

import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { MoreVertical } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { PositionBadge } from "@/components/ui/PositionBadge"
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

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const oppLabel = opponentLabel(opponents)

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={canEdit ? onSelect : undefined}
      className={cn(
        "flex items-center justify-between py-2.5 px-2 rounded-md border border-transparent transition-all duration-200 ease-out group",
        "hover:bg-accent/50",
        canEdit && "cursor-pointer",
        isDragging && "opacity-40",
        isSelected && "border-primary/60 bg-primary/10",
        isEligible && "border-emerald-500/60 bg-emerald-500/10",
        dimmed && "opacity-40",
      )}
    >
      <div className="flex items-center gap-3">
        {/* Drag handle — only shown when canEdit */}
        {canEdit && (
          <div
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
            className="text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing touch-none select-none"
          >
            ⠿
          </div>
        )}

        {/* Bench slot number */}
        {benchNumber !== undefined && (
          <div className="flex items-center justify-center w-5 h-5 rounded-full bg-muted text-[10px] font-bold text-muted-foreground border border-border shrink-0">
            {benchNumber}
          </div>
        )}

        <PositionBadge position={entry.player.position} />

        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-medium leading-none">{entry.player.web_name}</p>
            {entry.is_captain && (
              <Badge variant="secondary" className="text-[10px] h-4 px-1 py-0 uppercase bg-amber-500/20 text-amber-600 border-0">C</Badge>
            )}
            {entry.is_vice_captain && (
              <Badge variant="secondary" className="text-[10px] h-4 px-1 py-0 uppercase">VC</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {entry.player.fpl_team_short}
            {oppLabel && <> · vs {oppLabel}</>}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Edit actions — always visible (not hover-gated) so they're reachable on touch screens */}
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0 text-muted-foreground"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              {entry.slot_type === "starting" && !entry.is_captain && (
                <DropdownMenuItem onClick={() => onSetCaptain(entry.id)}>
                  Make Captain
                </DropdownMenuItem>
              )}
              {entry.slot_type === "starting" && !entry.is_vice_captain && (
                <DropdownMenuItem onClick={() => onSetVC(entry.id)}>
                  Make Vice-Captain
                </DropdownMenuItem>
              )}
              <DropdownMenuItem className="text-destructive" onClick={() => onMarkDrop(entry.id)}>
                Drop
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <span className="text-sm font-mono font-medium text-muted-foreground group-hover:text-foreground transition-colors shrink-0">
          {formatMoney(entry.base_price)}
        </span>
      </div>
    </div>
  )
}

// Lightweight non-draggable version for overlay rendering
export function PlayerCardOverlay({ entry, benchNumber }: Pick<Props, "entry" | "benchNumber">) {
  return (
    <div className="flex items-center justify-between py-2.5 px-2 rounded-md shadow-2xl bg-background/80 backdrop-blur-md border border-primary/20 scale-[1.02] rotate-1 cursor-grabbing transition-transform">
      <div className="flex items-center gap-3">
        <div className="text-muted-foreground/40 cursor-grabbing">⠿</div>
        {benchNumber !== undefined && (
          <div className="flex items-center justify-center w-5 h-5 rounded-full bg-muted text-[10px] font-bold text-muted-foreground border border-border shrink-0">
            {benchNumber}
          </div>
        )}
        <PositionBadge position={entry.player.position} />
        <div>
          <p className="text-sm font-medium leading-none">{entry.player.web_name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{entry.player.fpl_team_short}</p>
        </div>
      </div>
      <span className="text-sm font-mono font-medium text-muted-foreground">{formatMoney(entry.base_price)}</span>
    </div>
  )
}
