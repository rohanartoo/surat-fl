import { createHash, timingSafeEqual } from "crypto"

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest()
}

// Hashing to a fixed-length digest before comparing means both the
// equal-length and mismatched-length cases cost the same, so no
// information about the secret (not even its length) leaks via timing.
export function safeCompare(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b))
}

export function verifySyncSecret(authHeader: string | null): boolean {
  return safeCompare(authHeader ?? "", `Bearer ${process.env.SYNC_SECRET}`)
}
