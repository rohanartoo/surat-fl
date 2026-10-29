import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { PositionBadge } from "@/components/ui/PositionBadge"
import { AuctionPicker, type AuctionOption } from "@/components/history/AuctionPicker"
import { cn, formatMoney } from "@/lib/utils"
import type { Auction, LeagueTeam, Player, Position } from "@/types"

interface PageProps {
  searchParams: Promise<{ auction?: string }>
}

type LotRow = {
  player_id: number
  winning_bid: number | null
  winning_team_id: string
  created_at: string
  player: Pick<Player, "web_name" | "position" | "fpl_team_short"> | null
}

type DropRow = {
  team_id: string
  player_id: number
  drop_price: number | null
  created_at: string
  player: Pick<Player, "web_name" | "position" | "fpl_team_short"> | null
}

type LoanRow = {
  id: string
  created_at: string
  cash_amount: number
  cash_team_id: string | null
  team_a_id: string
  team_b_id: string
  player_a: Pick<Player, "web_name" | "position"> | null
  player_b: Pick<Player, "web_name" | "position"> | null
}

function auctionLabel(a: Auction): string {
  const when = new Date(a.started_at ?? a.created_at).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  })
  const type = a.type.replace("_", "-")
  const state = a.status === "completed" ? "" : ` · ${a.status}`
  return `${type} — ${when}${state}`
}

async function getPageData(selectedParam?: string) {
  const supabase = await createClient()

  // Only auctions that actually started have history: a pending auction's
  // drops are still staged, and staged drops must stay secret from other
  // teams until it starts (see CLAUDE.md → Drops & re-draft restrictions).
  const { data: auctionsData } = await supabase
    .from("auctions")
    .select("*")
    .in("status", ["active", "completed"])
    .order("created_at", { ascending: false })

  const auctions = (auctionsData ?? []) as Auction[]
  const selected = auctions.find(a => a.id === selectedParam) ?? auctions[0] ?? null

  const [{ data: teamsData }, lotsResult, dropsResult, loansResult] = await Promise.all([
    supabase.from("teams").select("*").order("display_name"),
    selected
      ? supabase
          .from("auction_lots")
          .select("player_id, winning_bid, winning_team_id, created_at, player:players(web_name, position, fpl_team_short)")
          .eq("auction_id", selected.id)
          .not("winning_team_id", "is", null)
          .order("created_at")
      : Promise.resolve({ data: [] }),
    // status 'locked' only — a 'staged' row belongs to an auction that hasn't
    // started, which this page never lists anyway.
    selected
      ? supabase
          .from("team_drops")
          .select("team_id, player_id, drop_price, created_at, player:players(web_name, position, fpl_team_short)")
          .eq("auction_id", selected.id)
          .eq("status", "locked")
          .order("created_at")
      : Promise.resolve({ data: [] }),
    supabase
      .from("loan_transfers")
      .select("id, created_at, cash_amount, cash_team_id, team_a_id, team_b_id, player_a:players!loan_transfers_player_a_id_fkey(web_name, position), player_b:players!loan_transfers_player_b_id_fkey(web_name, position)")
      .order("created_at", { ascending: false }),
  ])

  return {
    auctions,
    selected,
    teams: (teamsData ?? []) as LeagueTeam[],
    lots: (lotsResult.data ?? []) as unknown as LotRow[],
    drops: (dropsResult.data ?? []) as unknown as DropRow[],
    loans: (loansResult.data ?? []) as unknown as LoanRow[],
  }
}

