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
  const [gwError, setGwError] = useState<string | null>(null)
  const [gwSuccess, setGwSuccess] = useState<string | null>(null)

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
    const gw = parseInt(gwValue, 10)
    if (isNaN(gw) || gw < 1 || gw > 100) {
      setGwError("Enter a GW number between 1 and 100.")
      return
    }

    setGwLoading(true)
    setGwError(null)
    setGwSuccess(null)

    try {
      // Check if data already exists for this GW
      if (!skipCheck) {
        const checkRes = await fetch(`/api/admin/simulate-gw/check?gw=${gw}`)
        if (checkRes.ok) {
          const { exists } = await checkRes.json()
          if (exists) {
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
        body: JSON.stringify({ gameweek: gw }),
      })
      const data = await res.json()
      if (!res.ok) { setGwError(data.error ?? "Simulation failed."); return }
      setGwSuccess(`GW ${data.gameweek} simulated — ${data.rows} player rows written.`)
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
            Generates random points for all rostered players for a chosen GW. Use GW 38+ to avoid conflicts with real data.
          </p>
          <div className="flex gap-2">
            <Input
              type="number"
              min={1}
              max={100}
              value={gwValue}
              onChange={e => { setGwValue(e.target.value); setGwConfirm(false); setGwSuccess(null); setGwError(null) }}
              className="h-8 w-24 text-sm"
              placeholder="GW"
              disabled={gwLoading}
            />
            {gwConfirm ? (
              <div className="flex gap-2 flex-1">
                <Button size="sm" variant="destructive" className="flex-1 text-xs" disabled={gwLoading} onClick={() => handleSimulateGw(true)}>
                  Overwrite GW {gwValue}
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
          {gwConfirm && <p className="text-xs text-amber-500">GW {gwValue} already has data. Overwrite?</p>}
          {gwSuccess && <p className="text-xs text-emerald-500">{gwSuccess}</p>}
          {gwError && <p className="text-xs text-destructive">{gwError}</p>}
        </div>

      </CardContent>
    </Card>
  )
}
