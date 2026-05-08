import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { formatMoney, positionColor, cn } from "@/lib/utils"
import type { Player } from "@/types"

async function getAuctionData() {
  const supabase = await createClient()

  const { data: players } = await supabase
    .from("players")
    .select("*")
    .not("id", "in", `(select player_id from roster_entries where is_active = true)`)
    .order("selected_by_percent", { ascending: false })

  const { data: teams } = await supabase
    .from("teams")
    .select("id, name, short_name, budget")
    .order("name")

  const { data: activeAuction } = await supabase
    .from("auctions")
    .select("*, lots:auction_lots(*, player:players(*), bids(*, team:teams(*)))")
    .eq("status", "active")
    .maybeSingle()

  return {
    availablePlayers: players ?? [],
    teams: teams ?? [],
    activeAuction,
  }
}

function PlayerListItem({ player }: { player: Player }) {
  return (
    <div className="flex items-center justify-between py-3 px-4 hover:bg-accent/40 transition-colors cursor-pointer rounded-md">
      <div className="flex items-center gap-3">
        <Badge
          variant="outline"
          className={cn("text-xs w-10 justify-center font-medium border-0 bg-secondary shrink-0", positionColor(player.position))}
        >
          {player.position}
        </Badge>
        <div>
          <p className="text-sm font-medium leading-none">{player.web_name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{player.fpl_team_short}</p>
        </div>
      </div>
      <div className="text-right shrink-0 ml-4">
        <p className="text-xs font-mono font-medium">{player.selected_by_percent.toFixed(1)}%</p>
        <p className="text-xs text-muted-foreground">selected</p>
      </div>
    </div>
  )
}

export default async function AuctionPage() {
  const { availablePlayers, teams, activeAuction } = await getAuctionData()

  const positions = ["All", "GK", "DEF", "MID", "FWD"] as const

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Auction</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {availablePlayers.length} available players
          </p>
        </div>
        <Badge
          variant={activeAuction ? "default" : "outline"}
          className={cn("mt-1", activeAuction && "bg-emerald-500 hover:bg-emerald-500")}
        >
          {activeAuction ? "Live" : "No active auction"}
        </Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Available players panel */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Available Players</CardTitle>
              </div>
              <div className="flex gap-2 mt-2">
                <Input placeholder="Search player…" className="h-8 text-sm" />
                <Select defaultValue="All">
                  <SelectTrigger className="h-8 w-32 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {positions.map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="p-2">
              {availablePlayers.length === 0 ? (
                <div className="space-y-1 p-2">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 py-3 px-2">
                      <Skeleton className="h-5 w-10" />
                      <div className="space-y-1.5">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-3 w-16" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="max-h-[500px] overflow-y-auto">
                  {availablePlayers.map((player: Player) => (
                    <PlayerListItem key={player.id} player={player} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right panel: teams budget + active lot */}
        <div className="space-y-4">
          {/* Active lot */}
          {activeAuction ? (
            <Card className="border-emerald-500/30 bg-emerald-500/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-emerald-500">Currently bidding</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-sm">Auction lot details will appear here</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-border/60 border-dashed">
              <CardContent className="py-8 text-center">
                <p className="text-sm text-muted-foreground">No active auction</p>
                <p className="text-xs text-muted-foreground mt-1">Start an auction to begin bidding</p>
              </CardContent>
            </Card>
          )}

          {/* Team budgets */}
          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Team Budgets</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-3">
              {teams.length === 0 ? (
                Array.from({ length: 7 }).map((_, i) => (
                  <div key={i} className="flex justify-between items-center p-1">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-12" />
                  </div>
                ))
              ) : (
                teams.map((team: { id: string; name: string; short_name: string; budget: number }) => (
                  <div key={team.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-accent/40 transition-colors">
                    <span className="text-sm">{team.short_name}</span>
                    <span className="text-sm font-mono font-medium text-emerald-500">
                      {formatMoney(team.budget)}
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
