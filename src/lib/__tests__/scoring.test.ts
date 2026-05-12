import { describe, it, expect } from "vitest"
import { applyAutoSubs, getStandings } from "@/lib/scoring"
import type { Position } from "@/types"

// ─── Helpers ──────────────────────────────────────────────────────────────────

let idCounter = 0
function makeEntry(
  player_id: number,
  slot_type: "starting" | "bench",
  position: Position,
  bench_order: number | null = null,
) {
  return { id: `entry-${++idCounter}`, player_id, slot_type, bench_order, position }
}

function stats(minutes: number, total_points = minutes > 0 ? 5 : 0) {
  return { minutes, total_points }
}

// A standard 4-4-2 starting XI with player IDs 1–11
// Bench: GK=12, DEF=13, MID=14, FWD=15
function makeSquad() {
  const starting = [
    makeEntry(1, "starting", "GK"),
    makeEntry(2, "starting", "DEF"),
    makeEntry(3, "starting", "DEF"),
    makeEntry(4, "starting", "DEF"),
    makeEntry(5, "starting", "DEF"),
    makeEntry(6, "starting", "MID"),
    makeEntry(7, "starting", "MID"),
    makeEntry(8, "starting", "MID"),
    makeEntry(9, "starting", "MID"),
    makeEntry(10, "starting", "FWD"),
    makeEntry(11, "starting", "FWD"),
  ]
  const bench = [
    makeEntry(12, "bench", "GK", 1),
    makeEntry(13, "bench", "DEF", 2),
    makeEntry(14, "bench", "MID", 3),
    makeEntry(15, "bench", "FWD", 4),
  ]
  return { starting, bench }
}

// All played
function allPlayed() {
  const live: Record<number, { minutes: number; total_points: number }> = {}
  for (let i = 1; i <= 15; i++) live[i] = stats(90)
  return live
}

// ─── applyAutoSubs ────────────────────────────────────────────────────────────

