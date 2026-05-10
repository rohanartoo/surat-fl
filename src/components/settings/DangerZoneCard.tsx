"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export function DangerZoneCard() {
  const [confirm, setConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

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

  return (
    <Card className="border-destructive/30 bg-destructive/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-base text-destructive">Danger Zone</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Wipes all auctions, rosters, gameweek points, and resets all budgets and base prices to their starting values. For development and testing only.
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
      </CardContent>
    </Card>
  )
}
