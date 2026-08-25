import { describe, it, expect, vi } from "vitest"
import { applyAutoSubs, determineEffectiveCaptain, getStandings, getGameweekHighlights, syncGameweekPoints } from "@/lib/scoring"
import { validateFormation } from "@/lib/auction-engine"
import { fetchFplLive } from "@/lib/fpl"
import type { FplLiveStats } from "@/lib/fpl"
import type { Position } from "@/types"

vi.mock("@/lib/fpl", () => ({ fetchFplLive: vi.fn() }))

// ─── Helpers ──────────────────────────────────────────────────────────────────

let idCounter = 0
function makeEntry(
  player_id: number,
  slot_type: "starting" | "bench",
  position: Position,
  bench_order: number | null = null,
  base_price = 5,
  is_captain = false,
  is_vice_captain = false,
) {
  return { id: `entry-${++idCounter}`, player_id, slot_type, bench_order, position, base_price, is_captain, is_vice_captain }
}

function stats(minutes: number, total_points = minutes > 0 ? 5 : 0) {
  return {
    minutes, total_points,
    goals_scored: 0, assists: 0, clean_sheets: 0, goals_conceded: 0, own_goals: 0,
    penalties_saved: 0, penalties_missed: 0, yellow_cards: 0, red_cards: 0, saves: 0, bonus: 0,
  }
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
  const live: Record<number, FplLiveStats> = {}
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
    expect(subbedIn[0].subbedOutPlayerId).toBe(10) // the FWD who didn't play
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
    const liveStats: Record<number, FplLiveStats> = {}
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
    expect(subbedIn[0].subbedOutPlayerId).toBe(1) // the GK who didn't play
  })

  it("repairs an illegal Starting XI (0 FWD) before applying minutes-based subs", () => {
    // Reproduces the pre-fix auto-assignment bug: 1 GK + 5 DEF + 5 MID
    // starting, all 3 FWDs benched — real FPL can never save this, so there
    // was previously no code path that ever tried to fix it.
    idCounter = 0
    const starting = [
      makeEntry(1, "starting", "GK", null, 8),
      makeEntry(2, "starting", "DEF", null, 6),
      makeEntry(3, "starting", "DEF", null, 5),
      makeEntry(4, "starting", "DEF", null, 4),
      makeEntry(5, "starting", "DEF", null, 3),
      makeEntry(6, "starting", "DEF", null, 2),
      makeEntry(7, "starting", "MID", null, 9),
      makeEntry(8, "starting", "MID", null, 7),
      makeEntry(9, "starting", "MID", null, 1), // cheapest MID — should be the donor
      makeEntry(10, "starting", "MID", null, 10),
      makeEntry(11, "starting", "MID", null, 12),
    ]
    const bench = [
      makeEntry(12, "bench", "GK", 1, 5),
      makeEntry(13, "bench", "FWD", 2, 20), // highest bench priority FWD — should come in
      makeEntry(14, "bench", "FWD", 3, 15),
      makeEntry(15, "bench", "FWD", 4, 10),
    ]
    const liveStats = allPlayed()
    const result = applyAutoSubs(starting, bench, liveStats)

    expect(result).toHaveLength(11)
    expect(validateFormation(result.map(r => ({ position: r.entry.position })))).toBeNull()

    const subbedIn = result.filter(r => r.wasSubbedIn)
    expect(subbedIn).toHaveLength(1)
    expect(subbedIn[0].entry.player_id).toBe(13) // first-priority bench FWD
    expect(subbedIn[0].subbedOutPlayerId).toBe(9) // cheapest MID, bumped
    expect(result.find(r => r.entry.player_id === 9)).toBeUndefined() // cheapest MID bumped
  })
})

// ─── determineEffectiveCaptain ─────────────────────────────────────────────────

