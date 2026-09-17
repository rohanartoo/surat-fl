import { describe, it, expect } from "vitest"
import { mapFplPlayerSummary } from "@/lib/fpl"
import type { FplElementSummary } from "@/types"

// Our synced fixtures table, keyed by FPL fixture id.
const fixturesById = new Map([
  [10, { team_h_short: "ARS", team_a_short: "CHE" }],
  [11, { team_h_short: "LIV", team_a_short: "ARS" }],
  [20, { team_h_short: "ARS", team_a_short: "LIV" }],
  [21, { team_h_short: "CHE", team_a_short: "ARS" }],
  [22, { team_h_short: "ARS", team_a_short: "MCI" }],
  [23, { team_h_short: "NEW", team_a_short: "ARS" }],
])

function historyRow(round: number, overrides: Partial<FplElementSummary["history"][number]> = {}) {
  return {
    fixture: 10, round, was_home: true, minutes: 90, total_points: round,
    goals_scored: 0, assists: 0, clean_sheets: 0, bonus: 0,
    ...overrides,
  }
}

describe("mapFplPlayerSummary", () => {
  it("keeps the last five played fixtures, newest first", () => {
    const summary: FplElementSummary = {
      history: [1, 2, 3, 4, 5, 6, 7].map(r => historyRow(r)),
      fixtures: [],
    }
    const { recent } = mapFplPlayerSummary(summary, fixturesById)
    expect(recent.map(r => r.round)).toEqual([7, 6, 5, 4, 3])
  })

  it("names the other side of each played fixture, and shows ? for one we haven't synced", () => {
    const summary: FplElementSummary = {
      history: [
        historyRow(1, { fixture: 10, was_home: true }),   // home vs CHE
        historyRow(2, { fixture: 11, was_home: false }),  // away at LIV
        historyRow(3, { fixture: 999 }),                  // not in our table
      ],
      fixtures: [],
    }
    const { recent } = mapFplPlayerSummary(summary, fixturesById)
    expect(recent.map(r => r.opponent_short)).toEqual(["?", "LIV", "CHE"])
    expect(recent[1].was_home).toBe(false)
  })

  it("names the other side of each upcoming fixture, skips unscheduled ones, and keeps three", () => {
    const summary: FplElementSummary = {
      history: [],
      fixtures: [
        { id: 30, event: null, is_home: true, difficulty: 3 },
        { id: 20, event: 8, is_home: true, difficulty: 2 },
        { id: 21, event: 9, is_home: false, difficulty: 5 },
        { id: 22, event: 10, is_home: true, difficulty: 4 },
        { id: 23, event: 11, is_home: false, difficulty: 3 },
      ],
    }
    const { upcoming } = mapFplPlayerSummary(summary, fixturesById)
    expect(upcoming).toEqual([
      { event: 8, opponent_short: "LIV", is_home: true, difficulty: 2 },
      { event: 9, opponent_short: "CHE", is_home: false, difficulty: 5 },
      { event: 10, opponent_short: "MCI", is_home: true, difficulty: 4 },
    ])
  })
})
