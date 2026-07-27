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
  validateFormationCaps,
  repairCaptaincy,
} from "@/lib/auction-engine"
import type { CaptaincyEntry } from "@/lib/auction-engine"
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

  it("reserves a starting slot for FWD instead of filling all 11 with GK/DEF/MID", () => {
    // 1 GK + 5 DEF + 4 MID = 10 starters, all positions at/under their own
    // max — greedily this MID would start (making it 11 with 0 FWD), but a
    // FWD hasn't been drafted yet and needs at least 1 starting slot.
    const roster = [
      makeEntry("starting", "GK"),
      ...Array(5).fill(makeEntry("starting", "DEF")),
      ...Array(4).fill(makeEntry("starting", "MID")),
    ]
    expect(chooseSlotType("MID", roster)).toBe("bench")
  })

  it("still starts a FWD once one has finally been drafted, even at 10 starters", () => {
    const roster = [
      makeEntry("starting", "GK"),
      ...Array(5).fill(makeEntry("starting", "DEF")),
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
    // 1 GK + 5 DEF + 5 MID = 11, but 0 FWD violates min
    const xi = [
      makePos("GK"),
      ...Array(5).fill(makePos("DEF")),
      ...Array(5).fill(makePos("MID")),
    ]
    expect(validateFormation(xi)).toMatch(/FWD/)
  })
  it("rejects 2 GKs in starting XI", () => {
    const xi = [
      makePos("GK"),
      makePos("GK"),
      ...Array(3).fill(makePos("DEF")),
      ...Array(3).fill(makePos("MID")),
      ...Array(3).fill(makePos("FWD")),
    ]
    expect(validateFormation(xi)).toMatch(/GK/)
  })
})

// ─── validateFormationCaps ──────────────────────────────────────────────────

describe("validateFormationCaps", () => {
  it("accepts an incomplete Starting XI (below 11)", () => {
    const xi = [
      makePos("GK"),
      ...Array(3).fill(makePos("DEF")),
      ...Array(3).fill(makePos("MID")),
    ]
    expect(validateFormationCaps(xi)).toBeNull()
  })
  it("accepts an under-minimum Starting XI (0 FWD) as long as no cap is exceeded", () => {
    const xi = [
      makePos("GK"),
      ...Array(5).fill(makePos("DEF")),
      ...Array(5).fill(makePos("MID")),
    ]
    expect(validateFormationCaps(xi)).toBeNull()
  })
  it("rejects more than 11 players", () => {
    const xi = Array(12).fill(makePos("MID"))
    expect(validateFormationCaps(xi)).not.toBeNull()
  })
  it("rejects a 2nd GK", () => {
    const xi = [
      makePos("GK"),
      makePos("GK"),
      ...Array(3).fill(makePos("DEF")),
      ...Array(3).fill(makePos("MID")),
    ]
    expect(validateFormationCaps(xi)).toMatch(/GK/)
  })
  it("rejects exceeding max DEF", () => {
    const xi = [
      makePos("GK"),
      ...Array(6).fill(makePos("DEF")),
    ]
    expect(validateFormationCaps(xi)).toMatch(/DEF/)
  })
})

// ─── repairCaptaincy ─────────────────────────────────────────────────────────

const makeCaptaincy = (id: string, base_price: number, is_captain = false, is_vice_captain = false): CaptaincyEntry =>
  ({ id, base_price, is_captain, is_vice_captain })

describe("repairCaptaincy", () => {
  it("leaves a valid captain and VC unchanged", () => {
    const starting = [
      makeCaptaincy("a", 10, true, false),
      makeCaptaincy("b", 8, false, true),
      makeCaptaincy("c", 5),
    ]
    const result = repairCaptaincy(starting)
    expect(result).toEqual({ captainId: "a", viceCaptainId: "b", changed: false })
  })

  it("promotes the existing VC to captain and picks a new VC by price when captain is benched", () => {
    // Captain no longer appears in the Starting XI list at all (benched)
    const starting = [
      makeCaptaincy("b", 8, false, true),
      makeCaptaincy("c", 12),
      makeCaptaincy("d", 5),
    ]
    const result = repairCaptaincy(starting)
    // No is_captain=true present -> most expensive starter (c, 12) becomes captain
    expect(result.captainId).toBe("c")
    expect(result.changed).toBe(true)
    // VC must not be the new captain
    expect(result.viceCaptainId).not.toBe("c")
  })

  it("picks captain and VC by price (highest, 2nd-highest) when neither is set", () => {
    const starting = [
      makeCaptaincy("a", 5),
      makeCaptaincy("b", 15),
      makeCaptaincy("c", 10),
    ]
    const result = repairCaptaincy(starting)
    expect(result).toEqual({ captainId: "b", viceCaptainId: "c", changed: true })
  })

  it("re-picks VC by price when VC is benched but captain is still valid", () => {
    const starting = [
      makeCaptaincy("a", 10, true, false),
      makeCaptaincy("b", 8),
      makeCaptaincy("c", 12),
    ]
    const result = repairCaptaincy(starting)
    expect(result.captainId).toBe("a")
    expect(result.viceCaptainId).toBe("c") // most expensive remaining, excluding captain
    expect(result.changed).toBe(true)
  })

  it("returns nulls for an empty Starting XI", () => {
    expect(repairCaptaincy([])).toEqual({ captainId: null, viceCaptainId: null, changed: true })
  })
})
