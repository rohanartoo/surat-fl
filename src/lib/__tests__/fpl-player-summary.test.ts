import { describe, it, expect } from "vitest"
import { mapFplPlayerSummary } from "@/lib/fpl"
import type { FplElementSummary, FplTeam } from "@/types"

const teams: FplTeam[] = [
  { id: 1, name: "Arsenal", short_name: "ARS", code: 3 },
  { id: 2, name: "Chelsea", short_name: "CHE", code: 8 },
  { id: 3, name: "Liverpool", short_name: "LIV", code: 14 },
]

function historyRow(round: number, overrides: Partial<FplElementSummary["history"][number]> = {}) {
  return {
    round, opponent_team: 2, was_home: true, minutes: 90, total_points: round,
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
    const { recent } = mapFplPlayerSummary(summary, teams)
    expect(recent.map(r => r.round)).toEqual([7, 6, 5, 4, 3])
  })

  it("resolves opponent ids to short names, and falls back to ? for an unknown id", () => {
    const summary: FplElementSummary = {
      history: [historyRow(1, { opponent_team: 3, was_home: false }), historyRow(2, { opponent_team: 99 })],
      fixtures: [],
    }
    const { recent } = mapFplPlayerSummary(summary, teams)
    expect(recent[1]).toMatchObject({ round: 1, opponent_short: "LIV", was_home: false })
    expect(recent[0].opponent_short).toBe("?")
  })

  it("names the other side of each upcoming fixture, skips unscheduled ones, and keeps three", () => {
    const summary: FplElementSummary = {
      history: [],
      fixtures: [
        { event: null, team_h: 1, team_a: 2, is_home: true, difficulty: 3 },
        { event: 8, team_h: 1, team_a: 2, is_home: true, difficulty: 2 },
        { event: 9, team_h: 3, team_a: 1, is_home: false, difficulty: 5 },
        { event: 10, team_h: 1, team_a: 3, is_home: true, difficulty: 4 },
        { event: 11, team_h: 2, team_a: 1, is_home: false, difficulty: 3 },
      ],
    }
    const { upcoming } = mapFplPlayerSummary(summary, teams)
    expect(upcoming).toEqual([
      { event: 8, opponent_short: "CHE", is_home: true, difficulty: 2 },
      { event: 9, opponent_short: "LIV", is_home: false, difficulty: 5 },
      { event: 10, opponent_short: "LIV", is_home: true, difficulty: 4 },
    ])
  })
})