describe("determineEffectiveCaptain", () => {
  it("doubles the captain when they played", () => {
    const { starting, bench } = makeSquad()
    starting[0].is_captain = true // player 1, GK
    const liveStats = allPlayed()
    const effectiveXI = applyAutoSubs(starting, bench, liveStats)
    expect(determineEffectiveCaptain([...starting, ...bench], effectiveXI, liveStats)).toBe(1)
  })

  it("falls back to vice-captain when captain didn't play (and was auto-subbed out)", () => {
    const { starting, bench } = makeSquad()
    starting[9].is_captain = true // player 10, FWD
    starting[10].is_vice_captain = true // player 11, FWD — stays in and plays
    const liveStats = allPlayed()
    liveStats[10] = stats(0) // captain didn't play — gets auto-subbed out
    const effectiveXI = applyAutoSubs(starting, bench, liveStats)
    expect(effectiveXI.some(x => x.entry.player_id === 10)).toBe(false) // confirms captain left the XI
    expect(determineEffectiveCaptain([...starting, ...bench], effectiveXI, liveStats)).toBe(11)
  })

  it("returns null when neither captain nor vice-captain played", () => {
    const { starting, bench } = makeSquad()
    starting[9].is_captain = true // player 10
    starting[10].is_vice_captain = true // player 11
    const liveStats = allPlayed()
    liveStats[10] = stats(0)
    liveStats[11] = stats(0)
    // No bench players played either, so neither gets auto-subbed to safety
    liveStats[12] = stats(0)
    liveStats[13] = stats(0)
    liveStats[14] = stats(0)
    liveStats[15] = stats(0)
    const effectiveXI = applyAutoSubs(starting, bench, liveStats)
    expect(determineEffectiveCaptain([...starting, ...bench], effectiveXI, liveStats)).toBeNull()
  })
})

// ─── getStandings ─────────────────────────────────────────────────────────────

function makeQueryChain(data: unknown) {
  const chain = Promise.resolve({ data }) as Promise<{ data: unknown }> & {
    eq: () => ReturnType<typeof makeQueryChain>
    not: () => ReturnType<typeof makeQueryChain>
    range: () => ReturnType<typeof makeQueryChain>
  }
  chain.eq = () => makeQueryChain(data)
  chain.not = () => makeQueryChain(data)
  chain.range = () => makeQueryChain(data)
  return chain
}

