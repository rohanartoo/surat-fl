"use client"

import { useState, useCallback, useMemo } from "react"
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
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
import type { RosterEntry, Player, Position, DropQuotaSummary } from "@/types"

interface Props {
  initialRoster: (RosterEntry & { player: Player })[]
  teamBudget: number
  canEdit: boolean
  quotaSummary?: DropQuotaSummary
  dropsLocked?: boolean
}

type Entry = RosterEntry & { player: Player }

const POSITION_ORDER: Record<Position, number> = { GK: 0, DEF: 1, MID: 2, FWD: 3 }
const byPosition = (a: Entry, b: Entry) => POSITION_ORDER[a.player.position] - POSITION_ORDER[b.player.position]

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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // Displayed top-to-bottom by position (GK, DEF, MID, FWD). Bench priority
  // (bench_order, used by auto-subs) is unaffected — it's a secondary sort
  // key here, still shown via the numbered badge on each card.
  const startingXI = roster.filter(e => e.slot_type === "starting").sort(byPosition)
  const bench = roster.filter(e => e.slot_type === "bench")
    .sort((a, b) => byPosition(a, b) || (a.bench_order ?? 99) - (b.bench_order ?? 99))
  const dropped = roster.filter(e => e.slot_type === "dropped")

  const activeEntry = activeId ? roster.find(e => e.id === activeId) ?? null : null

  const activeCount = startingXI.length + bench.length
  const totalSpent = [...startingXI, ...bench].reduce((s, e) => s + e.base_price, 0)
  // Staged (not yet locked) drops return their full purchase price to the
  // team's budget once the auction starts — shown here as a provisional
  // figure. Naturally empty once locked, since locked drops' roster rows
  // are deleted rather than staying in the "dropped" slot_type.
  const pendingDropCredit = dropped.reduce((s, e) => s + e.base_price, 0)

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

  // Tap-to-substitute: selecting a player highlights every player on the
  // opposite side of the sheet (starting <-> bench) that it could legally
  // swap with. Formation minimums/maximums (SQUAD_RULES.min_starting /
  // max_starting) are only enforced once the squad is complete (15/15) —
  // same threshold handleSwap's server-side formation check uses — since a
  // squad still being built has no fixed starting XI to validate against.
  const selectedEntry = selectedId ? roster.find(e => e.id === selectedId) ?? null : null
  const squadComplete = activeCount === SQUAD_RULES.total

  const eligiblePartnerIds = useMemo(() => {
    if (!selectedEntry) return new Set<string>()
    const oppositeSlot = selectedEntry.slot_type === "starting" ? "bench" : "starting"
    const candidates = roster.filter(e => e.slot_type === oppositeSlot)
    if (!squadComplete) return new Set(candidates.map(c => c.id))

    const counts: Record<Position, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 }
    for (const e of startingXI) counts[e.player.position]++

    const eligible = new Set<string>()
    for (const c of candidates) {
      // Whichever of the two is currently starting is the one that would
      // leave the XI; the other is the one that would enter it.
      const outPos = selectedEntry.slot_type === "starting" ? selectedEntry.player.position : c.player.position
      const inPos = selectedEntry.slot_type === "starting" ? c.player.position : selectedEntry.player.position
      if (outPos === inPos) { eligible.add(c.id); continue }
      const newOutCount = counts[outPos] - 1
      const newInCount = counts[inPos] + 1
      if (newOutCount >= SQUAD_RULES.min_starting[outPos] && newInCount <= SQUAD_RULES.max_starting[inPos]) {
        eligible.add(c.id)
      }
    }
    return eligible
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEntry, roster, squadComplete])

  // An empty starting/bench slot is only ever present when the squad isn't
  // complete, at which point formation isn't enforced — so any player from
  // the opposite section can always move into it.
  const emptyStartEligible = !!selectedEntry && selectedEntry.slot_type === "bench"
  const emptyBenchEligible = !!selectedEntry && selectedEntry.slot_type === "starting"

  function handleSelect(id: string) {
    if (!canEdit) return
    const entry = roster.find(e => e.id === id)
    if (!entry) return
    if (selectedId === id) { setSelectedId(null); return }
    if (selectedId && eligiblePartnerIds.has(id)) {
      applySwap(selectedId, entry.slot_type as "starting" | "bench", id, entry.bench_order ?? undefined)
      setSelectedId(null)
      return
    }
    setSelectedId(id)
  }

  function handleSelectEmpty(targetSlot: "starting" | "bench", order?: number) {
    if (!selectedId) return
    applySwap(selectedId, targetSlot, undefined, order)
    setSelectedId(null)
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string)
    setSelectedId(null)
    setError(null)
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null)
    const { active, over } = event
    if (!over || active.id === over.id) return

    const draggedId = active.id as string
    const overId = over.id as string

    const dragged = roster.find(e => e.id === draggedId)
    if (!dragged) return

    // Dropped onto an empty slot placeholder — no displaced entry, just a move.
    if (overId.startsWith("empty-bench-")) {
      const order = parseInt(overId.replace("empty-bench-", ""), 10)
      applySwap(draggedId, "bench", undefined, order)
      return
    }
    if (overId.startsWith("empty-start-")) {
      applySwap(draggedId, "starting")
      return
    }

    const target = roster.find(e => e.id === overId)
    if (!target) return

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
      <TeamBudgetBar budget={teamBudget} totalSpent={totalSpent} activeCount={activeCount} pendingDropCredit={pendingDropCredit} />

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
                  isSelected={entry.id === selectedId}
                  isEligible={eligiblePartnerIds.has(entry.id)}
                  dimmed={!!selectedId && entry.id !== selectedId && !eligiblePartnerIds.has(entry.id)}
                  onSelect={() => handleSelect(entry.id)}
                />
              ))}
            </SortableContext>
            {Array.from({ length: Math.max(0, SQUAD_RULES.starting - startingXI.length) }).map((_, i) => (
              <EmptySlot
                key={`empty-start-${i}`}
                id={`empty-start-${i}`}
                label="Empty starting slot"
                isEligible={emptyStartEligible}
                dimmed={!!selectedId && !emptyStartEligible}
                onSelect={() => handleSelectEmpty("starting")}
              />
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
                  isSelected={entry.id === selectedId}
                  isEligible={eligiblePartnerIds.has(entry.id)}
                  dimmed={!!selectedId && entry.id !== selectedId && !eligiblePartnerIds.has(entry.id)}
                  onSelect={() => handleSelect(entry.id)}
                />
              ))}
            </SortableContext>
            {Array.from({ length: emptyBenchSlots }).map((_, i) => (
              <EmptySlot
                key={`empty-bench-${i}`}
                id={`empty-bench-${bench.length + i + 1}`}
                label="Empty bench slot"
                index={bench.length + i + 1}
                isEligible={emptyBenchEligible}
                dimmed={!!selectedId && !emptyBenchEligible}
                onSelect={() => handleSelectEmpty("bench", bench.length + i + 1)}
              />
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

function EmptySlot({
  id, label, index, isEligible, dimmed, onSelect,
}: { id: string; label: string; index?: number; isEligible?: boolean; dimmed?: boolean; onSelect?: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      onClick={isEligible ? onSelect : undefined}
      className={`flex items-center gap-3 py-2.5 px-2 rounded-md border transition-colors ${
        isOver || isEligible
          ? "border-emerald-500/60 bg-emerald-500/10 opacity-70 cursor-pointer"
          : dimmed ? "border-transparent opacity-15" : "border-transparent opacity-30"
      }`}
    >
      {index !== undefined && (
        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-muted/10 text-[10px] font-bold text-muted-foreground border border-border/30">
          {index}
        </div>
      )}
      <div className="w-10 h-6 rounded border border-border/30 bg-muted/10" />
      <p className="text-xs text-muted-foreground/70 italic">{label}</p>
    </div>
  )
}
