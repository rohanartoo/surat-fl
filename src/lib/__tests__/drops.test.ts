import { describe, it, expect } from "vitest"
import { freeDropsForType, getDropQuota } from "@/lib/drops"
import type { AuctionType } from "@/types"

// ─── freeDropsForType ─────────────────────────────────────────────────────────

describe("freeDropsForType", () => {
  const cases: [AuctionType, number][] = [
    ["initial", 3],
    ["post_jan", 3],
    ["post_summer", 3],
    ["mini", 2],
  ]
  it.each(cases)("%s → %i free drops", (type, expected) => {
    expect(freeDropsForType(type)).toBe(expected)
  })
})

// ─── getDropQuota ─────────────────────────────────────────────────────────────

// Builds a chainable Supabase mock that resolves with a given count
function mockSupabase(dropCount: number) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    then: (resolve: (v: { count: number }) => void) => resolve({ count: dropCount }),
  }
  return { from: () => chain }
}

describe("getDropQuota", () => {
  it("returns zero excess and zero penalty when no drops used", async () => {
    const result = await getDropQuota("t1", "a1", "initial", mockSupabase(0))
    expect(result.used).toBe(0)
    expect(result.excess).toBe(0)
    expect(Math.abs(result.penalty_points)).toBe(0) // 0 * -4 = -0 in JS
  })

  it("no excess when drops used equals free allowance (mini, 2 used)", async () => {
    const result = await getDropQuota("t1", "a1", "mini", mockSupabase(2))
    expect(result.excess).toBe(0)
    expect(Math.abs(result.penalty_points)).toBe(0)
  })

  it("1 excess drop → -4 penalty (mini, 3 used, free=2)", async () => {
    const result = await getDropQuota("t1", "a1", "mini", mockSupabase(3))
    expect(result.excess).toBe(1)
    expect(result.penalty_points).toBe(-4)
  })

  it("2 excess drops → -8 penalty (mini, 4 used, free=2)", async () => {
    const result = await getDropQuota("t1", "a1", "mini", mockSupabase(4))
    expect(result.excess).toBe(2)
    expect(result.penalty_points).toBe(-8)
  })

  it("carryover of 1 adds to total_free (initial, 4 used, free=3, carry=1 → no excess)", async () => {
    const result = await getDropQuota("t1", "a1", "initial", mockSupabase(4), 1)
    expect(result.total_free).toBe(4)
    expect(result.excess).toBe(0)
    expect(Math.abs(result.penalty_points)).toBe(0)
  })

  it("carryover of 1 still causes excess when drops exceed combined allowance (initial, 5 used, carry=1)", async () => {
    const result = await getDropQuota("t1", "a1", "initial", mockSupabase(5), 1)
    expect(result.total_free).toBe(4)
    expect(result.excess).toBe(1)
    expect(result.penalty_points).toBe(-4)
  })

  it("carryover is capped at max_carry_over (1) even if higher value passed", async () => {
    // passing carryover=3, but max is 1 → total_free = 3 + min(3,1) = 4
    const result = await getDropQuota("t1", "a1", "initial", mockSupabase(4), 3)
    expect(result.total_free).toBe(4)
    expect(result.carryover).toBe(3) // raw carryover stored as-is
    expect(result.excess).toBe(0)   // effective cap applied in total_free calculation
  })

  it("exposes free_base and carryover fields correctly", async () => {
    const result = await getDropQuota("t1", "a1", "mini", mockSupabase(1), 1)
    expect(result.free_base).toBe(2)
    expect(result.carryover).toBe(1)
    expect(result.total_free).toBe(3)
  })
})
