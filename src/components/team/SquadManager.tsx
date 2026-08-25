"use client"

import { useState, useCallback, useMemo, useRef, useEffect, type ReactNode } from "react"
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
} from "@dnd-kit/sortable"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { PlayerCard, PlayerCardOverlay } from "./PlayerCard"
import { Pitch, groupByPosition } from "./Pitch"
import { DroppedSection } from "./DroppedSection"
import { TeamBudgetBar } from "./TeamBudgetBar"
import { DeadlineBanner } from "./DeadlineBanner"
import { validateFormation } from "@/lib/auction-engine"
import { cn } from "@/lib/utils"
import { SQUAD_RULES } from "@/types"
import type { RosterEntry, Player, Position, DropQuotaSummary } from "@/types"
import type { LineupLockState } from "@/lib/lineup-lock"

interface Props {
  initialRoster: (RosterEntry & { player: Player })[]
  teamBudget: number
  canEdit: boolean
  quotaSummary?: DropQuotaSummary
  dropsLocked?: boolean
  /** Next unplayed gameweek's opponent(s) per PL club, keyed by players.fpl_team. */
  opponentsByTeam?: Record<string, { opponent_short: string; is_home: boolean }[]>
  /** Deadline-lock state (src/lib/lineup-lock.ts) — separate from canEdit so
   * "read-only, not your team" and "locked, GW deadline passed" render as
   * distinct banners rather than collapsing into one generic disabled state. */
  lineupLock?: LineupLockState
  /** Whether editing is actually blocked right now — lock.locked minus an AM/admin override. */
  lineupLocked?: boolean
  /** Whether the viewer can edit through the lock (AM/admin) — drives the "editable as Auction Master" note. */
  canOverrideLock?: boolean
  /** Rendered as the third grid column, alongside Starting XI/Bench and Dropped — lets the
   * page place Gameweek Performance so it starts at the same vertical height as Starting XI. */
  children?: ReactNode
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

export function SquadManager({ initialRoster, teamBudget, canEdit, quotaSummary: initialQuotaSummary, dropsLocked, opponentsByTeam, lineupLock, lineupLocked, canOverrideLock, children }: Props) {
  const [roster, setRoster] = useState<Entry[]>(initialRoster)
  const [quotaSummary, setQuotaSummary] = useState(initialQuotaSummary)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  // Always-current snapshot of roster, used so a failed swap can revert to
  // the last state the server actually confirmed — not the stale page-load
  // prop, which would silently wipe out any earlier successful changes made
  // in the same session.
  const rosterRef = useRef(roster)
  useEffect(() => { rosterRef.current = roster }, [roster])
  const isSavingRef = useRef(false)

  // Mouse and touch are deliberately separate sensors rather than one
  // PointerSensor. A pitch slot fills most of a phone screen, so if touch
  // dragging activated on movement alone the card would need
  // `touch-action: none` and a swipe starting anywhere on the squad would
  // stop scrolling the page entirely. A delay instead disambiguates the two:
  // a quick swipe scrolls, a press-and-hold starts a drag. tolerance lets a
  // finger wobble slightly during the hold without cancelling it.
  //
  // Tap-to-swap (handleSelect) remains the primary touch interaction and
  // needs none of this — dragging is the convenience path, not the only one.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // Starting XI is displayed top-to-bottom by position (GK, DEF, MID, FWD).
  // Bench is displayed purely by bench_order (sub priority) — position must
  // NOT factor into the sort here, or dragging to reorder sub priority would
  // visually snap back to a position-grouped order on every re-render,
  // making the reorder look like it silently failed.
  const startingXI = roster.filter(e => e.slot_type === "starting").sort(byPosition)
  const bench = roster.filter(e => e.slot_type === "bench")
    .sort((a, b) => (a.bench_order ?? 99) - (b.bench_order ?? 99))
  const dropped = roster.filter(e => e.slot_type === "dropped")

  // This view owns the canonical within-row ordering (most expensive first),
  // and GameweekPerformance mirrors it via the same player ids — so a given
  // position row never appears in two different orders across the two
  // pitches. See buildRosterOrder's export below.
  const startingRows = useMemo(
    () => groupByPosition(
      [...startingXI].sort((a, b) => b.base_price - a.base_price || a.player.web_name.localeCompare(b.player.web_name)),
      e => e.player.position,
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roster],
  )

  const activeEntry = activeId ? roster.find(e => e.id === activeId) ?? null : null

  const activeCount = startingXI.length + bench.length
  const totalSpent = [...startingXI, ...bench].reduce((s, e) => s + e.base_price, 0)
  // Staged (not yet locked) drops return their full purchase price to the
  // team's budget once the auction starts — shown here as a provisional
  // figure. Naturally empty once locked, since locked drops' roster rows
  // are deleted rather than staying in the "dropped" slot_type.
  const pendingDropCredit = dropped.reduce((s, e) => s + e.base_price, 0)

  // The server may reassign captain/VC as a side effect of a swap/drop
  // (e.g. the captain got benched and the armband moved to the next-most-
  // expensive starter) — sync that into local state so it's visible
  // immediately instead of only after a refresh.
  function applyCaptaincy(result: { captain_id?: string | null; vice_captain_id?: string | null }) {
    if (result.captain_id === undefined && result.vice_captain_id === undefined) return
    setRoster(prev => prev.map(e => ({
      ...e,
      is_captain: result.captain_id !== undefined ? e.id === result.captain_id : e.is_captain,
      is_vice_captain: result.vice_captain_id !== undefined ? e.id === result.vice_captain_id : e.is_vice_captain,
    })))
  }

  // Optimistically update local state, then sync with server
  const applySwap = useCallback(async (entryId: string, targetSlot: "starting" | "bench", displacedId?: string, newBenchOrder?: number) => {
    // Refuse to start a second swap while one is still in flight — a click
    // and a drag-end firing off the same gesture (or a fast double-tap)
    // could otherwise both apply, which is how a straight swap (which
    // always balances itself) turned into a bare move that left the
    // Starting XI at 12.
    if (isSavingRef.current) return
    setError(null)

    const snapshotBeforeThisSwap = rosterRef.current
    let invalid = false

    // Optimistic update
    setRoster(prev => {
      const next = prev.map(e => ({ ...e }))
      const entry = next.find(e => e.id === entryId)
      const displaced = displacedId ? next.find(e => e.id === displacedId) : undefined
      if (!entry) { invalid = true; return prev }

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

      // Hard guard: Starting XI must never exceed its cap (the server's
      // validateFormationCaps rejects this too) — refuse locally instead of
      // showing a phantom 12th starting player and sending a request the
      // server can only reject. No bench-count check here: the server
      // doesn't enforce one either (an over-cap bench is an allowed
      // transient state, e.g. mid-way through manually clearing out a
      // roster corrupted by an earlier bug) — a client-only bench cap would
      // just block moves the server actually accepts, leaving the UI stuck
      // showing the pre-swap state until a refresh re-fetches the truth.
      const startingCount = next.filter(e => e.slot_type === "starting").length
      if (startingCount > SQUAD_RULES.starting) {
        invalid = true
        return prev
      }

      return next
    })

    if (invalid) {
      setError("That move isn't allowed — your squad may be out of sync, try refreshing.")
      return
    }

    isSavingRef.current = true
    setIsSaving(true)
    try {
      const result = await post("swap", { entry_id: entryId, target_slot: targetSlot, bench_order: newBenchOrder, displaced_entry_id: displacedId })
      applyCaptaincy(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Swap failed.")
      // Revert only this attempt — back to what the server last confirmed,
      // not the page-load snapshot, so a later failure can't undo earlier
      // successful swaps from the same session.
      setRoster(snapshotBeforeThisSwap)
    } finally {
      isSavingRef.current = false
      setIsSaving(false)
    }
  }, [])

  // Tap-to-substitute: selecting a player highlights every player on the
  // opposite side of the sheet (starting <-> bench) that it could legally
  // swap with. Formation minimums/maximums (SQUAD_RULES.min_starting /
  // max_starting) are only enforced once the squad is complete (15/15) —
  // same threshold handleSwap's server-side formation check uses — since a
  // squad still being built has no fixed starting XI to validate against.
  const selectedEntry = selectedId ? roster.find(e => e.id === selectedId) ?? null : null
  const squadComplete = activeCount === SQUAD_RULES.total

  // Surfaces an already-illegal Starting XI (e.g. a squad drafted before a
  // formation-rule fix landed) so it can't silently carry into a real
  // gameweek unnoticed — swaps themselves are already blocked from
  // *creating* one, but nothing previously flagged one that already exists.
  const formationError = squadComplete
    ? validateFormation(startingXI.map(e => ({ position: e.player.position })))
    : null

  // The server auto-repairs captaincy on swap/drop/return/loan-transfer, but
  // a couple of paths don't run that repair (a freshly drafted squad before
  // its first swap, and an auction cancel restoring dropped players) — so a
  // captain-less Starting XI, while rare, is still reachable. Surface it
  // rather than silently scoring zero captain bonus that gameweek.
  const noCaptainInXI = squadComplete && !startingXI.some(e => e.is_captain)

  const eligiblePartnerIds = useMemo(() => {
    if (!selectedEntry) return new Set<string>()
    const oppositeSlot = selectedEntry.slot_type === "starting" ? "bench" : "starting"
    const candidates = roster.filter(e => e.slot_type === oppositeSlot)

    // Two bench players can always swap priority with each other: it's a pure
    // reorder, so the Starting XI is untouched and no formation rule applies.
    // This used to be reachable only by dragging, which meant bench priority
    // — the thing that decides which substitute comes on — simply could not
    // be changed on a touch device. handleSwap already supports it; only this
    // eligibility calculation was excluding it.
    const benchReorder = selectedEntry.slot_type === "bench"
      ? roster.filter(e => e.slot_type === "bench" && e.id !== selectedEntry.id)
      : []

    if (!squadComplete) return new Set([...candidates, ...benchReorder].map(c => c.id))

    const counts: Record<Position, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 }
    for (const e of startingXI) counts[e.player.position]++

    const eligible = new Set<string>(benchReorder.map(c => c.id))
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
    const snapshot = rosterRef.current
    setRoster(prev => prev.map(e => ({ ...e, is_captain: e.id === entryId })))
    try {
      await post("set-captain", { entry_id: entryId, role: "captain" })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to set captain.")
      setRoster(snapshot)
    }
  }

  async function handleSetVC(entryId: string) {
    setError(null)
    const snapshot = rosterRef.current
    setRoster(prev => prev.map(e => ({ ...e, is_vice_captain: e.id === entryId })))
    try {
      await post("set-captain", { entry_id: entryId, role: "vice_captain" })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to set vice-captain.")
      setRoster(snapshot)
    }
  }

  async function handleMarkDrop(entryId: string) {
    setError(null)
    const snapshot = rosterRef.current
    setRoster(prev => prev.map(e => e.id === entryId
      ? { ...e, slot_type: "dropped" as const, bench_order: null, is_captain: false, is_vice_captain: false }
      : e
    ))
    try {
      const result = await post("mark-drop", { entry_id: entryId })
      if (result.quotaSummary) setQuotaSummary(result.quotaSummary)
      applyCaptaincy(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to stage drop.")
      setRoster(snapshot)
    }
  }

  async function handleReturnFromDrop(entryId: string) {
    setError(null)
    const snapshot = rosterRef.current
    // Optimistically guess bench (the common case) — the server decides the
    // real placement (it may go straight to an open Starting XI slot; see
    // chooseSlotType) and the response below corrects this if it guessed wrong.
    const usedOrders = new Set(bench.map(e => e.bench_order))
    const nextOrder = [1, 2, 3, 4].find(n => !usedOrders.has(n)) ?? null
    setRoster(prev => prev.map(e => e.id === entryId
      ? { ...e, slot_type: "bench" as const, bench_order: nextOrder }
      : e
    ))
    try {
      const result = await post("return-from-drop", { entry_id: entryId })
      if (result.quotaSummary) setQuotaSummary(result.quotaSummary)
      if (result.slot_type) {
        setRoster(prev => prev.map(e => e.id === entryId
          ? { ...e, slot_type: result.slot_type, bench_order: result.bench_order ?? null }
          : e
        ))
      }
      applyCaptaincy(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to return player.")
      setRoster(snapshot)
    }
  }

  const emptyBenchSlots = Math.max(0, SQUAD_RULES.bench - bench.length)
  // Disables both drag (via useSortable's disabled prop) and tap-to-select
  // while a swap is in flight — belt-and-braces alongside the isSavingRef
  // guard in applySwap, so a click and a drag-end firing off the same
  // gesture can't both register. Also disabled once the gameweek deadline
  // has passed (src/lib/lineup-lock.ts) — the server enforces this too, this
  // just keeps the UI from offering an action that would just 409.
  const effectiveCanEdit = canEdit && !lineupLocked && !isSaving

  return (
    <div className="space-y-6">
      <TeamBudgetBar budget={teamBudget} totalSpent={totalSpent} activeCount={activeCount} pendingDropCredit={pendingDropCredit} />

      {lineupLocked && (
        <p className="text-sm text-amber-500 bg-amber-500/10 px-3 py-2 rounded-md">
          🔒 GW {lineupLock?.lockedGameweek} locked — lineups are frozen until this gameweek is fully scored.
        </p>
      )}

      {!lineupLocked && lineupLock?.locked && canOverrideLock && (
        <p className="text-xs text-muted-foreground bg-secondary/50 px-3 py-2 rounded-md">
          Lock active (GW {lineupLock.lockedGameweek}) — editable as Auction Master.
        </p>
      )}

      {!lineupLock?.locked && canEdit && lineupLock?.nextDeadline && (
        <DeadlineBanner deadline={lineupLock.nextDeadline} gameweek={lineupLock.nextDeadlineGameweek ?? 0} />
      )}

      {formationError && (
        <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">
          ⚠ Illegal Starting XI: {formationError}. Swap a bench player in before the next gameweek.
        </p>
      )}

      {noCaptainInXI && (
        <p className="text-sm text-amber-500 bg-amber-500/10 px-3 py-2 rounded-md">
          ⚠ No captain set in your Starting XI. Set one before the next gameweek or you&apos;ll miss the points bonus.
        </p>
      )}

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">{error}</p>
      )}

      {/* Two pitches side by side on xl (roster | performance), stacking
          below that — the old three-column grid can't fit two of them. The
          dropped/staged card sits full-width underneath. */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        <div className="space-y-6">
          <DndContext
            // Explicit, stable id. Without one dnd-kit derives the
            // aria-describedby id from an internal counter that isn't
            // SSR-stable, so the server and client disagree and React logs a
            // hydration mismatch. Harmless-looking, but it means React
            // discards the server markup for this subtree.
            id="squad-manager"
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            {/* One SortableContext spanning the whole pitch: it's a React
                context provider, so the previous two (one per section)
                can't both wrap a single <Pitch> subtree. rectSortingStrategy
                suits the grid shape; handleDragEnd derives everything from
                the dragged/target entries' own slot_type, never from the
                strategy's index maths, so nothing else has to change. */}
            <Card className="border-border/60">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-base">Team Selection</CardTitle>
                <Badge variant="secondary" className="font-mono text-xs">
                  {startingXI.length} / {SQUAD_RULES.starting} · {bench.length} / {SQUAD_RULES.bench}
                </Badge>
              </CardHeader>
              <CardContent className="px-1 pb-1">
                <SortableContext items={[...startingXI, ...bench].map(e => e.id)} strategy={rectSortingStrategy}>
                  <Pitch
                    rows={[
                      ...startingRows.map(row =>
                        row.map(entry => (
                          <PlayerCard
                            key={entry.id}
                            entry={entry}
                            opponents={opponentsByTeam?.[entry.player.fpl_team]}
                            canEdit={effectiveCanEdit}
                            onSetCaptain={handleSetCaptain}
                            onSetVC={handleSetVC}
                            onMarkDrop={handleMarkDrop}
                            isSelected={entry.id === selectedId}
                            isEligible={eligiblePartnerIds.has(entry.id)}
                            dimmed={!!selectedId && entry.id !== selectedId && !eligiblePartnerIds.has(entry.id)}
                            onSelect={() => handleSelect(entry.id)}
                          />
                        )),
                      ),
                      // Empty starting slots have no known position, so they
                      // land in a trailing row beneath the FWD line.
                      Array.from({ length: Math.max(0, SQUAD_RULES.starting - startingXI.length) }).map((_, i) => (
                        <EmptySlot
                          key={`empty-start-${i}`}
                          id={`empty-start-${i}`}
                          label="Empty starting slot"
                          isEligible={emptyStartEligible}
                          dimmed={!!selectedId && !emptyStartEligible}
                          onSelect={() => handleSelectEmpty("starting")}
                        />
                      )),
                    ]}
                    bench={
                      <>
                        {bench.map((entry, i) => (
                          <PlayerCard
                            key={entry.id}
                            entry={entry}
                            opponents={opponentsByTeam?.[entry.player.fpl_team]}
                            benchNumber={entry.bench_order ?? i + 1}
                            canEdit={effectiveCanEdit}
                            onSetCaptain={handleSetCaptain}
                            onSetVC={handleSetVC}
                            onMarkDrop={handleMarkDrop}
                            isSelected={entry.id === selectedId}
                            isEligible={eligiblePartnerIds.has(entry.id)}
                            dimmed={!!selectedId && entry.id !== selectedId && !eligiblePartnerIds.has(entry.id)}
                            onSelect={() => handleSelect(entry.id)}
                          />
                        ))}
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
                      </>
                    }
                  />
                </SortableContext>
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
        </div>

        {/* Gameweek Performance pitch — sits beside the roster pitch on xl. */}
        {children}

        {/* Staged / dropped players, full width beneath both pitches. */}
        <div className="xl:col-span-2">
          <DroppedSection
            entries={dropped}
            canEdit={canEdit}
            onReturnFromDrop={handleReturnFromDrop}
            quotaSummary={quotaSummary}
            dropsLocked={dropsLocked || lineupLocked}
          />
        </div>
      </div>
    </div>
  )
}

/** Pitch-shaped placeholder, matching PitchSlot's footprint so an incomplete
 *  squad doesn't make the rows jump around. */
function EmptySlot({
  id, label, index, isEligible, dimmed, onSelect,
}: { id: string; label: string; index?: number; isEligible?: boolean; dimmed?: boolean; onSelect?: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div className="relative flex">
      {index !== undefined && (
        <span className="absolute -left-1 -top-1 z-[2] flex h-4 w-4 items-center justify-center rounded-full border border-border/40 bg-card font-mono text-[9px] font-semibold text-muted-foreground">
          {index}
        </span>
      )}
      <div
        ref={setNodeRef}
        onClick={isEligible ? onSelect : undefined}
        title={label}
        className={cn(
          "flex h-[4.6rem] w-[5.3rem] items-center justify-center rounded-[0.55rem] border border-dashed transition-colors max-[400px]:w-[4.6rem]",
          isOver || isEligible
            ? "cursor-pointer border-emerald-500/60 bg-emerald-500/10"
            : dimmed ? "border-border/20 opacity-30" : "border-border/30 opacity-60",
        )}
      >
        <span className="px-1 text-center text-[9px] italic leading-tight text-muted-foreground/70">{label}</span>
      </div>
    </div>
  )
}
