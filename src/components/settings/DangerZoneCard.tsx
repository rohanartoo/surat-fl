"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"

export function DangerZoneCard() {
  const [confirm, setConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const [nextGameweek, setNextGameweek] = useState<number | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [gwValue, setGwValue] = useState("38")
  const [gwLoading, setGwLoading] = useState(false)
  const [gwConfirm, setGwConfirm] = useState(false)
  const [pendingGws, setPendingGws] = useState<number[]>([])
  const [gwExisting, setGwExisting] = useState<number[]>([])
  const [gwError, setGwError] = useState<string | null>(null)
  const [gwSuccess, setGwSuccess] = useState<string | null>(null)

  async function refetchNextGameweek() {
    const res = await fetch("/api/admin/simulate-gw/next")
    if (res.ok) {
      const { nextGameweek: n } = await res.json()
      setNextGameweek(n)
    }
  }

  useEffect(() => {
    async function load() {
      await refetchNextGameweek()
    }
    load()
  }, [])

  // Accepts "38", "38-40", or "38,39,42" (mix of comma-separated values and ranges)
  function parseGwInput(value: string): number[] | null {
    const parts = value.split(",").map(p => p.trim()).filter(Boolean)
    if (parts.length === 0) return null
    const gws = new Set<number>()
    for (const part of parts) {
      const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/)
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1], 10)
        const end = parseInt(rangeMatch[2], 10)
        if (isNaN(start) || isNaN(end) || start > end) return null
        for (let gw = start; gw <= end; gw++) gws.add(gw)
      } else {
        const gw = parseInt(part, 10)
        if (isNaN(gw) || String(gw) !== part) return null
        gws.add(gw)
      }
    }
    const list = [...gws]
    if (list.some(gw => gw < 1 || gw > 100)) return null
    return list.sort((a, b) => a - b)
  }

  async function handleWipe() {
    setLoading(true)
    setError(null)
    setConfirm(false)
    try {
      const res = await fetch("/api/admin/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Reset failed."); return }
      setSuccess(true)
    } finally {
      setLoading(false)
    }
  }

  async function handleSimulateGw(gws: number[], skipCheck = false) {
    setGwLoading(true)
    setGwError(null)
    setGwSuccess(null)

    try {
      // Check if data already exists for any of these GWs
      if (!skipCheck) {
        const checkRes = await fetch(`/api/admin/simulate-gw/check?gws=${gws.join(",")}`)
        if (checkRes.ok) {
          const { exists, existing } = await checkRes.json()
          if (exists) {
            setPendingGws(gws)
            setGwExisting(existing)
            setGwConfirm(true)
            setGwLoading(false)
            return
          }
        }
      }

      setGwConfirm(false)
      const res = await fetch("/api/admin/simulate-gw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameweeks: gws }),
      })
      const data = await res.json()
      if (!res.ok) { setGwError(data.error ?? "Simulation failed."); return }
      setGwSuccess(`GW ${data.gameweeks.join(", ")} simulated — ${data.rows} player rows, ${data.penaltyRows ?? 0} penalty rows written.`)
      await refetchNextGameweek()
    } finally {
      setGwLoading(false)
    }
  }

  function handleSimulateNext() {
    if (nextGameweek === null) return
    handleSimulateGw([nextGameweek])
  }

  function handleSimulateManual() {
    const gws = parseGwInput(gwValue)
    if (!gws) {
      setGwError("Enter a GW number, range (38-40), or list (38,39,42) between 1 and 100.")
      return
    }
    handleSimulateGw(gws)
  }

  return (
    <Card className="border-destructive/30 bg-destructive/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-base text-destructive">Danger Zone</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* Full wipe */}
        <div className="space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Reset to Clean Slate</p>
          <p className="text-xs text-muted-foreground">
            Wipes all auctions, rosters, gameweek points, and resets all budgets and base prices. Does not affect usernames, passwords, or team names.
          </p>
          {confirm ? (
            <div className="space-y-2">
              <p className="text-xs text-destructive font-medium">This cannot be undone. Are you absolutely sure?</p>
              <div className="flex gap-2">
                <Button size="sm" variant="destructive" className="flex-1" disabled={loading} onClick={handleWipe}>
                  Yes, wipe everything
                </Button>
                <Button size="sm" variant="outline" className="flex-1" disabled={loading} onClick={() => setConfirm(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="w-full text-destructive border-destructive/40 hover:bg-destructive/10"
              disabled={loading}
              onClick={() => { setSuccess(false); setConfirm(true) }}
            >
              Reset to clean slate
            </Button>
          )}
          {success && <p className="text-xs text-emerald-500">League reset successfully.</p>}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <Separator />

        {/* Simulate GW */}
        <div className="space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Simulate Gameweek Scores</p>
          <p className="text-xs text-muted-foreground">
            Generates random points for all rostered players. Any pending drop-quota penalty attaches to whichever GW is simulated next, so simulating in order (the default) is the safe path.
          </p>

          {!gwConfirm && (
            <Button
              size="sm"
              variant="outline"
              disabled={gwLoading || nextGameweek === null}
              onClick={handleSimulateNext}
              className="w-full text-xs"
            >
              {gwLoading ? "Simulating…" : nextGameweek !== null ? `Simulate next GW (GW ${nextGameweek})` : "Loading…"}
            </Button>
          )}

          {gwConfirm && (
            <div className="space-y-2">
              <p className="text-xs text-amber-500">GW {gwExisting.join(", ")} already {gwExisting.length > 1 ? "have" : "has"} data. Overwrite?</p>
              <div className="flex gap-2">
                <Button size="sm" variant="destructive" className="flex-1 text-xs" disabled={gwLoading} onClick={() => handleSimulateGw(pendingGws, true)}>
                  Overwrite
                </Button>
                <Button size="sm" variant="outline" className="flex-1 text-xs" disabled={gwLoading} onClick={() => setGwConfirm(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {gwSuccess && <p className="text-xs text-emerald-500">{gwSuccess}</p>}
          {gwError && <p className="text-xs text-destructive">{gwError}</p>}

          <button
            type="button"
            className="text-[11px] text-muted-foreground underline underline-offset-2"
            onClick={() => setShowAdvanced(v => !v)}
          >
            {showAdvanced ? "Hide" : "Simulate a specific GW instead"}
          </button>

          {showAdvanced && (
            <div className="space-y-2 pt-1">
              <p className="text-[11px] text-amber-500">
                Simulating out of order can misattribute a pending drop penalty meant for a later GW to this one instead — only use this for backfilling or testing.
              </p>
              <div className="flex gap-2">
                <Input
                  type="text"
                  value={gwValue}
                  onChange={e => { setGwValue(e.target.value); setGwConfirm(false); setGwSuccess(null); setGwError(null) }}
                  className="h-8 w-32 text-sm"
                  placeholder="e.g. 38-40"
                  disabled={gwLoading}
                />
                <Button size="sm" variant="outline" disabled={gwLoading} onClick={handleSimulateManual} className="text-xs">
                  {gwLoading ? "Simulating…" : "Simulate"}
                </Button>
              </div>
            </div>
          )}
        </div>

      </CardContent>
    </Card>
  )
}
