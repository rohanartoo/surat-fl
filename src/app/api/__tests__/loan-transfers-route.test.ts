import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { createMockSupabase, type MockSupabase } from "./route-test-helpers"

let mockSupabase: MockSupabase

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => mockSupabase,
}))

vi.mock("@/lib/roles", () => ({
  requireRole: vi.fn(),
  getProfile: vi.fn(),
}))

const { POST } = await import("@/app/api/loan-transfers/route")
const { requireRole, getProfile } = await import("@/lib/roles")

function call(body: unknown) {
  const request = new NextRequest("http://localhost/api/loan-transfers", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  })
  return POST(request)
}

const baseBody = { entry_a_id: "ea", team_a_id: "teamA", entry_b_id: "eb", team_b_id: "teamB" }

function entry(team_id: string, position: string, fpl_team: string, slot_type = "starting") {
  return { data: { id: `entry-${team_id}`, team_id, slot_type, player: { position, fpl_team } } }
}

beforeEach(() => {
  vi.mocked(requireRole).mockReset().mockResolvedValue(undefined)
  vi.mocked(getProfile).mockReset().mockResolvedValue({ id: "admin-1" } as never)
})

describe("POST /api/loan-transfers — validation", () => {
  it("requires all four entry/team ids", async () => {
    mockSupabase = createMockSupabase()
    const res = await call({ entry_a_id: "ea" })
    expect(res.status).toBe(400)
  })

  it("rejects trading a team with itself", async () => {
    mockSupabase = createMockSupabase()
    const res = await call({ ...baseBody, team_b_id: "teamA" })
    expect(res.status).toBe(400)
  })

  it("rejects a negative cash_amount", async () => {
    mockSupabase = createMockSupabase()
    const res = await call({ ...baseBody, cash_amount: -5 })
    expect(res.status).toBe(400)
  })

  it("rejects a cash_team_id that isn't one of the trading teams", async () => {
    mockSupabase = createMockSupabase()
    const res = await call({ ...baseBody, cash_amount: 5, cash_team_id: "teamC" })
    expect(res.status).toBe(400)
  })

  it("maps a role-check failure to 403", async () => {
    vi.mocked(requireRole).mockRejectedValue(new Error("Requires role: auction_master"))
    mockSupabase = createMockSupabase()
    const res = await call(baseBody)
    expect(res.status).toBe(403)
  })

  it("404s when player A's roster entry doesn't exist", async () => {
    mockSupabase = createMockSupabase({ tables: { roster_entries: { data: null } } })
    const res = await call(baseBody)
    expect(res.status).toBe(404)
  })

  it("rejects when player A doesn't actually belong to team_a_id", async () => {
    mockSupabase = createMockSupabase({
      tables: { roster_entries: entry("someOtherTeam", "MID", "Arsenal") },
    })
    const res = await call(baseBody)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/does not belong to team_a_id/)
  })

  it("rejects when player A is staged as dropped, not active", async () => {
    mockSupabase = createMockSupabase({
      tables: { roster_entries: entry("teamA", "MID", "Arsenal", "dropped") },
    })
    const res = await call(baseBody)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/not currently on the active roster/)
  })

  it("404s when player B's roster entry doesn't exist", async () => {
    mockSupabase = createMockSupabase({
      tables: { roster_entries: [entry("teamA", "MID", "Arsenal"), { data: null }] },
    })
    const res = await call(baseBody)
    expect(res.status).toBe(404)
  })

  it("rejects a trade between two different positions", async () => {
    mockSupabase = createMockSupabase({
      tables: {
        roster_entries: [entry("teamA", "MID", "Arsenal"), entry("teamB", "DEF", "Chelsea")],
      },
    })
    const res = await call(baseBody)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/same position/)
  })

  it("404s when one of the trading teams doesn't exist", async () => {
    mockSupabase = createMockSupabase({
      tables: {
        roster_entries: [entry("teamA", "MID", "Arsenal"), entry("teamB", "MID", "Chelsea")],
        teams: { data: [{ id: "teamA", display_name: "Team A", budget: 50 }] },
      },
    })
    const res = await call(baseBody)
    expect(res.status).toBe(404)
  })

  it("rejects a trade that would push a team over the 3-per-club cap", async () => {
    mockSupabase = createMockSupabase({
      tables: {
        roster_entries: [
          entry("teamA", "MID", "Arsenal"),
          entry("teamB", "MID", "Chelsea"),
          // checkClubCap for team B, counting existing Arsenal players (clubA)
          {
            data: [
              { id: "x1", player: { fpl_team: "Arsenal" } },
              { id: "x2", player: { fpl_team: "Arsenal" } },
              { id: "x3", player: { fpl_team: "Arsenal" } },
            ],
          },
        ],
        teams: { data: [{ id: "teamA", display_name: "Team A", budget: 50 }, { id: "teamB", display_name: "Team B", budget: 50 }] },
      },
    })
    const res = await call(baseBody)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/already has 3 players from EPL team Arsenal/)
  })

  it("rejects cash that exceeds the paying team's budget", async () => {
    mockSupabase = createMockSupabase({
      tables: {
        roster_entries: [
          entry("teamA", "MID", "Arsenal"),
          entry("teamB", "MID", "Chelsea"),
          { data: [] }, // club cap check for team B — no Arsenal players
          { data: [] }, // club cap check for team A — no Chelsea players
        ],
        teams: { data: [{ id: "teamA", display_name: "Team A", budget: 10 }, { id: "teamB", display_name: "Team B", budget: 50 }] },
      },
    })
    const res = await call({ ...baseBody, cash_amount: 20, cash_team_id: "teamA" })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/exceeds the paying team's budget/)
  })
})