export default async function HistoryPage({ searchParams }: PageProps) {
  const { auction: selectedParam } = await searchParams
  const { auctions, selected, teams, lots, drops, loans } = await getPageData(selectedParam)

  const teamById = new Map(teams.map(t => [t.id, t]))
  const options: AuctionOption[] = auctions.map(a => ({ id: a.id, label: auctionLabel(a) }))

  const summary = teams
    .map(team => {
      const bought = lots.filter(l => l.winning_team_id === team.id)
      const dropped = drops.filter(d => d.team_id === team.id)
      return {
        team,
        bought: bought.length,
        spent: bought.reduce((s, l) => s + (l.winning_bid ?? 0), 0),
        dropped: dropped.length,
        credited: dropped.reduce((s, d) => s + (d.drop_price ?? 0), 0),
      }
    })
    .filter(r => r.bought > 0 || r.dropped > 0)
    .sort((a, b) => b.spent - a.spent)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Auction History</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Who was bought and dropped in each auction, and for how much.
          </p>
        </div>
        {options.length > 0 && selected && (
          <AuctionPicker auctions={options} selectedId={selected.id} />
        )}
      </div>

      {!selected ? (
        <Card className="border-border/60 border-dashed">
          <CardContent className="py-10 text-center">
            <p className="text-sm text-muted-foreground">No auction has been run yet.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {summary.length > 0 && (
            <Card className="border-border/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Per team</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/40">
                        <th className="text-left font-medium px-4 py-2">Team</th>
                        <th className="text-right font-medium px-2 py-2">Bought</th>
                        <th className="text-right font-medium px-2 py-2">Spent</th>
                        <th className="text-right font-medium px-2 py-2">Dropped</th>
                        <th className="text-right font-medium px-4 py-2">Credited</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/30">
                      {summary.map(r => (
                        <tr key={r.team.id}>
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-2">
                              <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: r.team.color }} />
                              <span className="font-medium">{r.team.display_name}</span>
                            </div>
                          </td>
                          <td className="px-2 py-2 text-right font-mono">{r.bought}</td>
                          <td className="px-2 py-2 text-right font-mono">{formatMoney(r.spent)}</td>
                          <td className="px-2 py-2 text-right font-mono">{r.dropped}</td>
                          <td className="px-4 py-2 text-right font-mono text-muted-foreground">{formatMoney(r.credited)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            <MovementCard
              title="Purchases"
              count={lots.length}
              emptyLabel="No players were bought in this auction."
              rows={lots.map(l => ({
                key: `${l.player_id}`,
                player: l.player,
                team: teamById.get(l.winning_team_id),
                amount: l.winning_bid,
              }))}
            />
            <MovementCard
              title="Drops"
              count={drops.length}
              emptyLabel="No players were dropped for this auction."
              amountLabel="new price"
              muted
              rows={drops.map(d => ({
                key: `${d.team_id}-${d.player_id}`,
                player: d.player,
                team: teamById.get(d.team_id),
                amount: d.drop_price,
              }))}
            />
          </div>

          {loans.length > 0 && (
            <Card className="border-border/60">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Loan transfers</CardTitle>
                  <Badge variant="secondary" className="font-mono text-xs">{loans.length}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Swaps between teams — not tied to an auction, so the full history is shown.
                </p>
              </CardHeader>
              <CardContent className="space-y-2 px-3 pb-3">
                {loans.map(loan => {
                  const teamA = teamById.get(loan.team_a_id)
                  const teamB = teamById.get(loan.team_b_id)
                  const cashTeam = loan.cash_team_id ? teamById.get(loan.cash_team_id) : null
                  return (
                    <div key={loan.id} className="rounded-md bg-secondary/40 px-3 py-2 text-sm">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-medium">{teamA?.short_name ?? "?"}</span>
                        <span className="text-muted-foreground">{loan.player_a?.web_name ?? "?"}</span>
                        <span className="text-muted-foreground">⇄</span>
                        <span className="font-medium">{teamB?.short_name ?? "?"}</span>
                        <span className="text-muted-foreground">{loan.player_b?.web_name ?? "?"}</span>
                        {cashTeam && loan.cash_amount > 0 && (
                          <span className="text-xs text-muted-foreground">
                            (+ {formatMoney(loan.cash_amount)} from {cashTeam.short_name})
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {new Date(loan.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      </p>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

function MovementCard({
  title,
  count,
  rows,
  emptyLabel,
  amountLabel = "price",
  muted = false,
}: {
  title: string
  count: number
  rows: {
    key: string
    player: Pick<Player, "web_name" | "position" | "fpl_team_short"> | null
    team: LeagueTeam | undefined
    amount: number | null
  }[]
  emptyLabel: string
  amountLabel?: string
  muted?: boolean
}) {
  const total = rows.reduce((s, r) => s + (r.amount ?? 0), 0)

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{title}</CardTitle>
          <div className="flex items-center gap-2">
            {rows.length > 0 && (
              <span className="text-xs font-mono text-muted-foreground">{formatMoney(total)} total</span>
            )}
            <Badge variant="secondary" className="font-mono text-xs">{count}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground italic px-4 py-6 text-center">{emptyLabel}</p>
        ) : (
          <div className="divide-y divide-border/30">
            {rows.map(r => (
              <div key={r.key} className="flex items-center justify-between px-4 py-2">
                <div className="flex items-center gap-3 min-w-0">
                  {r.player && <PositionBadge position={r.player.position as Position} />}
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-none truncate">{r.player?.web_name ?? "Unknown player"}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{r.player?.fpl_team_short}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-2">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: r.team?.color }} />
                    <span className="text-xs">{r.team?.short_name ?? "?"}</span>
                  </div>
                  <span
                    className={cn("text-sm font-mono w-16 text-right", muted && "text-muted-foreground")}
                    title={amountLabel}
                  >
                    {r.amount === null ? "—" : formatMoney(r.amount)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
