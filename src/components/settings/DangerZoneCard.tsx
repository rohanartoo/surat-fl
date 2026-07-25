"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"

export function DangerZoneCard() {
  const [confirm, setConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const [gwValue, setGwValue] = useState("38")
  const [gwLoading, setGwLoading] = useState(false)
  const [gwConfirm, setGwConfirm] = useState(false)
  const [gwExisting, setGwExisting] = useState<number[]>([])
  const [gwError, setGwError] = useState<string | null>(null)
  const [gwSuccess, setGwSuccess] = useState<string | null>(null)

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

  async function handleSimulateGw(skipCheck = false) {
    const gws = parseGwInput(gwValue)
    if (!gws) {
      setGwError("Enter a GW number, range (38-40), or list (38,39,42) between 1 and 100.")
      return
    }

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
      setGwSuccess(`GW ${data.gameweeks.join(", ")} simulated — ${data.rows} player rows written.`)
    } finally {
      setGwLoading(false)
    }
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
            Generates random points for all rostered players for one or more GWs. Use GW 38+ to avoid conflicts with real data.
            Enter a single GW (38), a range (38-40), or a list (38,39,42).
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
            {gwConfirm ? (
              <div className="flex gap-2 flex-1">
                <Button size="sm" variant="destructive" className="flex-1 text-xs" disabled={gwLoading} onClick={() => handleSimulateGw(true)}>
                  Overwrite
                </Button>
                <Button size="sm" variant="outline" className="flex-1 text-xs" disabled={gwLoading} onClick={() => setGwConfirm(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" disabled={gwLoading} onClick={() => handleSimulateGw(false)} className="text-xs">
                {gwLoading ? "Simulating…" : "Simulate"}
              </Button>
            )}
          </div>
          {gwConfirm && <p className="text-xs text-amber-500">GW {gwExisting.join(", ")} already {gwExisting.length > 1 ? "have" : "has"} data. Overwrite?</p>}
          {gwSuccess && <p className="text-xs text-emerald-500">{gwSuccess}</p>}
          {gwError && <p className="text-xs text-destructive">{gwError}</p>}
        </div>

      </CardContent>
    </Card>
  )
}
