import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/lib/roles"
import { AuctionProvider } from "@/components/auction/AuctionProvider"
import { AuctionMasterControls } from "@/components/auction/AuctionMasterControls"
import { CentralConsole } from "@/components/auction/CentralConsole"
import { TeamBidConsole, MyActionPanel } from "@/components/auction/TeamBidConsole"
import { PlayerSelectionPanel } from "@/components/auction/PlayerSelectionPanel"
import { AuctionLog } from "@/components/auction/AuctionLog"
import { BidResultPanel } from "@/components/auction/BidResultPanel"
import { Badge } from "@/components/ui/badge"
import { ChatPanel } from "@/components/chat/ChatPanel"
import type { ChatMessage } from "@/components/chat/ChatPanel"
import { cn } from "@/lib/utils"
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

async function getPageData() {
  const supabase = await createClient()
  const profile = await getProfile()

  const [
    { data: auctionData },
    { data: teamsData },
  ] = await Promise.all([
    supabase.from("auctions").select("*").in("status", ["pending", "active"]).maybeSingle(),
    supabase.from("teams").select("*").order("auction_order"),
  ])

  const auction = auctionData as Auction | null
  const teams = (teamsData ?? []) as LeagueTeam[]

  let currentLot: (AuctionLot & { player: Player }) | null = null
  let lastConcludedLot: (AuctionLot & { player: Player }) | null = null
  let bids: Bid[] = []
  let log: AuctionLogEntry[] = []

  if (auction) {
    const [lotResult, logResult] = await Promise.all([
      supabase
        .from("auction_lots")
        .select("*, player:players(*)")
        .eq("auction_id", auction.id)
        .in("phase", ["interest", "bidding"])
        .maybeSingle(),
      supabase
        .from("auction_log")
        .select("*")
        .eq("auction_id", auction.id)
        .order("created_at", { ascending: false })
        .limit(50),
    ])

    currentLot = lotResult.data as (AuctionLot & { player: Player }) | null
    log = (logResult.data ?? []) as AuctionLogEntry[]

    if (currentLot) {
      const { data: bidsData } = await supabase
        .from("bids").select("*, team:teams(*)").eq("lot_id", currentLot.id)
      bids = (bidsData ?? []) as Bid[]
    } else {
      // No active lot — fetch last concluded for the result panel
      const { data: lastLot } = await supabase
        .from("auction_lots")
        .select("*, player:players(*)")
        .eq("auction_id", auction.id)
        .eq("phase", "concluded")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      lastConcludedLot = lastLot as (AuctionLot & { player: Player }) | null
    }
  }

  // Player pool — always shown, filtered by current position if auction active
  const { data: draftedRows } = await supabase
    .from("roster_entries").select("player_id").in("slot_type", ["starting", "bench"])

  const draftedIds = (draftedRows ?? []).map(r => r.player_id) as number[]
  const currentPos = (auction?.current_position_category ?? null) as Position | null

  let playersQuery = supabase.from("players").select("*").order("total_points", { ascending: false })
  if (draftedIds.length > 0) {
    playersQuery = playersQuery.not("id", "in", `(${draftedIds.join(",")})`)
  }
  if (currentPos) {
    playersQuery = playersQuery.eq("position", currentPos)
  }
  const { data: playersData } = await playersQuery
  const availablePlayers = (playersData ?? []) as Player[]

  // Filled slot counts per team per position
  const { data: allRosterEntries } = await supabase
    .from("roster_entries").select("team_id, player:players(position)").in("slot_type", ["starting", "bench"])

  const filledSlotsByTeam: Record<string, Record<Position, number>> = {}
  for (const team of teams) {
    filledSlotsByTeam[team.id] = { GK: 0, DEF: 0, MID: 0, FWD: 0 }
  }
  for (const entry of allRosterEntries ?? []) {
    const player = entry.player as unknown as { position: Position } | null
    const pos = player?.position
    if (pos && filledSlotsByTeam[entry.team_id]) {
      filledSlotsByTeam[entry.team_id][pos]++
    }
  }

  // Chat: initial messages + kicked names
  let chatMessages: ChatMessage[] = []
  let kickedNames: string[] = []
  if (auction) {
    const [{ data: chatData }, { data: kickData }] = await Promise.all([
      supabase
        .from("chat_messages")
        .select("id, auction_id, user_id, author_name, is_guest, message, created_at")
        .eq("auction_id", auction.id)
        .order("created_at", { ascending: true })
        .limit(50),
      supabase.from("chat_kicks").select("guest_name"),
    ])
    chatMessages = (chatData ?? []) as ChatMessage[]
    kickedNames = (kickData ?? []).map((k: { guest_name: string }) => k.guest_name)
  }

  return {
    auction,
    currentLot,
    lastConcludedLot,
    bids,
    log,
    teams,
    availablePlayers,
    filledSlotsByTeam,
    myTeamId: profile?.team_id ?? null,
    myRole: (profile?.role ?? "guest") as Role,
    myUserId: profile?.id ?? null,
    isAdmin: profile?.role === "admin",
    chatMessages,
    kickedNames,
  }
}

