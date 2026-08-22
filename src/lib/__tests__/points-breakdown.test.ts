import { describe, it, expect, vi } from "vitest"
import { computePointsBreakdown } from "@/lib/points-breakdown"
import type { GameweekStatBreakdown, FplExplainFixture } from "@/types"

function baseStat(overrides: Partial<GameweekStatBreakdown> = {}): GameweekStatBreakdown {
  return {
    minutes: 0, total_points: 0, goals_scored: 0, assists: 0, clean_sheets: 0,
    goals_conceded: 0, own_goals: 0, penalties_saved: 0, penalties_missed: 0,
    yellow_cards: 0, red_cards: 0, saves: 0, bonus: 0,
    ...overrides,
  }
}

function explain(...stats: { identifier: string; points: number; value?: number }[]): FplExplainFixture[] {
  return [{
    fixture: 1,
    stats: stats.map(s => ({ identifier: s.identifier, points: s.points, value: s.value ?? 0, points_modification: 0 })),
  }]
}

describe("computePointsBreakdown", () => {
  it("returns null when explain is missing entirely (a row synced before this field existed)", () => {
    const stat = baseStat({ total_points: 5 })
    expect(computePointsBreakdown(stat)).toBeNull()
  })

  it("returns [] (not null) when explain is present but every entry is zero-point — a real 'did not play'", () => {
    const stat = baseStat({
      total_points: 0,
      explain: explain({ identifier: "minutes", points: 0, value: 0 }),
    })
    expect(computePointsBreakdown(stat)).toEqual([])
  })

  it("skips a zero-point entry even alongside non-zero ones", () => {
    const stat = baseStat({
      total_points: 2,
      explain: explain(
        { identifier: "minutes", points: 2, value: 90 },
        { identifier: "goals_scored", points: 0, value: 0 },
      ),
    })
    expect(computePointsBreakdown(stat)).toEqual([{ label: "Appearance", points: 2 }])
  })

  it("maps every known identifier to its display label with the exact FPL-provided point value, no math applied", () => {
    const stat = baseStat({
      total_points: 5,
      explain: explain(
        { identifier: "minutes", points: 2, value: 90 },
        { identifier: "clean_sheets", points: 4, value: 1 },
        { identifier: "yellow_cards", points: -1, value: 1 },
      ),
    })
    // Mirrors the user's own example: appearance + clean sheet + yellow -> 5 total.
    expect(computePointsBreakdown(stat)).toEqual([
      { label: "Appearance", points: 2 },
      { label: "Clean sheet", points: 4 },
      { label: "Yellow card", points: -1 },
    ])
  })

  it("passes through defensive_contribution's already-resolved bonus (FPL's own threshold decision, not ours)", () => {
    const stat = baseStat({
      total_points: 3,
      explain: explain(
        { identifier: "minutes", points: 2, value: 90 },
        { identifier: "goals_conceded", points: -1, value: 3 },
        { identifier: "defensive_contribution", points: 2, value: 10 },
      ),
    })
    expect(computePointsBreakdown(stat)).toContainEqual({ label: "Defensive contribution", points: 2 })
  })

  it("falls back to the raw identifier as the label for an unrecognized stat", () => {
    const stat = baseStat({
      total_points: 1,
      explain: explain({ identifier: "some_new_fpl_stat", points: 1, value: 1 }),
    })
    expect(computePointsBreakdown(stat)).toEqual([{ label: "some_new_fpl_stat", points: 1 }])
  })

  it("merges the same identifier across multiple fixtures (a double gameweek) into one summed line", () => {
    const stat = baseStat({
      total_points: 4,
      explain: [
        { fixture: 1, stats: [{ identifier: "minutes", points: 2, value: 90, points_modification: 0 }] },
        { fixture: 2, stats: [{ identifier: "minutes", points: 2, value: 90, points_modification: 0 }] },
      ],
    })
    expect(computePointsBreakdown(stat)).toEqual([{ label: "Appearance", points: 4 }])
  })

  it("warns (but does not throw) when merged lines don't sum to total_points, e.g. an unmapped edge case", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const stat = baseStat({
      total_points: 999, // deliberately mismatched
      explain: explain({ identifier: "minutes", points: 2, value: 90 }),
    })
    expect(() => computePointsBreakdown(stat)).not.toThrow()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("line items sum to"))
    warnSpy.mockRestore()
  })

  it("does not warn when the merged lines correctly sum to total_points", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const stat = baseStat({
      total_points: 6,
      explain: explain({ identifier: "minutes", points: 2, value: 90 }, { identifier: "clean_sheets", points: 4, value: 1 }),
    })
    computePointsBreakdown(stat)
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
