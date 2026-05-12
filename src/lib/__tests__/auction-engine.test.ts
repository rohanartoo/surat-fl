import { describe, it, expect } from "vitest"
import {
  validateBid,
  isSoloWin,
  getMinNextBid,
  getMaxBid,
  getNextBidder,
  getNextBidStartIndex,
  chooseSlotType,
  validateFormation,
} from "@/lib/auction-engine"
import type { Position } from "@/types"

// ─── validateBid ─────────────────────────────────────────────────────────────

describe("validateBid", () => {
  describe("integer check", () => {
    it("rejects a non-integer amount", () => {
      expect(validateBid(5.5, null, 5, 100, 5)?.code).toBe("NOT_INTEGER")
    })
    it("rejects NaN", () => {
      expect(validateBid(NaN, null, 5, 100, 5)?.code).toBe("NOT_INTEGER")
    })
  })

  describe("first bid (currentBid = null)", () => {
    it("rejects amount below base_price", () => {
      expect(validateBid(4, null, 5, 100, 5)?.code).toBe("BELOW_MIN")
    })
    it("accepts amount exactly at base_price", () => {
      expect(validateBid(5, null, 5, 100, 5)).toBeNull()
    })
    it("accepts amount above base_price", () => {
      expect(validateBid(10, null, 5, 100, 5)).toBeNull()
    })
  })

  describe("subsequent bid increments", () => {
    it("rejects bid below min increment when current < £20m", () => {
      // currentBid=15, needs +1, so min=16; bid of 15 fails
      expect(validateBid(15, 15, 5, 100, 5)?.code).toBe("BAD_INCREMENT")
    })
    it("accepts bid at min increment when current < £20m", () => {
      expect(validateBid(16, 15, 5, 100, 5)).toBeNull()
    })
    it("rejects +£1m increment when current bid is exactly £20m (needs +£2m)", () => {
      expect(validateBid(21, 20, 5, 100, 5)?.code).toBe("BAD_INCREMENT")
    })
    it("accepts +£2m increment when current bid is exactly £20m", () => {
      expect(validateBid(22, 20, 5, 100, 5)).toBeNull()
    })
    it("accepts +£2m increment when current bid is above £20m", () => {
      expect(validateBid(32, 30, 5, 100, 5)).toBeNull()
    })
    it("rejects +£1m increment when current bid is above £20m", () => {
      expect(validateBid(31, 30, 5, 100, 5)?.code).toBe("BAD_INCREMENT")
    })
  })

  describe("budget / max bid", () => {
    it("rejects amount exceeding max allowed (budget - emptySlots + 1)", () => {
      // budget=20, emptySlots=5 → max=20-(5-1)=16
      expect(validateBid(17, null, 5, 20, 5)?.code).toBe("EXCEEDS_MAX")
    })
    it("accepts amount exactly at max allowed", () => {
      expect(validateBid(16, null, 5, 20, 5)).toBeNull()
    })
    it("with 1 empty slot max equals full budget", () => {
      // budget=50, emptySlots=1 → max=50-(1-1)=50
      expect(validateBid(50, null, 5, 50, 1)).toBeNull()
    })
  })
})

// ─── getMinNextBid ────────────────────────────────────────────────────────────

describe("getMinNextBid", () => {
  it("returns basePrice when currentBid is null", () => {
    expect(getMinNextBid(null, 7)).toBe(7)
  })
  it("adds £1m when current bid is below £20m", () => {
    expect(getMinNextBid(15, 5)).toBe(16)
  })
  it("adds £1m when current bid is £19m", () => {
    expect(getMinNextBid(19, 5)).toBe(20)
  })
  it("adds £2m when current bid is exactly £20m", () => {
    expect(getMinNextBid(20, 5)).toBe(22)
  })
  it("adds £2m when current bid is above £20m", () => {
    expect(getMinNextBid(30, 5)).toBe(32)
  })
})

// ─── getMaxBid ────────────────────────────────────────────────────────────────

describe("getMaxBid", () => {
  it("subtracts (emptySlots - 1) from budget", () => {
    expect(getMaxBid(50, 5)).toBe(46)
  })
  it("returns full budget when only 1 slot remaining", () => {
    expect(getMaxBid(10, 1)).toBe(10)
  })
  it("returns 0 when budget is insufficient to reserve remaining slots", () => {
    expect(getMaxBid(3, 5)).toBe(0)
  })
})

// ─── isSoloWin ────────────────────────────────────────────────────────────────

describe("isSoloWin", () => {
  it("returns true for exactly 1 team", () => {
    expect(isSoloWin(["team-a"])).toBe(true)
  })
  it("returns false for 0 teams", () => {
    expect(isSoloWin([])).toBe(false)
  })
  it("returns false for 2 teams", () => {
    expect(isSoloWin(["team-a", "team-b"])).toBe(false)
  })
})

// ─── getNextBidder ────────────────────────────────────────────────────────────

