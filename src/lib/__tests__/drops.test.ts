import { describe, it, expect } from "vitest"
import { freeDropsForType, getDropQuota, checkReDraftEligibility, canSeeStagedDrops, maskStagedDrops } from "@/lib/drops"
import type { AuctionType, Position, SlotType } from "@/types"

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

// ─── checkReDraftEligibility ──────────────────────────────────────────────────

describe("checkReDraftEligibility", () => {
  it("allows re-drafting if there is no drop record (drop = null)", () => {
    const result = checkReDraftEligibility(null, false)
    expect(result).toBeNull()
  })

  it("blocks re-drafting permanently if dropped in/after the post-january window", () => {
    const drop = { dropped_post_january: true, dropped_post_summer: false }
    const result = checkReDraftEligibility(drop, false)
    expect(result).toBe("You cannot re-draft a player you dropped in or after the post-January transfer window. This restriction is permanent for this season.")
  })

  it("treats a post-summer drop as a pre-january drop (not permanent)", () => {
    // dropped_post_summer no longer affects eligibility; only the gate applies.
    const dropBeforeGate = { dropped_post_january: false, dropped_post_summer: true }
    expect(checkReDraftEligibility(dropBeforeGate, false)).toBe(
      "You cannot re-draft this player yet. Players dropped before the post-January window can only be re-drafted from the post-January auction onwards."
    )
    const dropAfterGate = { dropped_post_january: false, dropped_post_summer: true }
    expect(checkReDraftEligibility(dropAfterGate, true)).toBeNull()
  })

  it("blocks pre-january drop re-drafting until the post-january auction exists", () => {
    const drop = { dropped_post_january: false, dropped_post_summer: false }
    const result = checkReDraftEligibility(drop, false)
    expect(result).toBe("You cannot re-draft this player yet. Players dropped before the post-January window can only be re-drafted from the post-January auction onwards.")
  })

  it("allows pre-january drop re-drafting once the post-january auction exists", () => {
    const drop = { dropped_post_january: false, dropped_post_summer: false }
    const result = checkReDraftEligibility(drop, true)
    expect(result).toBeNull()
  })
})


// ─── canSeeStagedDrops ────────────────────────────────────────────────────────

describe("canSeeStagedDrops", () => {
  it("lets admin and auction master see every team's staged drops", () => {
    expect(canSeeStagedDrops("admin", null, "team-a")).toBe(true)
    expect(canSeeStagedDrops("auction_master", null, "team-a")).toBe(true)
  })

  it("lets a team see only its own staged drops", () => {
    expect(canSeeStagedDrops("team", "team-a", "team-a")).toBe(true)
    expect(canSeeStagedDrops("team", "team-b", "team-a")).toBe(false)
  })

  it("hides staged drops from guests, and from a team account with no team linked", () => {
    expect(canSeeStagedDrops("guest", null, "team-a")).toBe(false)
    expect(canSeeStagedDrops("team", null, "team-a")).toBe(false)
  })
})

// ─── maskStagedDrops ──────────────────────────────────────────────────────────

type TestEntry = Parameters<typeof maskStagedDrops>[0][number] & { id: string }

function entry(id: string, position: Position, slot_type: SlotType, opts: Partial<TestEntry> = {}): TestEntry {
  return {
    id, slot_type, bench_order: null, is_captain: false, is_vice_captain: false,
    base_price: 1, player: { position }, ...opts,
  }
}

/** A legal 11: 1 GK, 4 DEF, 4 MID, 2 FWD — plus a 4-man bench. */
function fullSquad(): TestEntry[] {
  return [
    entry("gk1", "GK", "starting"),
    ...["d1", "d2", "d3", "d4"].map(id => entry(id, "DEF", "starting")),
    ...["m1", "m2", "m3", "m4"].map(id => entry(id, "MID", "starting")),
    ...["f1", "f2"].map(id => entry(id, "FWD", "starting")),
    entry("gk2", "GK", "bench", { bench_order: 1 }),
    entry("d5", "DEF", "bench", { bench_order: 2 }),
    entry("m5", "MID", "bench", { bench_order: 3 }),
    entry("f3", "FWD", "bench", { bench_order: 4 }),
  ]
}

describe("maskStagedDrops", () => {
  it("returns the roster unchanged when nothing is staged", () => {
    const roster = fullSquad()
    expect(maskStagedDrops(roster)).toBe(roster)
  })

  it("puts a dropped starter back into the Starting XI gap it left", () => {
    const roster = fullSquad().map(e => e.id === "m2" ? { ...e, slot_type: "dropped" as const, is_captain: false } : e)
    const masked = maskStagedDrops(roster)
    expect(masked.find(e => e.id === "m2")?.slot_type).toBe("starting")
    expect(masked.filter(e => e.slot_type === "starting")).toHaveLength(11)
    expect(masked).toHaveLength(15)
  })

  it("sends a dropped player to the end of the bench when the XI is already full", () => {
    // d5 was on the bench and got dropped; the XI is untouched.
    const roster = fullSquad().map(e => e.id === "d5" ? { ...e, slot_type: "dropped" as const, bench_order: null } : e)
    const masked = maskStagedDrops(roster)
    expect(masked.find(e => e.id === "d5")).toMatchObject({ slot_type: "bench", bench_order: 5 })
  })

  it("never fills an XI gap past a position's formation maximum", () => {
    // Owner moved bench DEF d5 up (5 DEF, the max) then dropped MIDs m3+m4,
    // leaving one XI gap; a pricier dropped DEF must not take it.
    const roster = fullSquad()
      .map(e => e.id === "d5" ? { ...e, slot_type: "starting" as const, bench_order: null } : e)
      .map(e => (e.id === "m3" || e.id === "m4") ? { ...e, slot_type: "dropped" as const } : e)
    roster.push(entry("d6", "DEF", "dropped", { base_price: 9 }))
    const masked = maskStagedDrops(roster)
    expect(masked.find(e => e.id === "d6")?.slot_type).toBe("bench")
    expect(masked.filter(e => e.slot_type === "starting")).toHaveLength(11)
    expect(masked.filter(e => e.slot_type === "starting" && e.player?.position === "DEF")).toHaveLength(5)
  })

  it("leaves no dropped rows and restores no captaincy", () => {
    const roster = fullSquad().map(e => (e.id === "f1" || e.id === "gk2") ? { ...e, slot_type: "dropped" as const, bench_order: null } : e)
    const masked = maskStagedDrops(roster)
    expect(masked.some(e => e.slot_type === "dropped")).toBe(false)
    expect(masked.some(e => e.is_captain || e.is_vice_captain)).toBe(false)
    expect(masked).toHaveLength(15)
  })
})