describe("POST /api/loan-transfers — happy path", () => {
  it("executes a legal same-position trade via rpc_execute_loan_transfer", async () => {
    // A distinct captain+VC already set for both teams' repair-check reads,
    // so repairTeamCaptaincy finds no repair needed (changed: false) and
    // issues no further roster_entries calls — keeps the call sequence
    // below exactly matching the handler's real call order.
    const settledCaptaincy = [
      { id: "cap", base_price: 10, is_captain: true, is_vice_captain: false },
      { id: "vc", base_price: 8, is_captain: false, is_vice_captain: true },
    ]
    mockSupabase = createMockSupabase({
      tables: {
        roster_entries: [
          entry("teamA", "MID", "Arsenal"), // 1: entry A fetch
          entry("teamB", "MID", "Chelsea"), // 2: entry B fetch
          { data: [] }, // 3: club cap check, team B
          { data: [] }, // 4: club cap check, team A
          { data: [] }, // 5: placeIncomingPlayer for team B (entry A moving in)
          { data: [] }, // 6: placeIncomingPlayer for team A (entry B moving in)
          { data: settledCaptaincy }, // 7: repairTeamCaptaincy(team_a_id)
          { data: settledCaptaincy }, // 8: repairTeamCaptaincy(team_b_id)
        ],
        teams: { data: [{ id: "teamA", display_name: "Team A", budget: 50 }, { id: "teamB", display_name: "Team B", budget: 50 }] },
      },
      rpcs: { rpc_execute_loan_transfer: { data: "loan-transfer-uuid" } },
    })
    const res = await call(baseBody)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.loan_transfer_id).toBe("loan-transfer-uuid")
    expect(mockSupabase.rpcCalls).toContainEqual({
      name: "rpc_execute_loan_transfer",
      args: {
        p_entry_a_id: "ea",
        p_team_b_id: "teamB",
        p_slot_type_a: "starting",
        p_bench_order_a: null,
        p_entry_b_id: "eb",
        p_team_a_id: "teamA",
        p_slot_type_b: "starting",
        p_bench_order_b: null,
        p_cash_team_id: null,
        p_cash_amount: 0,
        p_performed_by: "admin-1",
      },
    })
  })
})
