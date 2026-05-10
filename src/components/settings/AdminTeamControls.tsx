"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useApiAction } from "@/hooks/useApiAction"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"

interface Props {
  teamId: string
  teamDisplayName: string
  targetUserId: string
  targetUsername: string
}

export function AdminTeamControls({ teamId, teamDisplayName, targetUserId, targetUsername }: Props) {
  const router = useRouter()

  // ── Reset team name ──────────────────────────────────────────────────────────
  const [newName, setNewName] = useState(teamDisplayName)
  const { post: postName, loading: nameLoading, error: nameError } = useApiAction("/api/team")
  const [nameSuccess, setNameSuccess] = useState(false)

  async function handleNameReset() {
    setNameSuccess(false)
    const ok = await postName("update-name", { team_id: teamId, display_name: newName })
    if (ok) { setNameSuccess(true); router.refresh() }
  }

  // ── Reset username ───────────────────────────────────────────────────────────
  const [newUsername, setNewUsername] = useState(targetUsername)
  const { post: postUsername, loading: usernameLoading, error: usernameError } = useApiAction("/api/auth")
  const [usernameSuccess, setUsernameSuccess] = useState(false)

  async function handleUsernameReset() {
    setUsernameSuccess(false)
    const ok = await postUsername("update-username", { new_username: newUsername, target_user_id: targetUserId })
    if (ok) setUsernameSuccess(true)
  }

  // ── Force-set password ───────────────────────────────────────────────────────
  const [newPassword, setNewPassword] = useState("")
  const { post: postPassword, loading: passwordLoading, error: passwordError } = useApiAction("/api/auth")
  const [passwordSuccess, setPasswordSuccess] = useState(false)

  async function handlePasswordReset() {
    setPasswordSuccess(false)
    const ok = await postPassword("admin-reset-password", { target_user_id: targetUserId, new_password: newPassword })
    if (ok) { setPasswordSuccess(true); setNewPassword("") }
  }

  return (
    <Card className="border-rose-500/30 bg-rose-500/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-rose-500">Admin Controls</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Team name */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Team Name</p>
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={e => { setNewName(e.target.value); setNameSuccess(false) }}
              className="h-8 text-sm"
              maxLength={40}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={nameLoading || newName.trim().length < 2}
              onClick={handleNameReset}
            >
              Save
            </Button>
          </div>
          {nameSuccess && <p className="text-xs text-emerald-500">Team name updated.</p>}
          {nameError && <p className="text-xs text-destructive">{nameError}</p>}
        </div>

        <Separator />

        {/* Username */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Username</p>
          <div className="flex gap-2">
            <Input
              value={newUsername}
              onChange={e => { setNewUsername(e.target.value); setUsernameSuccess(false) }}
              className="h-8 text-sm"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={usernameLoading || newUsername.trim().length < 2}
              onClick={handleUsernameReset}
            >
              Save
            </Button>
          </div>
          {usernameSuccess && <p className="text-xs text-emerald-500">Username updated.</p>}
          {usernameError && <p className="text-xs text-destructive">{usernameError}</p>}
        </div>

        <Separator />

        {/* Password */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Force-set Password</p>
          <div className="flex gap-2">
            <Input
              type="password"
              placeholder="New password (min 8 chars)"
              value={newPassword}
              onChange={e => { setNewPassword(e.target.value); setPasswordSuccess(false) }}
              className="h-8 text-sm"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={passwordLoading || newPassword.length < 8}
              onClick={handlePasswordReset}
            >
              Set
            </Button>
          </div>
          {passwordSuccess && <p className="text-xs text-emerald-500">Password updated.</p>}
          {passwordError && <p className="text-xs text-destructive">{passwordError}</p>}
        </div>
      </CardContent>
    </Card>
  )
}
