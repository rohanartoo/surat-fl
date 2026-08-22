import type { GameweekStatBreakdown } from "@/types"

// Maps FPL's own stat identifiers (from the `explain` array FPL's live API
// returns per player — see GameweekStatBreakdown.explain) to a display
// label. Deliberately NOT a scoring-rules table: every point VALUE here
// comes straight from FPL's own computation, never reconstructed — no
// position-based lookups, no saves/goals-conceded divisors, no defensive-
// contribution threshold. FPL already resolved all of that server-side;
// this is purely a display-name lookup.
const IDENTIFIER_LABELS: Record<string, string> = {
  minutes: "Appearance",
  goals_scored: "Goals",
  assists: "Assists",
  clean_sheets: "Clean sheet",
  goals_conceded: "Goals conceded",
  own_goals: "Own goal",
  penalties_saved: "Penalty saved",
  penalties_missed: "Penalty missed",
  saves: "Saves",
  defensive_contribution: "Defensive contribution",
  yellow_cards: "Yellow card",
  red_cards: "Red card",
  bonus: "Bonus",
}

export interface PointsBreakdownLine {
  label: string
  points: number
}

/**
 * Turns FPL's own per-fixture `explain` breakdown into the ordered line
 * items a tooltip renders — e.g. { label: "Clean sheet", points: 4 }. Pure:
 * no network/DB access, no scoring math of any kind — every point value is
 * copied directly from what FPL itself computed, never re-derived, so there
 * is nothing here that can drift out of sync with an FPL rule change.
 *
 * Merges same-identifier entries across multiple fixtures (a double
 * gameweek) into one line rather than showing e.g. two separate "Appearance"
 * rows. Skips any zero-point entry. Self-checks that the merged lines sum to
 * stat.total_points (the raw, un-doubled FPL total — never a captain-
 * doubled value) purely as a safety net against a mapping bug on our side —
 * not because the points themselves could be wrong, since they're FPL's own.
 *
 * Returns null (not []) when `explain` itself is missing — a row synced
 * before this field existed — versus [] when explain is present but every
 * entry is zero-point (a real "did not play" gameweek, which FPL still
 * reports a minutes:0 explain entry for). Callers must treat these two
 * cases differently: null means "fall back to a category-only display",
 * [] means "genuinely nothing to show, this player didn't feature".
 */
export function computePointsBreakdown(stat: GameweekStatBreakdown): PointsBreakdownLine[] | null {
  const explain = stat.explain
  if (!explain) return null

  const pointsByIdentifier = new Map<string, number>()
  for (const fixture of explain) {
    for (const entry of fixture.stats) {
      if (entry.points === 0) continue
      pointsByIdentifier.set(entry.identifier, (pointsByIdentifier.get(entry.identifier) ?? 0) + entry.points)
    }
  }

  const lines: PointsBreakdownLine[] = [...pointsByIdentifier].map(([identifier, points]) => ({
    label: IDENTIFIER_LABELS[identifier] ?? identifier,
    points,
  }))

  const sum = lines.reduce((s, l) => s + l.points, 0)
  if (sum !== stat.total_points) {
    console.warn(
      `[computePointsBreakdown] line items sum to ${sum} but total_points is ${stat.total_points} ` +
      `— possible mapping bug or an unrecognized FPL stat identifier. stat: ${JSON.stringify(stat)}`,
    )
  }

  return lines
}
