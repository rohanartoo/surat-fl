@AGENTS.md

# Surat FL — Project Context

## What this is
A private fantasy football league app for 7 teams, built on top of FPL (Fantasy Premier League) data. Teams draft real FPL players via a live auction, manage their squad, and score points based on real FPL gameweek results.

Tech stack: Next.js 16 (App Router), Supabase (Postgres + Auth + Realtime), Tailwind CSS, shadcn/ui.

## Key files to orient yourself
- `docs/INITIAL_IMPLEMENTATION.md` — the full feature spec and phase plan. **All planning goes here.**
- `memory/project_phase_status.md` — which phases are complete and what's pending.

## Auth
- Users log in with a **username + password**. Email is hidden from the UI.
- Under the hood, Supabase stores the email as `username@surat-fl.internal`.
- Changing a username requires updating both `profiles.username` and `auth.users.email` via the Admin SDK (`supabase.auth.admin.updateUserById`).
- Role hierarchy: `admin ≥ auction_master ≥ team ≥ guest`. All checks are in `src/lib/roles.ts`.

## Scheduled endpoints
- `POST /api/fpl/sync` and `POST /api/scoring/sync` use `Authorization: Bearer SYNC_SECRET` for scheduled cron triggers.
- Admin session auth is also accepted on these routes for manual triggers.
- Do not add cookie-based session auth as the primary guard on these routes.
