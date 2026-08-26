import { permanentRedirect } from "next/navigation"

/**
 * Merged into /dashboard (2026-08-25). This page rendered the same
 * StandingsTable with the same props as the Overview page, so for everyone
 * but an admin it was a strict subset of the landing page; the admin-only
 * "Sync GW points" form it uniquely carried now lives on /dashboard, directly
 * above the table it updates.
 *
 * Kept as a 308 rather than deleted so pre-season bookmarks still resolve.
 */
export default function StandingsPage() {
  permanentRedirect("/dashboard")
}
