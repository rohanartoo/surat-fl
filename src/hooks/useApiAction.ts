"use client"

import { useState } from "react"

/**
 * Shared hook for POST API actions with loading + error state.
 * Returns true if the request succeeded, false otherwise.
 */
export function useApiAction(basePath: string) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function post(action: string, body: object = {}): Promise<boolean> {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${basePath}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.")
        return false
      }
      return true
    } finally {
      setLoading(false)
    }
  }

  return { post, loading, error, setError }
}
