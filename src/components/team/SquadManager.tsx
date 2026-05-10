"use client"

import { useState, useCallback } from "react"
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { PlayerCard, PlayerCardOverlay } from "./PlayerCard"
import { DroppedSection } from "./DroppedSection"
import { TeamBudgetBar } from "./TeamBudgetBar"
import { SQUAD_RULES } from "@/types"
import type { RosterEntry, Player, DropQuotaSummary } from "@/types"

interface Props {
  initialRoster: (RosterEntry & { player: Player })[]
  teamBudget: number
  canEdit: boolean
  quotaSummary?: DropQuotaSummary
  dropsLocked?: boolean
}

type Entry = RosterEntry & { player: Player }

async function post(action: string, body: object) {
  const res = await fetch(`/api/team/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? "Something went wrong.")
  return data
}

export function SquadManager({ initialRoster, teamBudget, canEdit, quotaSummary, dropsLocked }: Props) {
  const [roster, setRoster] = useState<Entry[]>(initialRoster)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const startingXI = roster.filter(e => e.slot_type === "starting")
  const bench = roster.filter(e => e.slot_type === "bench")
    .sort((a, b) => (a.bench_order ?? 99) - (b.bench_order ?? 99))
  const dropped = roster.filter(e => e.slot_type === "dropped")

  const activeEntry = activeId ? roster.find(e => e.id === activeId) ?? null : null

  const activeCount = startingXI.length + bench.length
  const totalSpent = [...startingXI, ...bench].reduce((s, e) => s + e.base_price, 0)

  // Optimistically update local state, then sync with server
  const applySwap = useCallback(async (entryId: string, targetSlot: "starting" | "bench", displacedId?: string, newBenchOrder?: number) => {
    setError(null)
    // Optimistic update
    setRoster(prev => {
      const next = prev.map(e => ({ ...e }))
      const entry = next.find(e => e.id === entryId)
      const displaced = displacedId ? next.find(e => e.id === displacedId) : undefined
      if (!entry) return prev

      if (displaced) {
        const oldSlot = entry.slot_type as "starting" | "bench"
        const oldOrder = entry.bench_order
        entry.slot_type = targetSlot
        entry.bench_order = targetSlot === "bench" ? (newBenchOrder ?? displaced.bench_order) : null
        displaced.slot_type = oldSlot
        displaced.bench_order = oldSlot === "bench" ? oldOrder : null
      } else {
        entry.slot_type = targetSlot
        entry.bench_order = targetSlot === "bench" ? (newBenchOrder ?? null) : null
      }
      return next
    })

    try {
      await post("swap", { entry_id: entryId, target_slot: targetSlot, bench_order: newBenchOrder, displaced_entry_id: displacedId })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Swap failed.")
      setRoster(initialRoster) // revert on error
    }
  }, [initialRoster])

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string)
    setError(null)
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null)
    const { active, over } = event
    if (!over || active.id === over.id) return

    const draggedId = active.id as string
    const overId = over.id as string

    const dragged = roster.find(e => e.id === draggedId)
    const target = roster.find(e => e.id === overId)
    if (!dragged || !target) return

    // Swap the two entries
    if (dragged.slot_type !== target.slot_type) {
      // Cross-section swap: starting ↔ bench
      applySwap(draggedId, target.slot_type as "starting" | "bench", overId, target.bench_order ?? undefined)
    } else if (dragged.slot_type === "bench") {
      // Within bench reorder
      applySwap(draggedId, "bench", overId, target.bench_order ?? undefined)
    }
    // Within starting XI reorder — no position enforcement needed, just visual reorder (no API call needed as order isn't persisted for starting)
  }

  async function handleSetCaptain(entryId: string) {
    setError(null)
    setRoster(prev => prev.map(e => ({ ...e, is_captain: e.id === entryId })))
    try {
      await post("set-captain", { entry_id: entryId, role: "captain" })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to set captain.")
      setRoster(initialRoster)
    }
  }

  async function handleSetVC(entryId: string) {
    setError(null)
    setRoster(prev => prev.map(e => ({ ...e, is_vice_captain: e.id === entryId })))
    try {
      await post("set-captain", { entry_id: entryId, role: "vice_captain" })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to set vice-captain.")
      setRoster(initialRoster)
    }
  }

  async function handleMarkDrop(entryId: string) {
    setError(null)
    setRoster(prev => prev.map(e => e.id === entryId
      ? { ...e, slot_type: "dropped" as const, bench_order: null, is_captain: false, is_vice_captain: false }
      : e
    ))
    try {
      await post("mark-drop", { entry_id: entryId })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to stage drop.")
      setRoster(initialRoster)
    }
  }

  async function handleReturnFromDrop(entryId: string) {
    setError(null)
    // Find next available bench slot optimistically
    const usedOrders = new Set(bench.map(e => e.bench_order))
    const nextOrder = [1, 2, 3, 4].find(n => !usedOrders.has(n)) ?? null
    setRoster(prev => prev.map(e => e.id === entryId
      ? { ...e, slot_type: "bench" as const, bench_order: nextOrder }
      : e
    ))
    try {
      await post("return-from-drop", { entry_id: entryId })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to return player.")
      setRoster(initialRoster)
    }
  }

  const emptyBenchSlots = Math.max(0, SQUAD_RULES.bench - bench.length)

  return (
    <div className="space-y-6">
      <TeamBudgetBar budget={teamBudget} totalSpent={totalSpent} activeCount={activeCount} />

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">{error}</p>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {/* Starting XI */}
        <Card className="border-border/60">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base">Starting XI</CardTitle>
            <Badge variant="secondary" className="font-mono text-xs">{startingXI.length} / {SQUAD_RULES.starting}</Badge>
          </CardHeader>
          <CardContent className="space-y-0.5 px-3 pb-3">
            <SortableContext items={startingXI.map(e => e.id)} strategy={verticalListSortingStrategy}>
              {startingXI.map(entry => (
                <PlayerCard
                  key={entry.id}
                  entry={entry}
                  canEdit={canEdit}
                  onSetCaptain={handleSetCaptain}
                  onSetVC={handleSetVC}
                  onMarkDrop={handleMarkDrop}
                />
              ))}
            </SortableContext>
            {Array.from({ length: Math.max(0, SQUAD_RULES.starting - startingXI.length) }).map((_, i) => (
              <EmptySlot key={`empty-start-${i}`} label="Empty starting slot" />
            ))}
          </CardContent>
        </Card>

        {/* Bench */}
        <Card className="border-border/60">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base">Bench</CardTitle>
            <Badge variant="secondary" className="font-mono text-xs">{bench.length} / {SQUAD_RULES.bench}</Badge>
          </CardHeader>
          <CardContent className="space-y-0.5 px-3 pb-3">
            <SortableContext items={bench.map(e => e.id)} strategy={verticalListSortingStrategy}>
              {bench.map((entry, i) => (
                <PlayerCard
                  key={entry.id}
                  entry={entry}
                  benchNumber={entry.bench_order ?? i + 1}
                  canEdit={canEdit}
                  onSetCaptain={handleSetCaptain}
                  onSetVC={handleSetVC}
                  onMarkDrop={handleMarkDrop}
                />
              ))}
            </SortableContext>
            {Array.from({ length: emptyBenchSlots }).map((_, i) => (
              <EmptySlot key={`empty-bench-${i}`} label="Empty bench slot" index={bench.length + i + 1} />
            ))}
          </CardContent>
        </Card>

        <DragOverlay>
          {activeEntry && (
            <PlayerCardOverlay
              entry={activeEntry}
              benchNumber={activeEntry.slot_type === "bench" ? (activeEntry.bench_order ?? undefined) : undefined}
            />
          )}
        </DragOverlay>
      </DndContext>

      {/* Staged drops */}
      <DroppedSection
        entries={dropped}
        canEdit={canEdit}
        onReturnFromDrop={handleReturnFromDrop}
        quotaSummary={quotaSummary}
        dropsLocked={dropsLocked}
      />
    </div>
  )
}

function EmptySlot({ label, index }: { label: string; index?: number }) {
  return (
    <div className="flex items-center gap-3 py-2.5 px-2 opacity-40">
      {index !== undefined && (
        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-muted text-[10px] font-bold text-muted-foreground border border-dashed border-border">
          {index}
        </div>
      )}
      <div className="w-10 h-6 rounded border border-dashed border-border" />
      <p className="text-xs text-muted-foreground italic">{label}</p>
    </div>
  )
}
