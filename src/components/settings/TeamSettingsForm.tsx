"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useApiAction } from "@/hooks/useApiAction"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface Props {
  currentUsername: string
  teamId: string
  teamDisplayName: string
}

export function TeamSettingsForm({ currentUsername, teamId, teamDisplayName }: Props) {
  const router = useRouter()

  // ── Team name ────────────────────────────────────────────────────────────────
  const [newName, setNewName] = useState(teamDisplayName)
  const { post: postName, loading: nameLoading, error: nameError } = useApiAction("/api/team")
  const [nameSuccess, setNameSuccess] = useState(false)

  async function handleNameSave() {
    setNameSuccess(false)
    const ok = await postName("update-name", { team_id: teamId, display_name: newName })
    if (ok) { setNameSuccess(true); router.refresh() }
  }

  // ── Username ─────────────────────────────────────────────────────────────────
  const [newUsername, setNewUsername] = useState(currentUsername)
  const { post: postUsername, loading: usernameLoading, error: usernameError } = useApiAction("/api/auth")
  const [usernameSuccess, setUsernameSuccess] = useState(false)

  async function handleUsernameSave() {
    setUsernameSuccess(false)
    const ok = await postUsername("update-username", { new_username: newUsername })
    if (ok) setUsernameSuccess(true)
  }

  // ── Password ─────────────────────────────────────────────────────────────────
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const { post: postPassword, loading: passwordLoading, error: passwordError } = useApiAction("/api/auth")
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [passwordValidationError, setPasswordValidationError] = useState<string | null>(null)

  async function handlePasswordSave() {
    setPasswordValidationError(null)
    setPasswordSuccess(false)
    if (newPassword.length < 8) {
      setPasswordValidationError("Password must be at least 8 characters.")
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordValidationError("Passwords do not match.")
      return
    }
    const ok = await postPassword("update-credentials", { newPassword })
    if (ok) { setPasswordSuccess(true); setNewPassword(""); setConfirmPassword("") }
  }

  return (
    <div className="space-y-6">
      {/* Team name — only shown when the account has a linked team */}
      {teamId && <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Team Name</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            value={newName}
            onChange={e => { setNewName(e.target.value); setNameSuccess(false) }}
            placeholder="My Team"
            maxLength={40}
          />
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              disabled={nameLoading || newName.trim() === teamDisplayName || newName.trim().length < 2}
              onClick={handleNameSave}
            >
              Save name
            </Button>
            {nameSuccess && <p className="text-xs text-emerald-500">Saved.</p>}
            {nameError && <p className="text-xs text-destructive">{nameError}</p>}
          </div>
        </CardContent>
      </Card>}

      {/* Username */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Username</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            value={newUsername}
            onChange={e => { setNewUsername(e.target.value); setUsernameSuccess(false) }}
            placeholder="username"
            autoComplete="username"
          />
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              disabled={usernameLoading || newUsername.trim() === currentUsername || newUsername.trim().length < 2}
              onClick={handleUsernameSave}
            >
              Save username
            </Button>
            {usernameSuccess && <p className="text-xs text-emerald-500">Saved. You can now log in with your new username.</p>}
            {usernameError && <p className="text-xs text-destructive">{usernameError}</p>}
          </div>
        </CardContent>
      </Card>

      {/* Password */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            type="password"
            placeholder="New password (min 8 characters)"
            autoComplete="new-password"
            value={newPassword}
            onChange={e => { setNewPassword(e.target.value); setPasswordSuccess(false); setPasswordValidationError(null) }}
          />
          <Input
            type="password"
            placeholder="Confirm new password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={e => { setConfirmPassword(e.target.value); setPasswordSuccess(false); setPasswordValidationError(null) }}
          />
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              disabled={passwordLoading || !newPassword || !confirmPassword}
              onClick={handlePasswordSave}
            >
              Save password
            </Button>
            {passwordSuccess && <p className="text-xs text-emerald-500">Password updated.</p>}
            {(passwordError || passwordValidationError) && (
              <p className="text-xs text-destructive">{passwordValidationError ?? passwordError}</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
