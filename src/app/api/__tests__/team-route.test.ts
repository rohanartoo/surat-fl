import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { createMockSupabase, type MockSupabase } from "./route-test-helpers"

let mockSupabase: MockSupabase

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => mockSupabase,
}))

vi.mock("@/lib/roles", () => ({
  requireRole: vi.fn(),
  assertOwnership: vi.fn(),
  getProfile: vi.fn(),
}))

vi.mock("@/lib/lineup-lock", () => ({
  assertLineupEditable: vi.fn(),
}))

const { POST } = await import("@/app/api/team/[action]/route")
const { requireRole, assertOwnership } = await import("@/lib/roles")
const { assertLineupEditable } = await import("@/lib/lineup-lock")

function callAction(action: string, body: unknown) {
  const request = new NextRequest(`http://localhost/api/team/${action}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  })
  return POST(request, { params: Promise.resolve({ action }) })
}

beforeEach(() => {
  vi.mocked(requireRole).mockReset().mockResolvedValue(undefined)
  vi.mocked(assertOwnership).mockReset().mockResolvedValue(undefined)
  vi.mocked(assertLineupEditable).mockReset().mockResolvedValue(undefined)
})

describe("POST /api/team/set-captain", () => {
  it("rejects a request missing entry_id or role", async () => {
    mockSupabase = createMockSupabase()
    const res = await callAction("set-captain", { entry_id: "e1" })
    expect(res.status).toBe(400)
  })

  it("rejects an invalid role value", async () => {
    mockSupabase = createMockSupabase()
    const res = await callAction("set-captain", { entry_id: "e1", role: "manager" })
    expect(res.status).toBe(400)
  })

  it("maps a role-check failure to 403", async () => {
    vi.mocked(requireRole).mockRejectedValue(new Error("Requires role: team"))
    mockSupabase = createMockSupabase()
    const res = await callAction("set-captain", { entry_id: "e1", role: "captain" })
    expect(res.status).toBe(403)
  })

  it("404s when the roster entry doesn't exist", async () => {
    mockSupabase = createMockSupabase({ tables: { roster_entries: { data: null } } })
    const res = await callAction("set-captain", { entry_id: "e1", role: "captain" })
    expect(res.status).toBe(404)
  })

  it("rejects setting a captain who isn't in the Starting XI", async () => {
    mockSupabase = createMockSupabase({
      tables: { roster_entries: { data: { team_id: "t1", slot_type: "bench" } } },
    })
    const res = await callAction("set-captain", { entry_id: "e1", role: "captain" })
    expect(res.status).toBe(400)
  })

  it("never leaves captain and vice-captain on the same player, even when VC is assigned to the current captain", async () => {
    // e1 is the current captain; the request tries to also make it VC. After
    // the handler clears is_captain on e1 (the "other field"), the team has
    // no captain, so repairTeamCaptaincy's price-based fallback must pick a
    // distinct player for each role rather than leaving both on e1.
    mockSupabase = createMockSupabase({
      tables: {
        roster_entries: [
          { data: { team_id: "t1", slot_type: "starting" } }, // handleSetCaptain's own read
          { data: null }, // clear-field-across-team update
          { data: null }, // set-field-on-target update
          {
            data: [
              { id: "e1", base_price: 10, is_captain: false, is_vice_captain: true },
              { id: "e2", base_price: 6, is_captain: false, is_vice_captain: false },
            ],
          }, // repairTeamCaptaincy's read
        ],
      },
    })
    const res = await callAction("set-captain", { entry_id: "e1", role: "vice_captain" })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.captain_id).not.toBeNull()
    expect(body.vice_captain_id).not.toBeNull()
    expect(body.captain_id).not.toBe(body.vice_captain_id)
  })

  it("409s when the lineup is locked", async () => {
    vi.mocked(assertLineupEditable).mockRejectedValue(new Error("Lineup locked: GW 1 is in progress — lineups reopen once it's fully scored."))
    mockSupabase = createMockSupabase({
      tables: { roster_entries: { data: { team_id: "t1", slot_type: "starting" } } },
    })
    const res = await callAction("set-captain", { entry_id: "e1", role: "captain" })
    expect(res.status).toBe(409)
  })

  it("bypasses the lock when assertLineupEditable resolves (e.g. AM/admin override)", async () => {
    // assertLineupEditable itself owns the AM/admin bypass logic (see
    // src/lib/lineup-lock.ts) — from the route's perspective, "resolves"
    // covers both "unlocked" and "locked but caller may override" the same
    // way, so this just confirms the route doesn't add its own redundant gate.
    vi.mocked(assertLineupEditable).mockResolvedValue(undefined)
    mockSupabase = createMockSupabase({
      tables: {
        roster_entries: [
          { data: { team_id: "t1", slot_type: "starting" } },
          { data: null },
          { data: null },
          { data: [{ id: "e1", base_price: 5, is_captain: true, is_vice_captain: false }] },
        ],
      },
    })
    const res = await callAction("set-captain", { entry_id: "e1", role: "captain" })
    expect(res.status).toBe(200)
  })
})

describe("POST /api/team/swap", () => {
  it("rejects a request missing entry_id or target_slot", async () => {
    mockSupabase = createMockSupabase()
    const res = await callAction("swap", { entry_id: "e1" })
    expect(res.status).toBe(400)
  })

  it("rejects an invalid target_slot", async () => {
    mockSupabase = createMockSupabase()
    const res = await callAction("swap", { entry_id: "e1", target_slot: "reserves" })
    expect(res.status).toBe(400)
  })

  it("404s when the roster entry doesn't exist", async () => {
    mockSupabase = createMockSupabase({ tables: { roster_entries: { data: null } } })
    const res = await callAction("swap", { entry_id: "e1", target_slot: "starting" })
    expect(res.status).toBe(404)
  })

  it("rejects a swap that would exceed the Starting XI's per-position cap", async () => {
    // Team already has 5 DEF (the max) in the Starting XI; moving another
    // bench DEF into starting with no displaced partner would make 6.
    mockSupabase = createMockSupabase({
      tables: {
        roster_entries: [
          { data: { id: "e1", slot_type: "bench", team_id: "t1", player_id: 99 } },
          {
            data: [
              { id: "e1", slot_type: "bench", player: { position: "DEF" } },
              { id: "d1", slot_type: "starting", player: { position: "DEF" } },
              { id: "d2", slot_type: "starting", player: { position: "DEF" } },
              { id: "d3", slot_type: "starting", player: { position: "DEF" } },
              { id: "d4", slot_type: "starting", player: { position: "DEF" } },
              { id: "d5", slot_type: "starting", player: { position: "DEF" } },
            ],
          },
        ],
      },
    })
    const res = await callAction("swap", { entry_id: "e1", target_slot: "starting" })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/DEF/)
  })

  it("performs a legal swap via rpc_swap_roster_entry and repairs captaincy", async () => {
    mockSupabase = createMockSupabase({
      tables: {
        roster_entries: [
          { data: { id: "e1", slot_type: "bench", team_id: "t1", player_id: 99 } },
          { data: [{ id: "e1", slot_type: "bench", player: { position: "FWD" } }] },
          { data: [{ id: "e1", base_price: 5, is_captain: true, is_vice_captain: false }] },
        ],
      },
      rpcs: { rpc_swap_roster_entry: { data: null } },
    })
    const res = await callAction("swap", { entry_id: "e1", target_slot: "starting" })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(mockSupabase.rpcCalls).toContainEqual({
      name: "rpc_swap_roster_entry",
      args: { p_entry_id: "e1", p_target_slot: "starting", p_bench_order: null, p_displaced_entry_id: null },
    })
  })

  it("allows reordering two bench players (sub priority) even with a full 11-man Starting XI", async () => {
    // Regression test: the formation-cap simulation used to assume any swap
    // with a displaced_entry_id was cross-section (starting <-> bench), so a
    // same-section bench reorder phantom-added the displaced bench player
    // into the simulated Starting XI, tripping the 11-player cap for a move
    // that never touches the Starting XI at all.
    const starterPositions = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "MID", "FWD", "FWD"]
    const starters = starterPositions.map((position, i) => ({
      id: `s${i}`, slot_type: "starting", player: { position },
    }))
    mockSupabase = createMockSupabase({
      tables: {
        roster_entries: [
          { data: { id: "e1", slot_type: "bench", team_id: "t1", player_id: 99 } },
          {
            data: [
              ...starters,
              { id: "e1", slot_type: "bench", player: { position: "FWD" } },
              { id: "d1", slot_type: "bench", player: { position: "FWD" } },
              { id: "b2", slot_type: "bench", player: { position: "GK" } },
              { id: "b3", slot_type: "bench", player: { position: "DEF" } },
            ],
          },
          { data: [{ id: "e1", base_price: 5, is_captain: false, is_vice_captain: false }] },
        ],
      },
      rpcs: { rpc_swap_roster_entry: { data: null } },
    })
    const res = await callAction("swap", { entry_id: "e1", target_slot: "bench", bench_order: 2, displaced_entry_id: "d1" })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it("propagates an rpc_swap_roster_entry error instead of silently succeeding", async () => {
    mockSupabase = createMockSupabase({
      tables: {
        roster_entries: [
          { data: { id: "e1", slot_type: "bench", team_id: "t1", player_id: 99 } },
          { data: [{ id: "e1", slot_type: "bench", player: { position: "FWD" } }] },
        ],
      },
      rpcs: { rpc_swap_roster_entry: { error: { message: "Starting XI is already full." } } },
    })
    const res = await callAction("swap", { entry_id: "e1", target_slot: "starting" })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("Starting XI is already full.")
  })

  it("409s when the lineup is locked", async () => {
    vi.mocked(assertLineupEditable).mockRejectedValue(new Error("Lineup locked: GW 1 is in progress — lineups reopen once it's fully scored."))
    mockSupabase = createMockSupabase({
      tables: { roster_entries: { data: { id: "e1", slot_type: "bench", team_id: "t1", player_id: 99 } } },
    })
    const res = await callAction("swap", { entry_id: "e1", target_slot: "starting" })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/Lineup locked/)
  })
})

describe("POST /api/team/mark-drop", () => {
  it("409s when the lineup is locked (checked before the auction lookup)", async () => {
    vi.mocked(assertLineupEditable).mockRejectedValue(new Error("Lineup locked: GW 1 is in progress — lineups reopen once it's fully scored."))
    mockSupabase = createMockSupabase({
      tables: { roster_entries: { data: { id: "e1", slot_type: "bench", team_id: "t1", base_price: 5, player: { position: "FWD", base_price: 5 } } } },
    })
    const res = await callAction("mark-drop", { entry_id: "e1" })
    expect(res.status).toBe(409)
  })
})

describe("POST /api/team/return-from-drop", () => {
  it("409s when the lineup is locked (checked before the auction lookup)", async () => {
    vi.mocked(assertLineupEditable).mockRejectedValue(new Error("Lineup locked: GW 1 is in progress — lineups reopen once it's fully scored."))
    mockSupabase = createMockSupabase({
      tables: { roster_entries: { data: { team_id: "t1", player_id: 99, slot_type: "dropped", player: { position: "FWD" } } } },
    })
    const res = await callAction("return-from-drop", { entry_id: "e1" })
    expect(res.status).toBe(409)
  })
})
