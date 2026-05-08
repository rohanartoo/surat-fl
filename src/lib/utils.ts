import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { BID_RULES, Position } from "@/types"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Format a number as £Xm or £X.Xm (e.g. £5m, £12.5m) */
export function formatMoney(amount: number): string {
  return Number.isInteger(amount) ? `£${amount}m` : `£${amount.toFixed(1)}m`
}

/**
 * Returns the minimum bid increment over the current highest bid.
 * +£1m when current bid < £20m, +£2m when current bid ≥ £20m.
 */
export function calcMinIncrement(currentBid: number): number {
  return currentBid >= BID_RULES.increment_threshold
    ? BID_RULES.increment_above
    : BID_RULES.increment_below
}

/**
 * Returns the minimum valid next bid amount.
 * For the very first bid on a player, returns the player's base_price.
 */
export function calcMinBid(currentBid: number | null, basePrice: number): number {
  if (currentBid === null) return basePrice
  return currentBid + calcMinIncrement(currentBid)
}

/**
 * Returns the maximum a team can bid for the current player,
 * ensuring they can still afford the minimum £1m for each remaining empty slot.
 * emptySlots = total empty slots INCLUDING the current one being bid on.
 */
export function calcMaxBid(budget: number, emptySlots: number): number {
  return budget - (emptySlots - 1)
}

/**
 * Returns the new base price for a dropped player.
 * ceil(purchasePrice * 0.5)
 */
export function calcDropPrice(purchasePrice: number): number {
  return Math.ceil(purchasePrice * 0.5)
}

/** Convert FPL element_type integer to Position string */
export function elementTypeToPosition(elementType: number): Position {
  const map: Record<number, Position> = { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" }
  return map[elementType] ?? "GK"
}

/** CSS color class for a position badge */
export function positionColor(position: string): string {
  const map: Record<string, string> = {
    GK:  "text-amber-500",
    DEF: "text-sky-500",
    MID: "text-emerald-500",
    FWD: "text-rose-500",
  }
  return map[position] ?? "text-muted-foreground"
}

/** Short label for a position (already a string, kept for compatibility) */
export function positionLabel(elementType: number): string {
  const map: Record<number, string> = { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" }
  return map[elementType] ?? "UNK"
}

/** Player status label */
export function statusLabel(status: string): string {
  const map: Record<string, string> = {
    a: "Available",
    d: "Doubtful",
    i: "Injured",
    s: "Suspended",
    u: "Unavailable",
  }
  return map[status] ?? status
}

/** Player status color */
export function statusColor(status: string): string {
  const map: Record<string, string> = {
    a: "text-emerald-500",
    d: "text-amber-500",
    i: "text-rose-500",
    s: "text-orange-500",
    u: "text-muted-foreground",
  }
  return map[status] ?? "text-muted-foreground"
}
