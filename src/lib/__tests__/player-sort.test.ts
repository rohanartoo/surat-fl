import { describe, it, expect } from "vitest"
import { sortPlayers } from "@/lib/player-sort"
import type { Player } from "@/types"

function p(id: number, tsb: number, points: number, price: number): Player {
  return { id, selected_by_percent: tsb, total_points: points, base_price: price } as Player
}

describe("sortPlayers", () => {
  const players = () => [p(1, 40, 10, 5), p(2, 30, 50, 5), p(3, 20, 50, 9)]

  it("keeps the given (selected-by %) order for tsb", () => {
    expect(sortPlayers(players(), "tsb").map(x => x.id)).toEqual([1, 2, 3])
  })

  it("sorts by points descending, breaking ties on selected-by %", () => {
    expect(sortPlayers(players(), "points").map(x => x.id)).toEqual([2, 3, 1])
  })

  it("sorts by price descending, breaking ties on selected-by %", () => {
    expect(sortPlayers(players(), "price").map(x => x.id)).toEqual([3, 1, 2])
  })
})
