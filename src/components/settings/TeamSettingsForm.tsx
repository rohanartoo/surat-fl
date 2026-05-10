"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useApiAction } from "@/hooks/useApiAction"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface TeamNameProps {
  teamId: string
  teamDisplayName: string
}

export function TeamNameCard({ teamId, teamDisplayName }: TeamNameProps) {
  const router = useRouter()
  const [newName, setNewName] = useState(teamDisplayName)
  const { post, loading, error } = useApiAction("/api/team")
  const [success, setSuccess] = useState(false)

  async function handleSave() {
    setSuccess(false)
    const ok = await post("update-name", { team_id: teamId, display_name: newName })
    if (ok) { setSuccess(true); router.refresh() }
  }

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Team Name</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          value={newName}
          onChange={e => { setNewName(e.target.value); setSuccess(false) }}
          placeholder="My Team"
          maxLength={40}
        />
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            disabled={loading || newName.trim() === teamDisplayName || newName.trim().length < 2}
            onClick={handleSave}
          >
            Save name
          </Button>
          {success && <p className="text-xs text-emerald-500">Saved.</p>}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </CardContent>
    </Card>
  )
}

interface UsernameProps {
  currentUsername: string
}

export function UsernameCard({ currentUsername }: UsernameProps) {
  const [newUsername, setNewUsername] = useState(currentUsername)
  const { post, loading, error } = useApiAction("/api/auth")
  const [success, setSuccess] = useState(false)

  async function handleSave() {
    setSuccess(false)
    const ok = await post("update-username", { new_username: newUsername })
    if (ok) setSuccess(true)
  }

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Username</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          value={newUsername}
          onChange={e => { setNewUsername(e.target.value); setSuccess(false) }}
          placeholder="username"
          autoComplete="username"
          autoCapitalize="none"
        />
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            disabled={loading || newUsername.trim() === currentUsername || newUsername.trim().length < 2}
            onClick={handleSave}
          >
            Save username
          </Button>
          {success && <p className="text-xs text-emerald-500">Saved.</p>}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </CardContent>
    </Card>
  )
}

export function PasswordCard() {
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const { post, loading, error } = useApiAction("/api/auth")
  const [success, setSuccess] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  async function handleSave() {
    setValidationError(null)
    setSuccess(false)
    if (newPassword.length < 8) { setValidationError("Password must be at least 8 characters."); return }
    if (newPassword !== confirmPassword) { setValidationError("Passwords do not match."); return }
    const ok = await post("update-credentials", { newPassword })
    if (ok) { setSuccess(true); setNewPassword(""); setConfirmPassword("") }
  }

  return (
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
          onChange={e => { setNewPassword(e.target.value); setSuccess(false); setValidationError(null) }}
        />
        <Input
          type="password"
          placeholder="Confirm new password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={e => { setConfirmPassword(e.target.value); setSuccess(false); setValidationError(null) }}
        />
        <div className="flex items-center gap-3">
          <Button size="sm" disabled={loading || !newPassword || !confirmPassword} onClick={handleSave}>
            Save password
          </Button>
          {success && <p className="text-xs text-emerald-500">Password updated.</p>}
          {(error || validationError) && <p className="text-xs text-destructive">{validationError ?? error}</p>}
        </div>
      </CardContent>
    </Card>
  )
}

// Legacy combined export for backwards compatibility (used by AdminTeamControls pattern)
interface Props {
  currentUsername: string
  teamId: string
  teamDisplayName: string
}

export function TeamSettingsForm({ currentUsername, teamId, teamDisplayName }: Props) {
  return (
    <div className="space-y-6">
      {teamId && <TeamNameCard teamId={teamId} teamDisplayName={teamDisplayName} />}
      <UsernameCard currentUsername={currentUsername} />
      <PasswordCard />
    </div>
  )
}
