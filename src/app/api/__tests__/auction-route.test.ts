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

const { POST } = await import("@/app/api/auction/[action]/route")
const { requireRole } = await import("@/lib/roles")

function callAction(action: string, body: unknown) {
  const request = new NextRequest(`http://localhost/api/auction/${action}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  })
  return POST(request, { params: Promise.resolve({ action }) })
}

beforeEach(() => {
  vi.mocked(requireRole).mockReset().mockResolvedValue(undefined)
})

describe("POST /api/auction/cancel", () => {
  it("requires auction_id", async () => {
    mockSupabase = createMockSupabase()
    const res = await callAction("cancel", {})
    expect(res.status).toBe(400)
  })

  it("maps a role-check failure to 403", async () => {
    vi.mocked(requireRole).mockRejectedValue(new Error("Requires role: auction_master"))
    mockSupabase = createMockSupabase()
    const res = await callAction("cancel", { auction_id: "a1" })
    expect(res.status).toBe(403)
  })

  it("propagates an rpc_cancel_auction error instead of silently succeeding", async () => {
    mockSupabase = createMockSupabase({
      rpcs: { rpc_cancel_auction: { error: { message: "Only pending or active auctions can be cancelled." } } },
    })
    const res = await callAction("cancel", { auction_id: "a1" })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("Only pending or active auctions can be cancelled.")
  })

  it("cancels atomically via rpc_cancel_auction on success", async () => {
    mockSupabase = createMockSupabase({ rpcs: { rpc_cancel_auction: { data: null } } })
    const res = await callAction("cancel", { auction_id: "a1" })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(mockSupabase.rpcCalls).toContainEqual({ name: "rpc_cancel_auction", args: { p_auction_id: "a1" } })
  })
})

describe("POST /api/auction/start-bidding", () => {
  const baseLot = {
    id: "lot1",
    phase: "interest",
    auction_id: "a1",
    bid_start_team_index: 0,
    player: { id: 1, web_name: "Player", base_price: 5, position: "MID" },
  }

  it("requires lot_id", async () => {
    mockSupabase = createMockSupabase()
    const res = await callAction("start-bidding", {})
    expect(res.status).toBe(400)
  })

  it("404s when the lot doesn't exist", async () => {
    mockSupabase = createMockSupabase({ tables: { auction_lots: { data: null } } })
    const res = await callAction("start-bidding", { lot_id: "lot1" })
    expect(res.status).toBe(404)
  })

  it("rejects closing interest on a lot that's already bidding", async () => {
    mockSupabase = createMockSupabase({
      tables: { auction_lots: { data: { ...baseLot, phase: "bidding" } } },
    })
    const res = await callAction("start-bidding", { lot_id: "lot1" })
    expect(res.status).toBe(400)
  })

  it("concludes with no winner when nobody declared interest", async () => {
    mockSupabase = createMockSupabase({
      tables: {
        auction_lots: { data: baseLot },
        auctions: { data: { auction_order: ["tA", "tB"], current_bidder_index: 0 } },
        bids: { data: [] },
      },
      rpcs: { rpc_conclude_lot_no_winner: { data: { next_bidder_id: null } } },
    })
    const res = await callAction("start-bidding", { lot_id: "lot1" })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ concluded: true, reason: "no_interest" })
  })

  it("rejects a solo-win the sole interested team can't afford", async () => {
    // base_price 5, budget 3, 14/15 slots filled -> maxAllowed = 3 - 0 = 3 < 5.
    mockSupabase = createMockSupabase({
      tables: {
        auction_lots: { data: baseLot },
        auctions: { data: { auction_order: ["tA"], current_bidder_index: 0 } },
        bids: { data: [{ team_id: "tA", is_interested: true }] },
        teams: { data: { budget: 3, display_name: "Broke FC" } },
        roster_entries: { count: 14 },
      },
    })
    const res = await callAction("start-bidding", { lot_id: "lot1" })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Broke FC cannot afford this player/)
  })

  it("completes a solo-win the sole interested team can afford", async () => {
    mockSupabase = createMockSupabase({
      tables: {
        auction_lots: { data: baseLot },
        auctions: { data: { auction_order: ["tA"], current_bidder_index: 0 } },
        bids: { data: [{ team_id: "tA", is_interested: true }] },
        teams: { data: { budget: 100, display_name: "Rich FC" } },
        roster_entries: { count: 10 },
      },
    })
    const res = await callAction("start-bidding", { lot_id: "lot1" })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ solo_win: true, winner_id: "tA", winning_bid: 5 })
  })

  it("starts a bidding round with multiple interested teams", async () => {
    mockSupabase = createMockSupabase({
      tables: {
        auction_lots: { data: baseLot },
        auctions: { data: { auction_order: ["tA", "tB"], current_bidder_index: 0 } },
        bids: { data: [{ team_id: "tA", is_interested: true }, { team_id: "tB", is_interested: true }] },
      },
    })
    const res = await callAction("start-bidding", { lot_id: "lot1" })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.bidding).toBe(true)
    expect(["tA", "tB"]).toContain(body.first_bidder)
  })
})
