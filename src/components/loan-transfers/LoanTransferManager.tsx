"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PositionBadge } from "@/components/ui/PositionBadge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import type { LeagueTeam, Player, Position, RosterEntry } from "@/types"

type Entry = RosterEntry & { player: Player }

const POSITION_ORDER: Record<Position, number> = { GK: 0, DEF: 1, MID: 2, FWD: 3 }
const byPosition = (a: Entry, b: Entry) => POSITION_ORDER[a.player.position] - POSITION_ORDER[b.player.position]

interface HistoryRow {
  id: string
  cash_amount: number
  created_at: string
  team_a: { display_name: string } | null
  team_b: { display_name: string } | null
  cash_team: { display_name: string } | null
  player_a: { web_name: string } | null
  player_b: { web_name: string } | null
}

function RosterColumn({
  label,
  teams,
  teamId,
  onTeamChange,
  otherTeamId,
  roster,
  loading,
  selectedEntryId,
  onSelectEntry,
  cashAmount,
  onCashChange,
  team,
}: {
  label: string
  teams: LeagueTeam[]
  teamId: string | null
  onTeamChange: (id: string) => void
  otherTeamId: string | null
  roster: Entry[]
  loading: boolean
  selectedEntryId: string | null
  onSelectEntry: (id: string) => void
  cashAmount: number
  onCashChange: (n: number) => void
  team: LeagueTeam | null
}) {
  const sorted = [...roster].sort(byPosition)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Select value={teamId ?? undefined} onValueChange={onTeamChange}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a team..." />
          </SelectTrigger>
          <SelectContent>
            {teams.filter(t => t.id !== otherTeamId).map(t => (
              <SelectItem key={t.id} value={t.id}>{t.display_name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {teamId && (
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {loading && <p className="text-sm text-muted-foreground px-2 py-4">Loading roster...</p>}
            {!loading && sorted.map(entry => (
              <button
                key={entry.id}
                type="button"
                onClick={() => onSelectEntry(entry.id)}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left transition-colors",
                  selectedEntryId === entry.id ? "bg-primary/15 ring-1 ring-primary" : "hover:bg-secondary"
                )}
              >
                <PositionBadge position={entry.player.position} />
                <span className="flex-1 truncate">{entry.player.web_name}</span>
                <span className="text-xs text-muted-foreground shrink-0">£{entry.base_price}m</span>
                {entry.slot_type === "bench" && (
                  <span className="text-[10px] text-muted-foreground shrink-0">BENCH</span>
                )}
              </button>
            ))}
          </div>
        )}

        {teamId && (
          <div className="pt-2 border-t border-border/60">
            <label className="text-xs text-muted-foreground block mb-1">
              Cash offered {team && <span>(budget £{team.budget}m)</span>}
            </label>
            <Input
              type="number"
              min={0}
              max={team?.budget ?? 0}
              value={cashAmount}
              onChange={e => {
                const n = Number(e.target.value)
                if (!Number.isFinite(n)) return
                onCashChange(Math.max(0, Math.min(n, team?.budget ?? 0)))
              }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function LoanTransferManager() {
  const supabase = createClient()

  const [teams, setTeams] = useState<LeagueTeam[]>([])
  const [teamAId, setTeamAId] = useState<string | null>(null)
  const [teamBId, setTeamBId] = useState<string | null>(null)
  const [rosterA, setRosterA] = useState<Entry[]>([])
  const [rosterB, setRosterB] = useState<Entry[]>([])
  const [loadingA, setLoadingA] = useState(false)
  const [loadingB, setLoadingB] = useState(false)
  const [entryAId, setEntryAId] = useState<string | null>(null)
  const [entryBId, setEntryBId] = useState<string | null>(null)
  const [cashA, setCashA] = useState(0)
  const [cashB, setCashB] = useState(0)
  const [pendingConfirm, setPendingConfirm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryRow[]>([])

  const fetchRoster = useCallback(async (teamId: string, setRoster: (e: Entry[]) => void, setLoading: (b: boolean) => void) => {
    setLoading(true)
    const { data } = await supabase
      .from("roster_entries")
      .select("*, player:players(*)")
      .eq("team_id", teamId)
      .in("slot_type", ["starting", "bench"])
    setRoster((data ?? []) as unknown as Entry[])
    setLoading(false)
  }, [supabase])

  const fetchHistory = useCallback(async () => {
    const { data } = await supabase
      .from("loan_transfers")
      .select(`
        id, cash_amount, created_at,
        team_a:teams!loan_transfers_team_a_id_fkey(display_name),
        team_b:teams!loan_transfers_team_b_id_fkey(display_name),
        cash_team:teams!loan_transfers_cash_team_id_fkey(display_name),
        player_a:players!loan_transfers_player_a_id_fkey(web_name),
        player_b:players!loan_transfers_player_b_id_fkey(web_name)
      `)
      .order("created_at", { ascending: false })
      .limit(20)
    setHistory((data ?? []) as unknown as HistoryRow[])
  }, [supabase])

  useEffect(() => {
    async function loadInitial() {
      const [{ data: teamsData }] = await Promise.all([
        supabase.from("teams").select("*").order("display_name"),
        fetchHistory(),
      ])
      setTeams((teamsData ?? []) as LeagueTeam[])
    }
    loadInitial()
  }, [supabase, fetchHistory])

  useEffect(() => {
    if (!teamAId) return
    fetchRoster(teamAId, setRosterA, setLoadingA)
  }, [teamAId, fetchRoster])

  useEffect(() => {
    if (!teamBId) return
    fetchRoster(teamBId, setRosterB, setLoadingB)
  }, [teamBId, fetchRoster])

  const teamA = teams.find(t => t.id === teamAId) ?? null
  const teamB = teams.find(t => t.id === teamBId) ?? null
  const entryA = rosterA.find(e => e.id === entryAId) ?? null
  const entryB = rosterB.find(e => e.id === entryBId) ?? null

  const positionMismatch = !!entryA && !!entryB && entryA.player.position !== entryB.player.position
  const canPropose = !!teamAId && !!teamBId && teamAId !== teamBId && !!entryA && !!entryB && !positionMismatch

  function resetSelection() {
    setEntryAId(null)
    setEntryBId(null)
    setCashA(0)
    setCashB(0)
    setPendingConfirm(false)
  }

  async function handleConfirm() {
    if (!teamAId || !teamBId || !entryA || !entryB) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch("/api/loan-transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entry_a_id: entryA.id,
          team_a_id: teamAId,
          entry_b_id: entryB.id,
          team_b_id: teamBId,
          cash_team_id: cashA > 0 ? teamAId : cashB > 0 ? teamBId : null,
          cash_amount: cashA > 0 ? cashA : cashB,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Trade failed.")

      resetSelection()
      const [{ data: teamsData }] = await Promise.all([
        supabase.from("teams").select("*").order("display_name"),
        fetchRoster(teamAId, setRosterA, setLoadingA),
        fetchRoster(teamBId, setRosterB, setLoadingB),
        fetchHistory(),
      ])
      if (teamsData) setTeams(teamsData as LeagueTeam[])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Trade failed.")
      setPendingConfirm(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <RosterColumn
          label="Team A"
          teams={teams}
          teamId={teamAId}
          onTeamChange={id => { setTeamAId(id); resetSelection() }}
          otherTeamId={teamBId}
          roster={rosterA}
          loading={loadingA}
          selectedEntryId={entryAId}
          onSelectEntry={id => { setEntryAId(prev => prev === id ? null : id); setPendingConfirm(false) }}
          cashAmount={cashA}
          onCashChange={n => { setCashA(n); if (n > 0) setCashB(0); setPendingConfirm(false) }}
          team={teamA}
        />
        <RosterColumn
          label="Team B"
          teams={teams}
          teamId={teamBId}
          onTeamChange={id => { setTeamBId(id); resetSelection() }}
          otherTeamId={teamAId}
          roster={rosterB}
          loading={loadingB}
          selectedEntryId={entryBId}
          onSelectEntry={id => { setEntryBId(prev => prev === id ? null : id); setPendingConfirm(false) }}
          cashAmount={cashB}
          onCashChange={n => { setCashB(n); if (n > 0) setCashA(0); setPendingConfirm(false) }}
          team={teamB}
        />
      </div>

      {positionMismatch && (
        <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">
          Players must be the same position — {entryA?.player.position} vs {entryB?.player.position}.
        </p>
      )}

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">{error}</p>
      )}

      {canPropose && !pendingConfirm && (
        <Button onClick={() => setPendingConfirm(true)}>Propose Trade</Button>
      )}

      {canPropose && pendingConfirm && entryA && entryB && teamA && teamB && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Confirm Trade</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">
              <strong>{teamA.display_name}</strong> sends <strong>{entryA.player.web_name}</strong>
              {cashA > 0 && <> + £{cashA}m</>} to <strong>{teamB.display_name}</strong>
            </p>
            <p className="text-sm">
              <strong>{teamB.display_name}</strong> sends <strong>{entryB.player.web_name}</strong>
              {cashB > 0 && <> + £{cashB}m</>} to <strong>{teamA.display_name}</strong>
            </p>
            <div className="flex gap-2 pt-2">
              <Button onClick={handleConfirm} disabled={submitting}>
                {submitting ? "Confirming..." : "Confirm"}
              </Button>
              <Button variant="outline" onClick={() => setPendingConfirm(false)} disabled={submitting}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Recent Trades</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 && <p className="text-sm text-muted-foreground">No trades yet.</p>}
          <ul className="space-y-2">
            {history.map(h => (
              <li key={h.id} className="text-sm text-muted-foreground">
                <strong className="text-foreground">{h.team_a?.display_name}</strong> traded <strong className="text-foreground">{h.player_a?.web_name}</strong> for <strong className="text-foreground">{h.player_b?.web_name}</strong> from <strong className="text-foreground">{h.team_b?.display_name}</strong>
                {h.cash_amount > 0 && h.cash_team && <> ({h.cash_team.display_name} paid £{h.cash_amount}m)</>}
                <span className="text-xs"> — {new Date(h.created_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