function makeSupabase(
  teams: { id: string; display_name: string; short_name: string; color: string }[],
  pointRows: { team_id: string; gameweek: number; points: number }[],
  penaltyRows: { team_id: string; applied_gameweek: number }[] = [],
) {
  return {
    from: (table: string) => ({
      select: () => {
        const data = table === "teams" ? teams : table === "team_transfer_records" ? penaltyRows : pointRows
        return makeQueryChain(data)
      },
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

  it("lists a team's penalized_gws from applied drop-quota penalties", async () => {
    const rows = [
      { team_id: "t1", gameweek: 1, points: 30 },
      { team_id: "t2", gameweek: 1, points: 50 },
    ]
    const penalties = [{ team_id: "t1", applied_gameweek: 1 }]
    const result = await getStandings(makeSupabase([T1, T2], rows, penalties))
    const t1 = result.find(r => r.team_id === "t1")
    const t2 = result.find(r => r.team_id === "t2")
    expect(t1?.penalized_gws).toEqual([1])
    expect(t2?.penalized_gws).toEqual([])
  })

  it("returns an empty penalized_gws array when no penalties have been applied", async () => {
    const rows = [{ team_id: "t1", gameweek: 1, points: 30 }]
    const result = await getStandings(makeSupabase([T1], rows))
    expect(result[0].penalized_gws).toEqual([])
  })
})

// ─── getGameweekHighlights ──────────────────────────────────────────────────

function makeChain(data: unknown) {
  const chain = Promise.resolve({ data }) as Promise<{ data: unknown }> & {
    eq: () => ReturnType<typeof makeChain>
    not: () => ReturnType<typeof makeChain>
  }
  chain.eq = () => makeChain(data)
  chain.not = () => makeChain(data)
  return chain
}

type PointRow = {
  team_id: string
  player_id: number
  points: number
  was_subbed_in: boolean
  counted: boolean
  is_captain: boolean
  player: { web_name: string; first_name: string; second_name: string; fpl_team_short: string }
}

function makeHighlightsSupabase(
  teams: { id: string; display_name: string; short_name: string; color: string }[],
  pointRows: PointRow[],
  penaltyRows: { team_id: string; points_penalty: number }[] = [],
) {
  return {
    from: (table: string) => ({
      select: () => {
        if (table === "teams") return makeChain(teams)
        if (table === "team_transfer_records") return makeChain(penaltyRows)
        return makeChain(pointRows)
      },
    }),
  }
}

function makePointRow(overrides: Partial<PointRow>): PointRow {
  return {
    team_id: "t1",
    player_id: 1,
    points: 5,
    was_subbed_in: false,
    counted: true,
    is_captain: false,
    player: { web_name: "Player", first_name: "First", second_name: "Last", fpl_team_short: "ARS" },
    ...overrides,
  }
}

describe("getGameweekHighlights", () => {
  it("excludes an uncounted (subbed-out/unused bench) row from Player of the Week", async () => {
    const rows = [
      makePointRow({ player_id: 1, points: 20, counted: false, player: { web_name: "Bencher", first_name: "B", second_name: "Player", fpl_team_short: "LIV" } }),
      makePointRow({ player_id: 2, points: 8, counted: true }),
    ]
    const result = await getGameweekHighlights(1, makeHighlightsSupabase([T1], rows))
    expect(result.playerOfTheWeek?.web_name).toBe("Player")
    expect(result.playerOfTheWeek?.points).toBe(8)
  })

  it("un-doubles a captain's points for Player of the Week", async () => {
    const rows = [makePointRow({ points: 18, is_captain: true, counted: true })]
    const result = await getGameweekHighlights(1, makeHighlightsSupabase([T1], rows))
    expect(result.playerOfTheWeek?.points).toBe(9)
  })

  it("includes a team's applied drop penalty when determining Top Team", async () => {
    const rows = [
      makePointRow({ team_id: "t1", player_id: 1, points: 60, counted: true }),
      makePointRow({ team_id: "t2", player_id: 2, points: 55, counted: true }),
    ]
    const penalties = [{ team_id: "t1", points_penalty: -8 }]
    const result = await getGameweekHighlights(1, makeHighlightsSupabase([T1, T2], rows, penalties))
    // t1: 60 - 8 = 52, t2: 55 -> t2 should win despite a lower raw total
    expect(result.topTeam?.team_id).toBe("t2")
    expect(result.topTeam?.points).toBe(55)
  })
})

// ─── syncGameweekPoints ─────────────────────────────────────────────────────

// A minimal thenable query-builder mock — every filter method just returns
// the same chain, which resolves to { data, error } when awaited. Enough for
// the two call shapes syncGameweekPoints's preserveRoster path needs:
// .select(...).eq(...).not(...) and .update(...).eq(...).
function makeSyncChain(data: unknown, error: unknown = null) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = Promise.resolve({ data, error })
  chain.eq = () => chain
  chain.not = () => chain
  chain.maybeSingle = () => chain
  chain.single = () => chain
  return chain
}

describe("syncGameweekPoints", () => {
  it("a finalized gameweek is never rebuilt from the roster — the caller's preserveRoster is ignored, only points refresh", async () => {
    // The whole reason gameweek_scoring_status exists (see
    // src/lib/lineup-lock.ts): even a caller that FORGOT to pass
    // preserveRoster must never be able to rebuild a finalized gameweek's
    // roster composition from current roster_entries. This exercises that
    // safety net directly, independent of whether the cron/sync routes
    // remember to compute it themselves.
    vi.mocked(fetchFplLive).mockResolvedValue({
      10: {
        minutes: 90, total_points: 7, goals_scored: 1, assists: 0, clean_sheets: 0,
        goals_conceded: 0, own_goals: 0, penalties_saved: 0, penalties_missed: 0,
        yellow_cards: 0, red_cards: 0, saves: 0, bonus: 2,
      },
    })

    const capturedUpdates: unknown[] = []
    const queriedTables: string[] = []
    const supabase = {
      from: (table: string) => {
        queriedTables.push(table)
        if (table === "gameweek_scoring_status") {
          return { select: () => makeSyncChain({ gameweek: 1 }, null) }
        }
        if (table === "gameweek_points") {
          return {
            select: () => makeSyncChain([{ id: "gp1", player_id: 10, is_captain: false }], null),
            update: (payload: unknown) => { capturedUpdates.push(payload); return makeSyncChain(null, null) },
            // Deliberately no delete/insert — the rebuild path calling either
            // would throw "not a function" and fail this test, which is the
            // point: a finalized gameweek must never reach that path.
          }
        }
        throw new Error(`Unexpected table query in preserveRoster path: ${table}`)
      },
    }

    // No preserveRoster passed — proving the finalization check itself
    // forces it, not the caller remembering to.
    const result = await syncGameweekPoints(1, supabase)

    expect(result.preservedRoster).toBe(true)
    expect(capturedUpdates).toEqual([{ points: 7, stat_breakdown: expect.objectContaining({ total_points: 7 }) }])
    expect(queriedTables).not.toContain("roster_entries")
    expect(queriedTables).not.toContain("teams")
  })
})

// ─── getTeamGameweekPerformance: bench ordering ───────────────────────────────

/**
 * The bench is ordered by the priority the gameweek actually scored against
 * (gameweek_points.bench_order), so it reads the same way round as the
 * roster view. Gameweeks scored before that column existed have null
 * throughout and must fall back cleanly rather than scrambling.
 */
function makePerfSupabase(rows: unknown[]) {
  const chain = (data: unknown) => {
    const c = Promise.resolve({ data, error: null }) as Promise<{ data: unknown; error: null }> & Record<string, unknown>
    c.eq = () => chain(data)
    c.not = () => chain(data)
    c.in = () => chain(data)
    return c
  }
  return {
    from: (table: string) => ({
      select: () => chain(
        table === "gameweek_points" ? rows
        : table === "team_transfer_records" ? []
        : [],
      ),
    }),
  }
}

const benchRow = (player_id: number, web_name: string, position: Position, bench_order: number | null) => ({
  player_id, points: 0, was_subbed_in: false, is_captain: false, stat_breakdown: null,
  subbed_out_player_id: null, slot_type: "bench" as const, counted: false, bench_order,
  player: { web_name, position },
})

describe("getTeamGameweekPerformance bench ordering", () => {
  it("orders the bench by recorded bench_order, not by position", async () => {
    // Deliberately supplied in position order (GK, DEF, MID, FWD) with a
    // bench priority that disagrees — if position won, this would come back
    // unchanged and the two team-page panels would disagree again.
    const supabase = makePerfSupabase([
      benchRow(1, "Keeper", "GK", 4),
      benchRow(2, "Backer", "DEF", 3),
      benchRow(3, "Middle", "MID", 2),
      benchRow(4, "Striker", "FWD", 1),
    ])
    const { getTeamGameweekPerformance } = await import("@/lib/scoring")
    const res = await getTeamGameweekPerformance("t1", 5, supabase)
    expect(res.bench.map(p => p.web_name)).toEqual(["Striker", "Middle", "Backer", "Keeper"])
    expect(res.bench.map(p => p.bench_order)).toEqual([1, 2, 3, 4])
  })

  it("falls back to position order when bench_order is null throughout (a gameweek scored before the column existed)", async () => {
    const supabase = makePerfSupabase([
      benchRow(4, "Striker", "FWD", null),
      benchRow(1, "Keeper", "GK", null),
      benchRow(3, "Middle", "MID", null),
      benchRow(2, "Backer", "DEF", null),
    ])
    const { getTeamGameweekPerformance } = await import("@/lib/scoring")
    const res = await getTeamGameweekPerformance("t1", 1, supabase)
    // GK → DEF → MID → FWD, i.e. the pre-existing behaviour preserved.
    expect(res.bench.map(p => p.web_name)).toEqual(["Keeper", "Backer", "Middle", "Striker"])
    // Null must survive to the UI so it can omit the pip rather than invent one.
    expect(res.bench.every(p => p.bench_order === null)).toBe(true)
  })

  it("keeps numbered bench players ahead of unnumbered ones rather than interleaving", async () => {
    const supabase = makePerfSupabase([
      benchRow(1, "Unknown", "GK", null),
      benchRow(2, "Second", "DEF", 2),
      benchRow(3, "First", "MID", 1),
    ])
    const { getTeamGameweekPerformance } = await import("@/lib/scoring")
    const res = await getTeamGameweekPerformance("t1", 5, supabase)
    expect(res.bench.map(p => p.web_name)).toEqual(["First", "Second", "Unknown"])
  })
})
