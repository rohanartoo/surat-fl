"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useApiAction } from "@/hooks/useApiAction"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { Role } from "@/types"

interface Team {
  id: string
  display_name: string
}

interface Props {
  teams: Team[]
}

const ROLES: { value: Role; label: string }[] = [
  { value: "team", label: "Team" },
  { value: "auction_master", label: "Auction Master" },
  { value: "admin", label: "Admin" },
  { value: "guest", label: "Guest" },
]

export function CreateUserForm({ teams }: Props) {
  const router = useRouter()
  const { post, loading, error, setError } = useApiAction("/api/admin")

  const [username, setUsername] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [password, setPassword] = useState("")
  const [role, setRole] = useState<Role>("team")
  const [teamId, setTeamId] = useState("")
  const [success, setSuccess] = useState(false)

  const canSubmit =
    username.trim().length >= 2 &&
    displayName.trim().length >= 1 &&
    password.length >= 8 &&
    !loading

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSuccess(false)
    const ok = await post("create-user", {
      username: username.trim(),
      display_name: displayName.trim(),
      password,
      role,
      team_id: teamId || null,
    })
    if (ok) {
      setSuccess(true)
      setUsername("")
      setDisplayName("")
      setPassword("")
      setRole("team")
      setTeamId("")
      router.refresh()
    }
  }

  return (
    <Card className="border-rose-500/30 bg-rose-500/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm text-rose-500">Create User Account</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Display name */}
          <div className="space-y-1.5">
            <Label htmlFor="display_name" className="text-xs">Display Name</Label>
            <Input
              id="display_name"
              placeholder="e.g. Rohan Shah"
              value={displayName}
              onChange={e => { setDisplayName(e.target.value); setSuccess(false); setError(null) }}
              className="h-8 text-sm"
              maxLength={60}
            />
          </div>

          {/* Username */}
          <div className="space-y-1.5">
            <Label htmlFor="new_username" className="text-xs">Username</Label>
            <Input
              id="new_username"
              placeholder="e.g. rohan (used to log in)"
              value={username}
              onChange={e => { setUsername(e.target.value); setSuccess(false); setError(null) }}
              className="h-8 text-sm"
              autoCapitalize="none"
              autoCorrect="off"
            />
          </div>

          {/* Password */}
          <div className="space-y-1.5">
            <Label htmlFor="new_password" className="text-xs">Temporary Password</Label>
            <Input
              id="new_password"
              type="password"
              placeholder="Min 8 characters"
              value={password}
              onChange={e => { setPassword(e.target.value); setSuccess(false); setError(null) }}
              className="h-8 text-sm"
            />
          </div>

          {/* Role */}
          <div className="space-y-1.5">
            <Label htmlFor="role" className="text-xs">Role</Label>
            <select
              id="role"
              value={role}
              onChange={e => setRole(e.target.value as Role)}
              className="w-full h-8 rounded-md border border-input bg-background px-3 text-sm"
            >
              {ROLES.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          {/* Team (only relevant for team role) */}
          {role === "team" && (
            <div className="space-y-1.5">
              <Label htmlFor="team_id" className="text-xs">Assign to Team</Label>
              <select
                id="team_id"
                value={teamId}
                onChange={e => setTeamId(e.target.value)}
                className="w-full h-8 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">— No team yet —</option>
                {teams.map(t => (
                  <option key={t.id} value={t.id}>{t.display_name}</option>
                ))}
              </select>
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
          {success && (
            <p className="text-xs text-emerald-500">
              Account created. Share the username and temporary password with the team.
            </p>
          )}

          <Button
            type="submit"
            size="sm"
            disabled={!canSubmit}
            className="w-full"
          >
            {loading ? "Creating…" : "Create Account"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
