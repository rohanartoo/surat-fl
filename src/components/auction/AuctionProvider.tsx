"use client"

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react"
import { createClient } from "@/lib/supabase/client"
import type {
  Auction,
  AuctionLot,
  AuctionLogEntry,
  Bid,
  LeagueTeam,
  Player,
  Position,
  Role,
} from "@/types"

// =============================================
// TYPES
// =============================================

export interface AuctionContextValue {
  auction: Auction | null
  currentLot: (AuctionLot & { player: Player }) | null
  lastConcludedLot: (AuctionLot & { player: Player }) | null
  bids: Bid[]
  log: AuctionLogEntry[]
  teams: LeagueTeam[]
  availablePlayers: Player[]
  filledSlotsByTeam: Record<string, Record<Position, number>>
  myClubCounts: Record<string, number>
  myTeamId: string | null
  myRole: Role
  isLoading: boolean
  refresh: () => Promise<void>
}

const AuctionContext = createContext<AuctionContextValue | null>(null)

export function useAuction() {
  const ctx = useContext(AuctionContext)
  if (!ctx) throw new Error("useAuction must be used inside <AuctionProvider>")
  return ctx
}

// =============================================
// PROVIDER
// =============================================

interface AuctionProviderProps {
  children: ReactNode
  initialAuction: Auction | null
  initialLot: (AuctionLot & { player: Player }) | null
  initialLastConcludedLot: (AuctionLot & { player: Player }) | null
  initialBids: Bid[]
  initialLog: AuctionLogEntry[]
  initialTeams: LeagueTeam[]
  initialAvailablePlayers: Player[]
  initialFilledSlotsByTeam: Record<string, Record<Position, number>>
  myTeamId: string | null
  myRole: Role
}

