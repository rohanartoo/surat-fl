"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/**
 * Admin-only manual gameweek re-score, shown beside the standings it updates.
 *
 * Posts to the existing POST /api/scoring/sync rather than a server action.
 * That route already carries the admin-session check, validates the gameweek
 * is 1-38, and — the reason this component exists — returns row counts. The
 * server action it replaced returned void, so clicking the old button gave no
 * indication whether anything had happened.
 *
 * Hand-rolled fetch rather than the useApiAction hook (see
 * AuctionMasterControls.handleSyncFpl, which does the same): useApiAction
 * resolves to a bare boolean, and the whole point here is surfacing `synced`
 * and `penaltyRows`.
 */
export function SyncGameweekCard() {
  const router = useRouter()

  const [gwValue, setGwValue] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const [showFinalize, setShowFinalize] = useState(false)
  const [finalizeConfirm, setFinalizeConfirm] = useState(false)

  async function handleSync(finalize: boolean) {
    setLoading(true)
    setError(null)
    setResult(null)
    setFinalizeConfirm(false)
    try {
      const res = await fetch("/api/scoring/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Deliberately NOT pre-validated here — an empty or non-numeric box
        // sends `null` and the route answers with its own 1-38 message, so
        // there's exactly one source of truth for what a valid gameweek is.
        body: JSON.stringify({ gameweek: parseInt(gwValue, 10), finalize }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Sync failed."); return }
      setResult(
        `Re-synced GW ${data.gameweek} — ${data.synced} player rows across ${data.teams} teams` +
        (data.penaltyRows > 0 ? `, ${data.penaltyRows} penalty rows` : "") + "." +
        (data.finalized ? " Gameweek is now finalized." : "")
      )
      // The standings table renders from a server component on the same page.
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="border-border/60 w-full sm:w-80 shrink-0">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Sync gameweek points</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2 items-end">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium" htmlFor="gw-input">
              Gameweek
            </label>
            <Input
              id="gw-input"
              type="number"
              min={1}
              max={38}
              value={gwValue}
              onChange={e => { setGwValue(e.target.value); setResult(null); setError(null); setFinalizeConfirm(false) }}
              className="w-20 h-8 text-sm"
              placeholder="1"
              disabled={loading}
            />
          </div>
          <Button size="sm" variant="outline" disabled={loading} onClick={() => handleSync(false)}>
            {loading ? "Syncing…" : "Sync GW points"}
          </Button>
        </div>

        {result && <p className="text-xs text-emerald-500">{result}</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}

        <button
          type="button"
          className="text-[11px] text-muted-foreground underline underline-offset-2"
          onClick={() => { setShowFinalize(v => !v); setFinalizeConfirm(false) }}
        >
          {showFinalize ? "Hide" : "Force-finalize instead"}
        </button>

        {showFinalize && (
          <div className="space-y-2 pt-1">
            {/* Written as explicit string expressions rather than free JSX text:
                this compiler drops the whitespace between a closing tag (or an
                expression container) and text that continues on the next source
                line, which silently ran "undone" into "from" here. Strings make
                every space intentional. */}
            <p className="text-[11px] text-amber-500">
              {"Force-finalizing permanently freezes this gameweek's snapshot and lifts the lineup lock. It "}
              <strong>cannot be undone</strong>
              {" from the app — only a full league reset clears it. The scheduled sync finalizes on its own within about four hours of FPL confirming the gameweek, so only use this if FPL's “finished” flag is stuck on a gameweek that is genuinely over."}
            </p>
            {finalizeConfirm ? (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  className="flex-1 text-xs"
                  disabled={loading}
                  onClick={() => handleSync(true)}
                >
                  Yes, finalize GW {gwValue || "—"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 text-xs"
                  disabled={loading}
                  onClick={() => setFinalizeConfirm(false)}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="w-full text-xs text-destructive border-destructive/40 hover:bg-destructive/10"
                disabled={loading}
                onClick={() => { setResult(null); setError(null); setFinalizeConfirm(true) }}
              >
                Sync &amp; force-finalize
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
