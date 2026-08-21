import { describe, it, expect } from "vitest"
import { formatCountdown, COUNTDOWN_VISIBLE_WINDOW_MS } from "@/components/team/DeadlineBanner"

const HOUR = 60 * 60 * 1000
const MINUTE = 60 * 1000
const DAY = 24 * HOUR

describe("formatCountdown", () => {
  it("shows days, hours and minutes when more than a day remains", () => {
    expect(formatCountdown(2 * DAY + 3 * HOUR + 15 * MINUTE)).toBe("2d 3h 15m")
  })

  it("shows hours and minutes when under a day but at least an hour remains", () => {
    expect(formatCountdown(5 * HOUR + 42 * MINUTE)).toBe("5h 42m")
  })

  it("shows just minutes when under an hour remains", () => {
    expect(formatCountdown(9 * MINUTE)).toBe("9m")
  })

  it("shows 'now' once the deadline has passed", () => {
    expect(formatCountdown(0)).toBe("now")
    expect(formatCountdown(-5000)).toBe("now")
  })
})

describe("COUNTDOWN_VISIBLE_WINDOW_MS", () => {
  it("is exactly 6 hours", () => {
    expect(COUNTDOWN_VISIBLE_WINDOW_MS).toBe(6 * HOUR)
  })
})