describe("getNextBidder", () => {
  const order = ["A", "B", "C", "D"]

  it("returns the first eligible team from startIndex", () => {
    const eligible = new Set(["B", "C", "D"])
    expect(getNextBidder(order, 1, eligible)?.teamId).toBe("B")
  })
  it("skips ineligible teams", () => {
    const eligible = new Set(["C"])
    expect(getNextBidder(order, 0, eligible)?.teamId).toBe("C")
  })
  it("wraps around the end of the array", () => {
    const eligible = new Set(["A"])
    expect(getNextBidder(order, 2, eligible)?.teamId).toBe("A")
  })
  it("returns null when no eligible teams", () => {
    expect(getNextBidder(order, 0, new Set())).toBeNull()
  })
  it("returns the team at startIndex if it is eligible", () => {
    const eligible = new Set(["A", "B"])
    expect(getNextBidder(order, 0, eligible)?.teamId).toBe("A")
  })
})

// ─── getNextBidStartIndex ─────────────────────────────────────────────────────

describe("getNextBidStartIndex", () => {
  const order = ["A", "B", "C", "D"]

  it("advances to the next team with open slots", () => {
    const open = new Set(["B", "C"])
    expect(getNextBidStartIndex(order, 0, open)).toBe(1) // B is at index 1
  })
  it("wraps around correctly", () => {
    const open = new Set(["A"])
    expect(getNextBidStartIndex(order, 3, open)).toBe(0) // wraps to A at index 0
  })
  it("returns currentIndex when all teams are full", () => {
    expect(getNextBidStartIndex(order, 2, new Set())).toBe(2)
  })
  it("skips the current team and finds the next one", () => {
    const open = new Set(["C", "D"])
    expect(getNextBidStartIndex(order, 1, open)).toBe(2) // skips B, finds C
  })
})

// ─── chooseSlotType ───────────────────────────────────────────────────────────

const makeEntry = (slot_type: "starting" | "bench", position: Position) => ({ slot_type, position })

describe("chooseSlotType", () => {
  it("returns starting for an empty roster", () => {
    expect(chooseSlotType("MID", [])).toBe("starting")
  })

  it("returns bench when starting XI is full (11 starters)", () => {
    const roster = [
      makeEntry("starting", "GK"),
      ...Array(4).fill(makeEntry("starting", "DEF")),
      ...Array(4).fill(makeEntry("starting", "MID")),
      ...Array(2).fill(makeEntry("starting", "FWD")),
    ]
    expect(roster.filter(r => r.slot_type === "starting").length).toBe(11)
    expect(chooseSlotType("MID", roster)).toBe("bench")
  })

  it("returns bench for a second GK (max 1 GK in starting)", () => {
    const roster = [makeEntry("starting", "GK")]
    expect(chooseSlotType("GK", roster)).toBe("bench")
  })

  it("returns starting when position has room and XI is not full", () => {
    const roster = [
      makeEntry("starting", "GK"),
      ...Array(3).fill(makeEntry("starting", "DEF")),
      ...Array(3).fill(makeEntry("starting", "MID")),
    ]
    expect(chooseSlotType("FWD", roster)).toBe("starting")
  })

  it("returns starting for the 10th player when position has room", () => {
    const roster = [
      makeEntry("starting", "GK"),
      ...Array(4).fill(makeEntry("starting", "DEF")),
      ...Array(4).fill(makeEntry("starting", "MID")),
    ]
    expect(chooseSlotType("FWD", roster)).toBe("starting")
  })
})

// ─── validateFormation ────────────────────────────────────────────────────────

const makePos = (position: Position) => ({ position })

describe("validateFormation", () => {
  it("accepts a valid 4-4-2", () => {
    const xi = [
      makePos("GK"),
      ...Array(4).fill(makePos("DEF")),
      ...Array(4).fill(makePos("MID")),
      ...Array(2).fill(makePos("FWD")),
    ]
    expect(validateFormation(xi)).toBeNull()
  })
  it("accepts a valid 3-5-2", () => {
    const xi = [
      makePos("GK"),
      ...Array(3).fill(makePos("DEF")),
      ...Array(5).fill(makePos("MID")),
      ...Array(2).fill(makePos("FWD")),
    ]
    expect(validateFormation(xi)).toBeNull()
  })
  it("accepts a valid 4-3-3", () => {
    const xi = [
      makePos("GK"),
      ...Array(4).fill(makePos("DEF")),
      ...Array(3).fill(makePos("MID")),
      ...Array(3).fill(makePos("FWD")),
    ]
    expect(validateFormation(xi)).toBeNull()
  })
  it("rejects fewer than 11 players", () => {
    const xi = Array(10).fill(makePos("MID"))
    expect(validateFormation(xi)).not.toBeNull()
  })
  it("rejects more than 11 players", () => {
    const xi = Array(12).fill(makePos("MID"))
    expect(validateFormation(xi)).not.toBeNull()
  })
  it("rejects 0 GKs", () => {
    const xi = [
      ...Array(4).fill(makePos("DEF")),
      ...Array(4).fill(makePos("MID")),
      ...Array(3).fill(makePos("FWD")),
    ]
    expect(validateFormation(xi)).toMatch(/GK/)
  })
  it("rejects fewer than 3 DEF", () => {
    const xi = [
      makePos("GK"),
      ...Array(2).fill(makePos("DEF")),
      ...Array(5).fill(makePos("MID")),
      ...Array(3).fill(makePos("FWD")),
    ]
    expect(validateFormation(xi)).toMatch(/DEF/)
  })
  it("rejects 0 FWD", () => {
    const xi = [
      makePos("GK"),
      ...Array(4).fill(makePos("DEF")),
      ...Array(6).fill(makePos("MID")),
    ]
    expect(validateFormation(xi)).toMatch(/FWD/)
  })
})
