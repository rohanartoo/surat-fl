import { describe, it, expect } from "vitest"
import { computeLineupLock, DEADLINE_OFFSET_MINUTES } from "@/lib/lineup-lock"
import type { FixtureTiming } from "@/lib/lineup-lock"

const NOW = new Date("2026-08-24T12:00:00.000Z")

function minutesFromNow(mins: number): string {
  return new Date(NOW.getTime() + mins * 60 * 1000).toISOString()
}

describe("computeLineupLock", () => {
  it("is unlocked when there are no fixtures at all", () => {
    const state = computeLineupLock([], new Set(), NOW)
    expect(state.locked).toBe(false)
    expect(state.lockedGameweek).toBeNull()
    expect(state.nextDeadline).toBeNull()
  })

  it("ignores fixtures with a null event or null kickoff_time", () => {
    const fixtures: FixtureTiming[] = [
      { event: null, kickoff_time: minutesFromNow(-60) },
      { event: 1, kickoff_time: null },
    ]
    const state = computeLineupLock(fixtures, new Set(), NOW)
    expect(state.locked).toBe(false)
  })

  it("is unlocked before the deadline", () => {
    const fixtures: FixtureTiming[] = [{ event: 1, kickoff_time: minutesFromNow(DEADLINE_OFFSET_MINUTES + 1) }]
    const state = computeLineupLock(fixtures, new Set(), NOW)
    expect(state.locked).toBe(false)
    expect(state.nextDeadline).toBe(minutesFromNow(1))
    expect(state.nextDeadlineGameweek).toBe(1)
  })

  it("locks exactly at the deadline boundary", () => {
    const fixtures: FixtureTiming[] = [{ event: 1, kickoff_time: minutesFromNow(DEADLINE_OFFSET_MINUTES) }]
    const state = computeLineupLock(fixtures, new Set(), NOW)
    expect(state.locked).toBe(true)
    expect(state.lockedGameweek).toBe(1)
  })

  it("locks after the deadline when the gameweek is not finalized", () => {
    const fixtures: FixtureTiming[] = [{ event: 1, kickoff_time: minutesFromNow(-1) }]
    const state = computeLineupLock(fixtures, new Set(), NOW)
    expect(state.locked).toBe(true)
    expect(state.lockedGameweek).toBe(1)
  })

  it("unlocks a past-deadline gameweek once it's finalized", () => {
    const fixtures: FixtureTiming[] = [{ event: 1, kickoff_time: minutesFromNow(-1) }]
    const state = computeLineupLock(fixtures, new Set([1]), NOW)
    expect(state.locked).toBe(false)
    expect(state.lockedGameweek).toBeNull()
  })

  it("stays locked even when every fixture in the gameweek has kicked off/finished, until finalized", () => {
    // The key regression this whole feature exists to prevent: "all
    // fixtures finished" must NOT be treated as equivalent to "scored".
    const fixtures: FixtureTiming[] = [
      { event: 1, kickoff_time: minutesFromNow(-3 * 24 * 60) },
      { event: 1, kickoff_time: minutesFromNow(-2 * 24 * 60) },
    ]
    const state = computeLineupLock(fixtures, new Set(), NOW)
    expect(state.locked).toBe(true)
    expect(state.lockedGameweek).toBe(1)
  })

  it("uses the earliest kickoff across a double gameweek", () => {
    const fixtures: FixtureTiming[] = [
      { event: 1, kickoff_time: minutesFromNow(10) },
      { event: 1, kickoff_time: minutesFromNow(DEADLINE_OFFSET_MINUTES + 5) },
    ]
    // Earliest kickoff is +10min, so deadline is 10 - 30 = -20min: already past.
    const state = computeLineupLock(fixtures, new Set(), NOW)
    expect(state.locked).toBe(true)
    expect(state.lockedGameweek).toBe(1)
  })

  it("reports the smallest unfinalized past-deadline gameweek when several qualify", () => {
    const fixtures: FixtureTiming[] = [
      { event: 1, kickoff_time: minutesFromNow(-100) },
      { event: 2, kickoff_time: minutesFromNow(-50) },
    ]
    const state = computeLineupLock(fixtures, new Set(), NOW)
    expect(state.locked).toBe(true)
    expect(state.lockedGameweek).toBe(1)
  })

  it("skips a finalized past gameweek but still locks on a later unfinalized one", () => {
    const fixtures: FixtureTiming[] = [
      { event: 1, kickoff_time: minutesFromNow(-100) },
      { event: 2, kickoff_time: minutesFromNow(-50) },
    ]
    const state = computeLineupLock(fixtures, new Set([1]), NOW)
    expect(state.locked).toBe(true)
    expect(state.lockedGameweek).toBe(2)
  })

  it("reports the nearest future deadline when unlocked", () => {
    const fixtures: FixtureTiming[] = [
      { event: 1, kickoff_time: minutesFromNow(-100) },
      { event: 2, kickoff_time: minutesFromNow(500) },
      { event: 3, kickoff_time: minutesFromNow(200) },
    ]
    const state = computeLineupLock(fixtures, new Set([1]), NOW)
    expect(state.locked).toBe(false)
    expect(state.nextDeadlineGameweek).toBe(3)
    expect(state.nextDeadline).toBe(minutesFromNow(200 - DEADLINE_OFFSET_MINUTES))
  })
})
