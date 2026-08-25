import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { POSITION_ORDER } from "@/lib/auction-engine"
import type { Position } from "@/types"

/**
 * Presentational only — no data fetching, no business logic. Both the
 * editable roster view (SquadManager) and the read-only scored view
 * (GameweekPerformance) render through these, so the two stay visually
 * identical without sharing any of their very different state handling.
 */

/**
 * Groups players into the four position rows the pitch draws, top to bottom
 * (GK → DEF → MID → FWD). `order` is the canonical within-row ordering:
 * Team Selection defines it and Gameweek Performance mirrors it, so the same
 * row never appears in two different orders across the two views. Anyone
 * missing from `order` (a past gameweek's player who has since left the
 * squad) sorts to the end of their row rather than breaking the layout.
 */
export function groupByPosition<T>(
  players: T[],
  getPosition: (p: T) => Position,
  order?: Map<number, number>,
  getId?: (p: T) => number,
): T[][] {
  return POSITION_ORDER.map(pos => {
    const inRow = players.filter(p => getPosition(p) === pos)
    if (!order || !getId) return inRow
    return [...inRow].sort(
      (a, b) => (order.get(getId(a)) ?? Number.MAX_SAFE_INTEGER) - (order.get(getId(b)) ?? Number.MAX_SAFE_INTEGER),
    )
  })
}

interface PitchProps {
  /** Four rows, GK → DEF → MID → FWD. Empty rows collapse to nothing. */
  rows: ReactNode[]
  bench: ReactNode
  /** Rendered under the bench — the auto-subs summary on the scored view. */
  footer?: ReactNode
}

export function Pitch({ rows, bench, footer }: PitchProps) {
  return (
    <div className="px-2 pb-2">
      <div
        className="relative flex flex-col justify-between gap-4 overflow-hidden rounded-[calc(var(--radius)-2px)] px-2 py-9 min-h-96"
        style={{ background: "linear-gradient(to bottom, var(--turf-top), var(--turf-bottom))" }}
      >
        <PitchMarkings />
        {/* Empty rows are dropped rather than rendered: justify-between would
            otherwise reserve a full row of dead space for, say, the
            empty-starting-slot row of a squad that's already complete. */}
        {rows
          .filter(row => !Array.isArray(row) || row.length > 0)
          .map((row, i) => (
            <div key={i} className="relative z-[1] flex flex-wrap justify-center gap-1.5">
              {row}
            </div>
          ))}
      </div>

      <div className="mt-2 rounded-[calc(var(--radius)-2px)] border border-border/60 px-2 py-2.5" style={{ background: "var(--bench-bg)" }}>
        <p className="mb-2 text-center text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Bench
        </p>
        <div className="flex flex-wrap justify-center gap-1.5">{bench}</div>
      </div>

      {footer}
    </div>
  )
}

/**
 * Pitch lines, drawn as positioned divs rather than an SVG so the centre
 * circle stays a circle at any container size (a stretched viewBox would
 * squash it into an ellipse). Read top to bottom: the keeper's own box, the
 * halfway line and centre circle at the true midpoint, then the attacking
 * box at the foot so the FWD row sits just in front of it.
 */
function PitchMarkings() {
  const line = "absolute border-[1.5px]"
  return (
    <div className="pointer-events-none absolute inset-0" style={{ borderColor: "var(--pitch-line)" }} aria-hidden="true">
      <span className={cn(line, "left-1/2 -translate-x-1/2 -top-px h-[16%] w-[46%] rounded-b-[0.3rem] border-t-0")} style={{ borderColor: "var(--pitch-line)" }} />
      <span className={cn(line, "left-1/2 -translate-x-1/2 -top-px h-[7%] w-[24%] rounded-b-[0.3rem] border-t-0")} style={{ borderColor: "var(--pitch-line)" }} />
      <span className="absolute left-0 right-0 top-1/2 border-t-[1.5px]" style={{ borderColor: "var(--pitch-line)" }} />
      <span className={cn(line, "left-1/2 top-1/2 h-[5.2rem] w-[5.2rem] -translate-x-1/2 -translate-y-1/2 rounded-full")} style={{ borderColor: "var(--pitch-line)" }} />
      <span className={cn(line, "left-1/2 -translate-x-1/2 -bottom-px h-[16%] w-[46%] rounded-t-[0.3rem] border-b-0")} style={{ borderColor: "var(--pitch-line)" }} />
      <span className={cn(line, "left-1/2 -translate-x-1/2 -bottom-px h-[7%] w-[24%] rounded-t-[0.3rem] border-b-0")} style={{ borderColor: "var(--pitch-line)" }} />
    </div>
  )
}

export interface PitchSlotProps {
  name: string
  /** Small line under the name — club, or club + opponent on the roster view. */
  subtitle?: string
  /** Price on the roster view, points on the scored view. */
  value: ReactNode
  position: Position
  /** Badges (C / VC / C ×2) and status arrows, rendered in the top strip. */
  topRight?: ReactNode
  /** Bench priority 1–4, shown as a corner pip. */
  benchNumber?: number
  className?: string
  onClick?: () => void
  /** Applied to the inner card — used for the drag handle's listeners. */
  handleProps?: React.HTMLAttributes<HTMLDivElement>
  title?: string
}

/**
 * One player card on the pitch. Kept deliberately dumb: callers decide what
 * goes in `value`/`topRight` and pass their own emphasis via `className`
 * (selection, eligibility, sub state), so neither caller has to fork the
 * markup.
 */
export function PitchSlot({
  name, subtitle, value, position, topRight, benchNumber, className, onClick, handleProps, title,
}: PitchSlotProps) {
  return (
    <div className="relative flex">
      {benchNumber !== undefined && (
        <span className="absolute -left-1 -top-1 z-[2] flex h-4 w-4 items-center justify-center rounded-full border border-border bg-card font-mono text-[9px] font-semibold text-muted-foreground">
          {benchNumber}
        </span>
      )}
      <div
        onClick={onClick}
        title={title}
        {...handleProps}
        className={cn(
          "flex w-[5.3rem] flex-col items-center gap-px rounded-[0.55rem] border px-1.5 pb-1.5 pt-1.5 text-center backdrop-blur-sm transition-all duration-200",
          "sm:w-[5.3rem] max-[400px]:w-[4.6rem]",
          onClick && "cursor-pointer",
          className,
        )}
        style={{ background: "var(--pitch-slot)", borderColor: "var(--pitch-slot-border)" }}
      >
        <div className="flex min-h-4 flex-wrap items-center justify-center gap-1">
          <PitchPositionChip position={position} />
          {topRight}
        </div>
        <p className="max-w-full truncate text-[11px] font-semibold leading-tight">{name}</p>
        {subtitle && (
          <p className="max-w-full truncate text-[9px] leading-tight text-muted-foreground">{subtitle}</p>
        )}
        <p className="mt-px font-mono text-[13px] font-semibold tabular-nums">{value}</p>
      </div>
    </div>
  )
}

const CHIP_COLOR: Record<Position, string> = {
  GK: "text-amber-500",
  DEF: "text-sky-500",
  MID: "text-emerald-500",
  FWD: "text-rose-500",
}

function PitchPositionChip({ position }: { position: Position }) {
  return (
    <span className={cn("rounded-[0.25rem] bg-secondary px-1 py-px text-[9px] font-bold tracking-wider", CHIP_COLOR[position])}>
      {position}
    </span>
  )
}