export default async function AuctionPage() {
  const {
    auction,
    currentLot,
    lastConcludedLot,
    bids,
    log,
    teams,
    availablePlayers,
    filledSlotsByTeam,
    myTeamId,
    myRole,
    myUserId,
    isAdmin,
    chatMessages,
    kickedNames,
  } = await getPageData()

  const isLive = auction?.status === "active"

  return (
    <AuctionProvider
      initialAuction={auction}
      initialLot={currentLot}
      initialLastConcludedLot={lastConcludedLot}
      initialBids={bids}
      initialLog={log}
      initialTeams={teams}
      initialAvailablePlayers={availablePlayers}
      initialFilledSlotsByTeam={filledSlotsByTeam}
      myTeamId={myTeamId}
      myRole={myRole}
    >
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Auction</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {auction
                ? `${auction.type.replace("_", "-")} auction — ${auction.current_position_category ?? "setup"}`
                : "No auction in progress"}
            </p>
          </div>
          <Badge
            variant={isLive ? "default" : "outline"}
            className={cn("mt-1", isLive && "bg-emerald-500 hover:bg-emerald-500 text-white")}
          >
            {isLive ? "Live" : auction?.status === "pending" ? "Pending" : "No active auction"}
          </Badge>
        </div>

        {/* Main layout: 3 cols on lg, 4 cols on xl (chat panel added) */}
        <div className={cn(
          "grid grid-cols-1 gap-6 items-start",
          auction
            ? "lg:grid-cols-[1fr_320px_280px] xl:grid-cols-[1fr_320px_280px_260px]"
            : "lg:grid-cols-[1fr_320px_280px]"
        )}>

          {/* Left: player pool */}
          <div className="space-y-4">
            <PlayerSelectionPanel />
          </div>

          {/* Centre: action panel → lot stats → bid rows (bid rows only for admin/AM) */}
          <div className="space-y-4">
            <MyActionPanel />
            <CentralConsole />
            {myRole !== "team" && myRole !== "guest" && (
              <TeamBidConsole />
            )}
          </div>

          {/* Right: AM controls → log → last result → bid rows (teams + guests see bids here) */}
          <div className="space-y-4">
            <AuctionMasterControls />
            <AuctionLog />
            <BidResultPanel />
            {(myRole === "team" || myRole === "guest") && (
              <TeamBidConsole />
            )}
          </div>

          {/* Chat panel — only when an auction exists */}
          {auction && (
            <div className="h-[600px]">
              <ChatPanel
                auctionId={auction.id}
                myUserId={myUserId}
                myRole={myRole}
                isAdmin={isAdmin}
                initialMessages={chatMessages}
                initialKickedNames={kickedNames}
              />
            </div>
          )}
        </div>
      </div>
    </AuctionProvider>
  )
}