export function AuctionProvider({
  children,
  initialAuction,
  initialLot,
  initialLastConcludedLot,
  initialBids,
  initialLog,
  initialTeams,
  initialAvailablePlayers,
  initialFilledSlotsByTeam,
  myTeamId,
  myRole,
}: AuctionProviderProps) {
  const supabase = createClient()

  const [auction, setAuction] = useState<Auction | null>(initialAuction)
  const [currentLot, setCurrentLot] = useState<(AuctionLot & { player: Player }) | null>(initialLot)
  const [lastConcludedLot, setLastConcludedLot] = useState<(AuctionLot & { player: Player }) | null>(initialLastConcludedLot)
  const [bids, setBids] = useState<Bid[]>(initialBids)
  const [log, setLog] = useState<AuctionLogEntry[]>(initialLog)
  const [teams, setTeams] = useState<LeagueTeam[]>(initialTeams)
  const [availablePlayers, setAvailablePlayers] = useState<Player[]>(initialAvailablePlayers)
  const [filledSlotsByTeam, setFilledSlotsByTeam] = useState<Record<string, Record<Position, number>>>(initialFilledSlotsByTeam)
  const [myClubCounts, setMyClubCounts] = useState<Record<string, number>>({})
  const [isLoading, setIsLoading] = useState(false)

  // ── Full refresh from DB ──────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    setIsLoading(true)
    try {
      const [
        { data: auctionData },
        { data: teamsData },
        { data: draftedRows },
        { data: rosterRows },
      ] = await Promise.all([
        supabase.from("auctions").select("*").in("status", ["pending", "active"]).maybeSingle(),
        supabase.from("teams").select("*").order("auction_order"),
        supabase.from("roster_entries").select("player_id").in("slot_type", ["starting", "bench"]),
        supabase.from("roster_entries").select("team_id, player:players(position, fpl_team)").in("slot_type", ["starting", "bench"]),
      ])

      const freshTeams = (teamsData ?? []) as LeagueTeam[]
      setAuction(auctionData ?? null)
      setTeams(freshTeams)

      // Recompute filled slots per team per position, and club counts for my team
      const filled: Record<string, Record<Position, number>> = {}
      for (const t of freshTeams) filled[t.id] = { GK: 0, DEF: 0, MID: 0, FWD: 0 }
      const clubCounts: Record<string, number> = {}
      for (const row of rosterRows ?? []) {
        const p = (row.player as unknown as { position: Position; fpl_team: string } | null)
        if (p?.position && filled[row.team_id]) filled[row.team_id][p.position]++
        if (row.team_id === myTeamId && p?.fpl_team) {
          clubCounts[p.fpl_team] = (clubCounts[p.fpl_team] ?? 0) + 1
        }
      }
      setFilledSlotsByTeam(filled)
      setMyClubCounts(clubCounts)

      // Rebuild available player pool
      const draftedIds = (draftedRows ?? []).map(r => r.player_id) as number[]
      const currentPos = (auctionData?.current_position_category ?? null) as Position | null

      let playersQuery = supabase.from("players").select("*").order("total_points", { ascending: false })
      if (draftedIds.length > 0) {
        playersQuery = playersQuery.not("id", "in", `(${draftedIds.join(",")})`)
      }
      if (currentPos) {
        playersQuery = playersQuery.eq("position", currentPos)
      }
      const { data: playersData } = await playersQuery
      setAvailablePlayers((playersData ?? []) as Player[])

      if (auctionData) {
        const [{ data: lotData }, { data: logData }] = await Promise.all([
          supabase
            .from("auction_lots")
            .select("*, player:players(*)")
            .eq("auction_id", auctionData.id)
            .in("phase", ["interest", "bidding"])
            .maybeSingle(),
          supabase
            .from("auction_log")
            .select("*")
            .eq("auction_id", auctionData.id)
            .order("created_at", { ascending: false })
            .limit(50),
        ])

        const activeLot = lotData as (AuctionLot & { player: Player }) | null
        setCurrentLot(activeLot)
        setLog((logData ?? []) as AuctionLogEntry[])

        if (activeLot) {
          const { data: bidsData } = await supabase
            .from("bids").select("*, team:teams(*)").eq("lot_id", activeLot.id)
          setBids((bidsData ?? []) as Bid[])
          // Clear last concluded lot while a new lot is active
          setLastConcludedLot(null)
        } else {
          setBids([])
          // No active lot — fetch the most recently concluded one for the result panel
          const { data: lastLot } = await supabase
            .from("auction_lots")
            .select("*, player:players(*)")
            .eq("auction_id", auctionData.id)
            .eq("phase", "concluded")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle()
          setLastConcludedLot(lastLot as (AuctionLot & { player: Player }) | null)
        }
      } else {
        setCurrentLot(null)
        setBids([])
        setLastConcludedLot(null)
      }
    } finally {
      setIsLoading(false)
    }
  }, [supabase])

  // ── Realtime subscriptions ────────────────────────────────────────────────

  useEffect(() => {
    const lotsChannel = supabase
      .channel("auction-lots")
      .on("postgres_changes", { event: "*", schema: "public", table: "auction_lots" }, () => refresh())
      .subscribe()

    const bidsChannel = supabase
      .channel("auction-bids")
      .on("postgres_changes", { event: "*", schema: "public", table: "bids" }, () => refresh())
      .subscribe()

    const logChannel = supabase
      .channel("auction-log")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "auction_log" },
        (payload) => {
          setLog(prev => [payload.new as AuctionLogEntry, ...prev].slice(0, 50))
        }
      )
      .subscribe()

    const teamsChannel = supabase
      .channel("auction-teams")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "teams" },
        (payload) => {
          setTeams(prev => prev.map(t => t.id === payload.new.id ? payload.new as LeagueTeam : t))
        }
      )
      .subscribe()

    const auctionsChannel = supabase
      .channel("auction-status")
      .on("postgres_changes", { event: "*", schema: "public", table: "auctions" }, () => refresh())
      .subscribe()

    const rosterChannel = supabase
      .channel("auction-roster")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "roster_entries" }, () => refresh())
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "roster_entries" }, () => refresh())
      .subscribe()

    return () => {
      supabase.removeChannel(lotsChannel)
      supabase.removeChannel(bidsChannel)
      supabase.removeChannel(logChannel)
      supabase.removeChannel(teamsChannel)
      supabase.removeChannel(auctionsChannel)
      supabase.removeChannel(rosterChannel)
    }
  }, [supabase, refresh])

  return (
    <AuctionContext.Provider
      value={{ auction, currentLot, lastConcludedLot, bids, log, teams, availablePlayers, filledSlotsByTeam, myClubCounts, myTeamId, myRole, isLoading, refresh }}
    >
      {children}
    </AuctionContext.Provider>
  )
}