describe("applyAutoSubs", () => {
  it("makes no substitutions when all starters played", () => {
    const { starting, bench } = makeSquad()
    const liveStats = allPlayed()
    const result = applyAutoSubs(starting, bench, liveStats)
    expect(result.every(r => !r.wasSubbedIn)).toBe(true)
    expect(result.map(r => r.entry.player_id)).toEqual(starting.map(e => e.player_id))
  })

  it("subs in the first valid outfield bench player when a FWD starter didn't play", () => {
    const { starting, bench } = makeSquad()
    const liveStats = allPlayed()
    // FWD starter (player 10) didn't play
    // bench sorted by bench_order: GK(12,1), DEF(13,2), MID(14,3), FWD(15,4)
    // GK(12) is skipped — cannot replace an outfield player
    // DEF(13) replacing FWD: 4DEF + 4MID + 1FWD — valid (min 1 FWD still met)
    liveStats[10] = stats(0)
    const result = applyAutoSubs(starting, bench, liveStats)
    const subbedIn = result.filter(r => r.wasSubbedIn)
    expect(subbedIn).toHaveLength(1)
    expect(subbedIn[0].entry.player_id).toBe(13) // DEF bench player (first valid non-GK)
  })

  it("respects bench priority — skips bench players who didn't play", () => {
    const { starting, bench } = makeSquad()
    const liveStats = allPlayed()
    // FWD starter (player 10) didn't play
    liveStats[10] = stats(0)
    liveStats[12] = stats(0) // GK bench (bench_order=1) didn't play
    liveStats[13] = stats(0) // DEF bench (bench_order=2) didn't play
    // MID bench (14, bench_order=3) played — first valid remaining
    const result = applyAutoSubs(starting, bench, liveStats)
    const subbedIn = result.filter(r => r.wasSubbedIn)
    expect(subbedIn).toHaveLength(1)
    expect(subbedIn[0].entry.player_id).toBe(14)
  })

  it("blocks sub when the only available bencher would violate formation minimum", () => {
    // 3-5-2: if a DEF doesn't play and the only bench player is FWD,
    // subbing in would drop DEF count to 2 — below minimum of 3
    const starting3 = [
      makeEntry(1, "starting", "GK"),
      makeEntry(2, "starting", "DEF"),
      makeEntry(3, "starting", "DEF"),
      makeEntry(4, "starting", "DEF"),
      makeEntry(5, "starting", "MID"),
      makeEntry(6, "starting", "MID"),
      makeEntry(7, "starting", "MID"),
      makeEntry(8, "starting", "MID"),
      makeEntry(9, "starting", "MID"),
      makeEntry(10, "starting", "FWD"),
      makeEntry(11, "starting", "FWD"),
    ]
    const bench3 = [makeEntry(20, "bench", "FWD", 1)]
    const liveStats: Record<number, { minutes: number; total_points: number }> = {}
    for (let i = 1; i <= 11; i++) liveStats[i] = stats(90)
    liveStats[20] = stats(90)
    liveStats[2] = stats(0) // DEF starter didn't play
    const result = applyAutoSubs(starting3, bench3, liveStats)
    const player2result = result.find(r => r.entry.player_id === 2)
    expect(player2result).toBeDefined()
    expect(player2result?.wasSubbedIn).toBe(false)
    expect(player2result?.entry.player_id).toBe(2)
  })

  it("GK bench player cannot sub in for an outfield starter", () => {
    const { starting, bench } = makeSquad()
    const liveStats = allPlayed()
    liveStats[10] = stats(0) // FWD starter didn't play
    // Make all bench players except GK also not play
    liveStats[13] = stats(0)
    liveStats[14] = stats(0)
    liveStats[15] = stats(0)
    // Only GK bench (12) played — but cannot sub for FWD
    const result = applyAutoSubs(starting, bench, liveStats)
    expect(result.every(r => !r.wasSubbedIn)).toBe(true)
    expect(result.find(r => r.entry.player_id === 10)?.entry.player_id).toBe(10)
  })

  it("handles multiple substitutions in order", () => {
    const { starting, bench } = makeSquad()
    const liveStats = allPlayed()
    // Two MID starters didn't play (players 6 and 7)
    liveStats[6] = stats(0)
    liveStats[7] = stats(0)
    const result = applyAutoSubs(starting, bench, liveStats)
    const subbedIn = result.filter(r => r.wasSubbedIn)
    expect(subbedIn).toHaveLength(2)
  })

  it("does not use the same bench player twice", () => {
    const { starting, bench } = makeSquad()
    const liveStats = allPlayed()
    // Two starters didn't play but only one bench player played (MID player 14)
    liveStats[6] = stats(0)
    liveStats[7] = stats(0)
    liveStats[12] = stats(0) // GK bench didn't play
    liveStats[13] = stats(0) // DEF bench didn't play
    liveStats[15] = stats(0) // FWD bench didn't play
    // Only MID bench (14) played — can only sub in once
    const result = applyAutoSubs(starting, bench, liveStats)
    const subbedIn = result.filter(r => r.wasSubbedIn)
    expect(subbedIn).toHaveLength(1)
    expect(subbedIn[0].entry.player_id).toBe(14)
  })

  it("keeps starter in XI when all bench players also didn't play", () => {
    const { starting, bench } = makeSquad()
    const liveStats = allPlayed()
    liveStats[9] = stats(0)  // MID starter didn't play
    liveStats[12] = stats(0) // GK bench didn't play
    liveStats[13] = stats(0) // DEF bench didn't play
    liveStats[14] = stats(0) // MID bench didn't play
    liveStats[15] = stats(0) // FWD bench didn't play
    const result = applyAutoSubs(starting, bench, liveStats)
    expect(result.every(r => !r.wasSubbedIn)).toBe(true)
    expect(result.find(r => r.entry.player_id === 9)?.entry.player_id).toBe(9)
  })

  it("subs GK for GK when GK didn't play", () => {
    const { starting, bench } = makeSquad()
    const liveStats = allPlayed()
    liveStats[1] = stats(0)  // GK starter didn't play
    const result = applyAutoSubs(starting, bench, liveStats)
    const subbedIn = result.filter(r => r.wasSubbedIn)
    expect(subbedIn).toHaveLength(1)
    expect(subbedIn[0].entry.player_id).toBe(12) // GK bench player
    expect(subbedIn[0].entry.position).toBe("GK")
  })
})

