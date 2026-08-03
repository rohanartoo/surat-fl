import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { requireRole, getProfile } from "@/lib/roles"
import { chooseSlotType } from "@/lib/auction-engine"
import { repairTeamCaptaincy } from "@/lib/roster"
import { SQUAD_RULES } from "@/types"
import type { Position } from "@/types"

function createClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function err(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

type RosterRow = { slot_type: string; bench_order: number | null; player: { position: Position } | { position: Position }[] }

function positionOf(row: { player: { position: Position } | { position: Position }[] }): Position {
  return (Array.isArray(row.player) ? row.player[0] : row.player).position
}

/** Computes slot_type/bench_order for a player joining a team, reusing the
 * same chooseSlotType + next-free-bench-order logic as handleReturnFromDrop
 * (src/app/api/team/[action]/route.ts). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function placeIncomingPlayer(supabase: any, teamId: string, position: Position) {
  const { data: activeEntries } = await supabase
    .from("roster_entries")
    .select("slot_type, bench_order, player:players(position)")
    .eq("team_id", teamId)
    .in("slot_type", ["starting", "bench"])

  const rows = (activeEntries ?? []) as RosterRow[]
  const activeRoster = rows.map(r => ({ slot_type: r.slot_type, position: positionOf(r) }))

  let targetSlot = chooseSlotType(position, activeRoster)
  let benchOrder: number | null = null

  if (targetSlot === "bench") {
    const usedOrders = new Set(rows.filter(r => r.slot_type === "bench").map(r => r.bench_order))
    const nextOrder = [1, 2, 3, 4].find(n => !usedOrders.has(n)) ?? null
    const startingCount = activeRoster.filter(r => r.slot_type === "starting").length
    if (nextOrder === null && startingCount < SQUAD_RULES.starting) {
      targetSlot = "starting"
    } else {
      benchOrder = nextOrder
    }
  }

  return { slot_type: targetSlot, bench_order: targetSlot === "bench" ? benchOrder : null }
}

// ─────────────────────────────────────────────
// POST — execute a same-position 1-for-1 loan transfer between two teams,
// with optional one-directional cash. AM/admin only.
// Body: { entry_a_id, team_a_id, entry_b_id, team_b_id, cash_team_id?, cash_amount? }
// ─────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    await requireRole("auction_master")
    const supabase = createClient()
    const { entry_a_id, team_a_id, entry_b_id, team_b_id, cash_team_id, cash_amount } = await request.json()

    if (!entry_a_id || !team_a_id || !entry_b_id || !team_b_id) {
      return err("entry_a_id, team_a_id, entry_b_id and team_b_id are required.")
    }
    if (team_a_id === team_b_id) return err("Cannot trade between a team and itself.")

    const cashAmount = Number(cash_amount ?? 0)
    if (!Number.isFinite(cashAmount) || cashAmount < 0) return err("cash_amount must be a non-negative number.")
    if (cashAmount > 0 && cash_team_id !== team_a_id && cash_team_id !== team_b_id) {
      return err("cash_team_id must be one of the two trading teams.")
    }

    const { data: entryA } = await supabase
      .from("roster_entries")
      .select("id, team_id, slot_type, player:players(position)")
      .eq("id", entry_a_id).single()
    if (!entryA) return err("Player A roster entry not found.", 404)
    if (entryA.team_id !== team_a_id) return err("Player A does not belong to team_a_id.")
    if (!["starting", "bench"].includes(entryA.slot_type)) return err("Player A is not currently on the active roster.")

    const { data: entryB } = await supabase
      .from("roster_entries")
      .select("id, team_id, slot_type, player:players(position)")
      .eq("id", entry_b_id).single()
    if (!entryB) return err("Player B roster entry not found.", 404)
    if (entryB.team_id !== team_b_id) return err("Player B does not belong to team_b_id.")
    if (!["starting", "bench"].includes(entryB.slot_type)) return err("Player B is not currently on the active roster.")

    const positionA = positionOf(entryA)
    const positionB = positionOf(entryB)
    if (positionA !== positionB) return err(`Players must be the same position (${positionA} vs ${positionB}).`)

    if (cashAmount > 0) {
      const { data: payingTeam } = await supabase.from("teams").select("budget").eq("id", cash_team_id).single()
      if (!payingTeam) return err("Paying team not found.", 404)
      if (cashAmount > payingTeam.budget) return err(`Cash amount exceeds the paying team's budget of £${payingTeam.budget}m.`)
    }

    // entry A moves to team B, entry B moves to team A
    const placementForA = await placeIncomingPlayer(supabase, team_b_id, positionA)
    const placementForB = await placeIncomingPlayer(supabase, team_a_id, positionB)

    const profile = await getProfile()

    const { data: loanTransferId, error: rpcErr } = await supabase.rpc("rpc_execute_loan_transfer", {
      p_entry_a_id: entry_a_id,
      p_team_b_id: team_b_id,
      p_slot_type_a: placementForA.slot_type,
      p_bench_order_a: placementForA.bench_order,
      p_entry_b_id: entry_b_id,
      p_team_a_id: team_a_id,
      p_slot_type_b: placementForB.slot_type,
      p_bench_order_b: placementForB.bench_order,
      p_cash_team_id: cashAmount > 0 ? cash_team_id : null,
      p_cash_amount: cashAmount,
      p_performed_by: profile?.id ?? null,
    })
    if (rpcErr) return err(rpcErr.message)

    const [teamACaptaincy, teamBCaptaincy] = await Promise.all([
      repairTeamCaptaincy(supabase, team_a_id),
      repairTeamCaptaincy(supabase, team_b_id),
    ])

    return NextResponse.json({
      success: true,
      loan_transfer_id: loanTransferId,
      team_a_captaincy: teamACaptaincy,
      team_b_captaincy: teamBCaptaincy,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error."
    if (message.startsWith("Requires role:")) return err(message, 403)
    console.error("[loan-transfers]", e)
    return err("Internal server error.", 500)
  }
}
