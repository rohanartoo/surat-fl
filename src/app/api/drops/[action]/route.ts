import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { requireRole, getProfile } from "@/lib/roles"
import { getDropQuota } from "@/lib/drops"
import type { AuctionType } from "@/types"

function createClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

type Params = { params: Promise<{ action: string }> }

function err(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(request: NextRequest, { params }: Params) {
  const { action } = await params
  try {
    switch (action) {
      case "quota":         return handleQuota(request)
      case "staged-counts": return handleStagedCounts(request)
      default:              return err(`Unknown action: ${action}`, 404)
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error."
    if (message.startsWith("Requires role:")) return err(message, 403)
    console.error(`[drops/${action}]`, e)
    return err("Internal server error.", 500)
  }
}

// ─────────────────────────────────────────────
// STAGED-COUNTS — staged drop counts per team for an auction (AM view)
// Body: { auction_id: string }
// ─────────────────────────────────────────────
async function handleStagedCounts(request: NextRequest) {
  await requireRole("auction_master")
  const supabase = createClient()
  const { auction_id } = await request.json()
  if (!auction_id) return err("auction_id required.")

  const { data: drops } = await supabase
    .from("team_drops")
    .select("team_id")
    .eq("auction_id", auction_id)
    .eq("status", "staged")

  const counts: Record<string, number> = {}
  for (const d of drops ?? []) {
    counts[d.team_id] = (counts[d.team_id] ?? 0) + 1
  }

  return NextResponse.json({ counts })
}

// ─────────────────────────────────────────────
// QUOTA — compute drop quota for a team in an auction
// Body: { team_id?: string, auction_id: string }
// If team_id is omitted, uses the caller's own team_id.
// ─────────────────────────────────────────────
async function handleQuota(request: NextRequest) {
  await requireRole("team")
  const supabase = createClient()
  const profile = await getProfile()
  const { team_id, auction_id } = await request.json()

  if (!auction_id) return err("auction_id required.")

  // Admins can query any team; team accounts can only query their own
  const targetTeamId = (profile?.role === "admin" && team_id) ? team_id : profile?.team_id
  if (!targetTeamId) return err("Not a team account.", 403)

  const { data: auction } = await supabase
    .from("auctions").select("type").eq("id", auction_id).single()
  if (!auction) return err("Auction not found.", 404)

  const quota = await getDropQuota(targetTeamId, auction_id, auction.type as AuctionType, supabase)
  return NextResponse.json(quota)
}
