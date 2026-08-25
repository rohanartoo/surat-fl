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

/**
 * Every slot is sized to fit the WIDEST row a legal formation can produce —
 * five, since max_starting is 5 for both DEF and MID. Sizing to content
 * instead meant a four- or five-man row wrapped onto two lines on a phone,
 * which reads as a broken formation rather than a deliberate shape.
 *
 * `min()` keeps the desktop size exactly as it was: the fixed 5.3rem wins
 * wherever there's room, and the percentage only takes over once five slots
 * plus their gaps would overflow the row. The percentage resolves against
 * the row (the flex container), so it must sit on the flex ITEM — which is
 * why PitchSlot renders its own outer element rather than being wrapped by
 * callers.
 */
// The subtracted 1.6rem is the four `gap-1.5` gutters between five slots
// (4 x 0.375rem = 1.5rem) plus a small allowance so sub-pixel rounding can't
// tip the row into wrapping. Keep the two in step if the row gap changes.
const SLOT_WIDTH = "w-[min(5.3rem,calc((100%-1.6rem)/5))]"

export interface PitchSlotProps {
  name: string
  /** Small line under the name — club, or club + opponent on the roster view. */
  subtitle?: string
  /** Price on the roster view, points on the scored view. */
  value: ReactNode
  position: Position
  /**
   * Status markers — C / VC / C ×2 badges and the auto-sub arrows. Rendered
   * as a corner pip OUTSIDE the card's flow rather than beside the position
   * chip: once slots narrow to fit five across, the top strip only has room
   * for the chip, and sharing it meant the badge was silently clipped away
   * exactly when a captain most needed identifying.
   */
  marker?: ReactNode
  /** Bench priority 1–4, shown as a corner pip. */
  benchNumber?: number
  className?: string
  onClick?: () => void
  /** Applied to the inner card — used for the drag handle's listeners. */
  handleProps?: React.HTMLAttributes<HTMLDivElement>
  title?: string
  /** Ref/style/extra classes for the OUTER element, which is the flex item
   *  the row sizes. dnd-kit's sortable ref and transform go here. */
  outerRef?: (node: HTMLElement | null) => void
  outerStyle?: React.CSSProperties
  outerClassName?: string
  /** Rendered inside the outer element, above the card — the actions button. */
  actions?: ReactNode
}

/**
 * One player card on the pitch. Kept deliberately dumb: callers decide what
 * goes in `value`/`marker` and pass their own emphasis via `className`
 * (selection, eligibility, sub state), so neither caller has to fork the
 * markup.
 */
export function PitchSlot({
  name, subtitle, value, position, marker, benchNumber, className, onClick, handleProps, title,
  outerRef, outerStyle, outerClassName, actions,
}: PitchSlotProps) {
  return (
    <div ref={outerRef} style={outerStyle} className={cn("relative flex", SLOT_WIDTH, outerClassName)}>
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
          "flex w-full flex-col items-center gap-px rounded-[0.55rem] border px-1 pb-1.5 pt-1.5 text-center backdrop-blur-sm transition-all duration-200",
          onClick && "cursor-pointer",
          className,
        )}
        style={{ background: "var(--pitch-slot)", borderColor: "var(--pitch-slot-border)" }}
      >
        {/* Fixed height, no wrapping, and right padding that reserves room
            for the actions button overlaid at the top-right — without it the
            centred chip sits under that button and gets clipped ("FWD" read
            as "FWL" at phone widths). */}
        <div className="flex h-4 w-full shrink-0 items-center justify-center overflow-hidden pr-3.5">
          <PitchPositionChip position={position} />
        </div>
        <p className="max-w-full truncate text-[11px] font-semibold leading-tight">{name}</p>
        {subtitle && (
          <p className="max-w-full truncate text-[9px] leading-tight text-muted-foreground">{subtitle}</p>
        )}
        <p className="mt-px font-mono text-[13px] font-semibold tabular-nums">{value}</p>
      </div>
      {marker && (
        <span className="absolute -bottom-1 -left-1 z-[2] flex items-center gap-0.5 rounded-full border border-border bg-card px-1 py-px leading-none">
          {marker}
        </span>
      )}
      {actions}
    </div>
  )
}

/** Same footprint as a PitchSlot, for callers rendering a placeholder. */
export function PitchSlotShell({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("relative flex", SLOT_WIDTH, className)}>{children}</div>
}

const CHIP_COLOR: Record<Position, string> = {
  GK: "text-amber-500",
  DEF: "text-sky-500",
  MID: "text-emerald-500",
  FWD: "text-rose-500",
}

function PitchPositionChip({ position }: { position: Position }) {
  return (
    <span className={cn("shrink-0 rounded-[0.25rem] bg-secondary px-0.5 py-px text-[9px] font-bold leading-none tracking-tight", CHIP_COLOR[position])}>
      {position}
    </span>
  )
}