// ─── getStandings ─────────────────────────────────────────────────────────────

function makeSupabase(
  teams: { id: string; display_name: string; short_name: string; color: string }[],
  pointRows: { team_id: string; gameweek: number; points: number }[],
) {
  return {
    from: (table: string) => ({
      select: () =>
        Promise.resolve({ data: table === "teams" ? teams : pointRows }),
    }),
  }
}

const T1 = { id: "t1", display_name: "Team One", short_name: "ONE", color: "#111" }
const T2 = { id: "t2", display_name: "Team Two", short_name: "TWO", color: "#222" }
const T3 = { id: "t3", display_name: "Team Three", short_name: "THR", color: "#333" }

describe("getStandings", () => {
  it("sorts teams by total points descending", async () => {
    const rows = [
      { team_id: "t1", gameweek: 1, points: 40 },
      { team_id: "t2", gameweek: 1, points: 60 },
      { team_id: "t3", gameweek: 1, points: 50 },
    ]
    const result = await getStandings(makeSupabase([T1, T2, T3], rows))
    expect(result.map(r => r.team_id)).toEqual(["t2", "t3", "t1"])
  })

  it("accumulates points across multiple gameweeks", async () => {
    const rows = [
      { team_id: "t1", gameweek: 1, points: 30 },
      { team_id: "t1", gameweek: 2, points: 40 },
      { team_id: "t2", gameweek: 1, points: 50 },
      { team_id: "t2", gameweek: 2, points: 10 },
    ]
    const result = await getStandings(makeSupabase([T1, T2], rows))
    expect(result[0].team_id).toBe("t1") // 70 > 60
    expect(result[0].total_points).toBe(70)
    expect(result[1].total_points).toBe(60)
  })

  it("returns 0 total_points for a team with no point rows", async () => {
    const rows = [{ team_id: "t1", gameweek: 1, points: 50 }]
    const result = await getStandings(makeSupabase([T1, T2], rows))
    const t2 = result.find(r => r.team_id === "t2")
    expect(t2?.total_points).toBe(0)
  })

  it("sets latest_gw_points to points scored in the most recent gameweek", async () => {
    const rows = [
      { team_id: "t1", gameweek: 1, points: 30 },
      { team_id: "t1", gameweek: 2, points: 55 },
    ]
    const result = await getStandings(makeSupabase([T1], rows))
    expect(result[0].latest_gw).toBe(2)
    expect(result[0].latest_gw_points).toBe(55)
  })

  it("computes positive position_change for a team that improved rank", async () => {
    // After GW1: t2=50, t1=30. After GW2: t1=80 total, t2=60 total → t1 moves up
    const rows = [
      { team_id: "t1", gameweek: 1, points: 30 },
      { team_id: "t2", gameweek: 1, points: 50 },
      { team_id: "t1", gameweek: 2, points: 50 },
      { team_id: "t2", gameweek: 2, points: 10 },
    ]
    const result = await getStandings(makeSupabase([T1, T2], rows))
    const t1 = result.find(r => r.team_id === "t1")
    expect(t1?.position_change).toBeGreaterThan(0)
  })

  it("computes negative position_change for a team that dropped rank", async () => {
    const rows = [
      { team_id: "t1", gameweek: 1, points: 30 },
      { team_id: "t2", gameweek: 1, points: 50 },
      { team_id: "t1", gameweek: 2, points: 50 },
      { team_id: "t2", gameweek: 2, points: 10 },
    ]
    const result = await getStandings(makeSupabase([T1, T2], rows))
    const t2 = result.find(r => r.team_id === "t2")
    expect(t2?.position_change).toBeLessThan(0)
  })
})
