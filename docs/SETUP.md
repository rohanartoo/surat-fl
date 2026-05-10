# Surat FL — First-Time Setup Guide

Follow these steps in order. Do not skip ahead.

---

## Step 1 — Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign in
2. Click **New project**
3. Choose your organisation, give the project a name (e.g. `surat-fl`), pick a region close to you, and set a strong database password
4. **Save the database password somewhere safe** — you will need it if you ever connect directly to Postgres
5. Wait for the project to finish provisioning (usually ~1 minute)

---

## Step 2 — Get Your Project Credentials

1. In the Supabase dashboard, go to **Project Settings → API**
2. Copy the following values — you will need them in Steps 4 and 6:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **anon / public** key (long JWT string under "Project API keys")
   - **service_role** key (below the anon key — keep this secret, never commit it)
3. Also note your **Project Reference ID** — it's the short alphanumeric string in your dashboard URL: `https://supabase.com/dashboard/project/YOUR-PROJECT-REF`

---

## Step 3 — Configure Supabase Auth Settings

In the Supabase dashboard, go to **Authentication → Settings** and make the following changes:

1. **Disable "Enable email confirmations"** — we use internal `@surat-fl.internal` emails and don't want confirmation emails sent
2. **Disable "Secure email change"** — username changes must work without email verification
3. **Enable "Data API"** — required for supabase-js to work
4. **Disable "Automatically expose new tables"** — RLS policies are managed explicitly in migrations
5. **Disable "Automatic RLS"** — RLS policies are already defined in the migrations

Click **Save** after each section.

---

## Step 4 — Install the Supabase CLI and Link Your Project

In your terminal, run:

```bash
brew install supabase/tap/supabase
```

Then log in and link to your project:

```bash
supabase login
supabase link --project-ref YOUR-PROJECT-REF
```

Replace `YOUR-PROJECT-REF` with the reference ID from Step 2.

---

## Step 5 — Run the Migrations

This applies all the SQL files in `supabase/migrations/` to your live Supabase database in order:

```bash
supabase db push
```

When it completes, go to **Table Editor** in the Supabase dashboard and confirm you can see tables like `profiles`, `teams`, `players`, `auctions`, etc.

---

## Step 6 — Deploy to Vercel

Production credentials are set directly in Vercel — they never need to live in any local file.

1. Go to [vercel.com](https://vercel.com) and sign in
2. Click **Add New Project** and import your GitHub repo (`surat-fl`)
3. Before clicking Deploy, go to **Environment Variables** and add the following:

| Name | Value |
|------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Project URL from Step 2 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your anon/public key from Step 2 |
| `SUPABASE_SERVICE_ROLE_KEY` | Your service_role key from Step 2 |
| `SYNC_SECRET` | Any random string (e.g. `surat-sync-2026`) — used to authenticate the scoring sync cron job |

4. Click **Deploy**

Vercel will give you a public URL (e.g. `https://surat-fl.vercel.app`). This is the URL you share with the other teams.

---

## Step 7 — Seed the Teams Table

The 7 teams need to exist in the database before you can assign accounts to them.

1. Go to **Table Editor → teams** in the Supabase dashboard
2. Insert a row for each of the 7 teams with the following columns:
   - `display_name` — full team name (e.g. `Rohan FC`)
   - `short_name` — 3–4 letter abbreviation (e.g. `RFC`)
   - `budget` — `100` (starting budget in £m, do not change)
   - `color` — a hex colour string used in the standings table (e.g. `#3b82f6`)
   - `auction_order` — leave as `null` for now; the Auction Master sets this before the first auction

---

## Step 8 — Create Your Admin Account (via Supabase Dashboard)

This is the only step that requires the Supabase dashboard directly. You need one admin account before the in-app Create User form is accessible.

### 8a — Create the auth user

1. Go to **Authentication → Users** in the dashboard
2. Click **Add user → Create new user**
3. Set the email to: `yourusername@surat-fl.internal` (e.g. `rohan@surat-fl.internal`)
4. Set a password
5. Make sure **"Auto Confirm User"** is ticked
6. Click **Create user**
7. Copy the **UUID** shown for the new user — you need it in the next step

### 8b — Set up the profile row

1. Go to **Table Editor → profiles**
2. Check if a row already exists for your UUID (a database trigger may have created a skeleton row). If it does, click the row to edit it. If not, click **Insert row**.
3. Set the following columns:
   - `id` — the UUID from Step 8a
   - `username` — your username in lowercase with no spaces (e.g. `rohan`)
   - `display_name` — your display name (e.g. `Rohan`)
   - `role` — `admin`
   - `team_id` — leave as `null`
4. Save the row

---

## Step 9 — Log In and Sync FPL Player Data

1. Go to your Vercel URL and log in with the username and password from Step 8
2. You should land on the dashboard with full admin access
3. Trigger the FPL player sync so the players table is populated before the auction. Run this from your terminal:

```bash
curl -X POST https://your-vercel-url.vercel.app/api/fpl/sync \
  -H "Authorization: Bearer your-sync-secret"
```

Replace `your-sync-secret` with the value you set for `SYNC_SECRET` in Step 6.

This fetches all ~700 Premier League players from the FPL API. Re-run it any time you want updated player stats.

---

## Step 10 — Create the 7 Team Accounts

1. Go to **Settings** in the nav (bottom of the sidebar)
2. Scroll to the **Create User Account** section at the bottom (admin-only)
3. For each team, fill in:
   - **Display Name** — their name as shown in the app (e.g. `Rohan Shah`)
   - **Username** — their login username, lowercase, no spaces (e.g. `rohan`)
   - **Temporary Password** — something you will share with them privately (min 8 characters)
   - **Role** — select `Team`
   - **Assign to Team** — select their team from the dropdown (the teams you created in Step 7)
4. Click **Create Account**
5. Share the Vercel URL, username, and temporary password with each team owner privately
6. They log in, go to **Settings**, and change their password

Repeat for all 7 teams.

---

## Done

Once all accounts are created and team owners have logged in and set their own passwords, the app is ready. The Auction Master can set the auction order and start the initial draft whenever the league is ready.

You can delete this file once setup is complete.
