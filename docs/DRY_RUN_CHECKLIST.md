# Surat FL — Full Dry-Run Test Plan

A sequential, top-to-bottom test of every system before the real 2026/27 season.
Work through the phases in order — later phases depend on state created earlier.
Tick each box and jot anything odd in the **Bug Log** at the bottom.

## Your setup for this run

- **You** are on **two screens**: one logged in as **`rohan` (admin)** — danger zone, gameweek simulation, full wipe — and one as **`auction_master`** — runs the auctions. Keep them side by side.
- **5 of the 7 teams** are live: each real participant logs into their **own team account on their own device**. They perform the team-side actions (declare interest, bid, fold, undo, drop, swap, set captain) when you direct them.
- **2 teams have no one logged in.** They simply **don't take part** — you'll leave them out of the auction order (see Phase 1a). They'll show as empty on standings; that's expected and fine. End Draft only checks the teams that are *in* the auction.
- **Guest view** (optional): keep a spare incognito tab logged in as **`guest`** on one of your two machines to confirm spectators see the same state read-only.

> **Brief your 5 participants first.** Tell them they'll be asked to: declare interest / pass, bid and fold in turn order, occasionally undo a bid, and — in the later mini-auctions — drop players and manage their squad. During the initial auction there's **no interest step**: their console goes straight to bidding when it's their turn.

> **Coordination is your job.** You're the AM and the conductor. Call out whose turn it is, tell specific teams when to drop players, and for the simultaneous-bid tests run a literal "3… 2… 1… tap" countdown. Most bugs that matter are about all screens showing the **same** state at the **same** time — so watch several at once.

> **Throughout:** "as a team" / "have team X do Y" means **direct that real participant** to do it on their device — you can't act as a team from your admin/AM screens.

---

## Known caveat before you start — read this

**The "Simulate Gameweek Scores" tool is for plumbing, not scoring accuracy.**
It hands random points to *all 15* rostered players (starting **and** bench) and does **not** run auto-subs. Standings sum every row, so simulated GW totals count 15 players, whereas real scoring counts only the effective XI (11 + auto-subs).

- ✅ Use it to test: standings display, drop penalties (−4s), gameweek highlights, season rollover, the points plumbing end-to-end.
- ❌ Do **not** use it to validate auto-sub logic, formation rules, or starting-XI-only scoring. Those only get exercised by a **real FPL sync against a live gameweek**, which can't happen in pre-season. Flag that as tested-on-real-data-later.

---

## Phase 0 — Clean slate & sanity

- [ ] On your **admin** screen, go to **Settings → Danger Zone → "Reset to Clean Slate"**. Confirm.
- [ ] Verify after reset: every team shows **£100.0m** budget, **0 players**, standings empty, no auction in progress.
- [ ] Confirm usernames, passwords, and team names are **unchanged**.
- [ ] Have your **5 participants log in** on their own devices now and confirm each lands on their own team's view. Confirm your **auction_master** and **guest** (optional) screens are also logged in. Note **which 5 teams** are playing — you'll need their names in Phase 1a.

---

## Phase 1 — Initial auction (draft full squads)

The big one: your **5 participating teams** each draft a complete 15-player squad. No interest phase — every eligible team is auto-enrolled into bidding for each nominated player.

### 1a. Setup
- [ ] On your **auction_master** screen, go to **Auction**. Create an auction of type **Initial**.
- [ ] Set the bid order — **include only the 5 teams that are playing**; leave the 2 absent teams out. You should see a warning that some teams aren't included; that's expected. Confirm you can reorder while it's *pending*.
- [ ] Click **Start**. Confirm status flips to **Live** and the position shows **GK**.
- [ ] Confirm on the teams' screens: only the **5 included** teams appear as bidders; the 2 left-out teams are not in the auction.

### 1b. Run GK, then DEF → MID → FWD
For each position category (GK → DEF → MID → FWD), repeat until every team's slots for that position are full:
- [ ] AM nominates a player (**Open Lot**) whose position matches the current category.
- [ ] Confirm all eligible teams appear as bidders and it's the correct team's **turn** (highlighted).
- [ ] Teams bid / fold in turn order. Watch: **can only the on-turn team act?** Others should see "waiting."
- [ ] Test **increments**: below £20m the minimum raise is **+£1m**; at/above £20m it's **+£2m**. Confirm sub-increment bids are rejected.
- [ ] Test **max bid**: a team can't bid so high it couldn't fill remaining slots at £1m each.
- [ ] Test **Undo my bid**: the current high bidder undoes before the next team acts — confirm the bid reverts and the turn returns to them.
- [ ] When one team remains, AM sees **Assign** — assign the player. Confirm budget deducts, player lands in the winner's squad (starting vs bench per formation rules), and the log updates on **all** screens.
- [ ] **Turn rotation check (important):** confirm the team that opens the *next* nomination is the next one in order who still needs that position — **not** the same team every time.

### 1c. No-winner path
- [ ] Nominate a player and have **everyone fold** (or nobody interested). Confirm the AM must click **Return to Pool** (it does not auto-close), and the player becomes available again.
- [ ] **Turn advances anyway:** confirm the *next* nomination starts with the next team in order, not the one who opened the folded lot.

### 1d. Position & squad-complete feedback
- [ ] When a team fills all its slots for the current position, that team's dashboard should say so ("… slots filled — you'll be back in once the auction moves to …").
- [ ] When the AM clicks **Advance Position** (e.g. GK→DEF), confirm the **teams'** player lists update to the new position **immediately**, without waiting for the next nomination.
- [ ] When a team fills its final **FWD** slot, its dashboard should say it's **done with the auction**.

### 1e. Close out
- [ ] With all **5 participating teams** at 15 players, AM clicks **End Draft**. Confirm it's blocked (with the names of who's short) if any of the 5 is incomplete, and succeeds once all 5 are complete. The 2 absent teams should **not** block it.
- [ ] Cross-check a couple of teams: 2 GK / 5 DEF / 5 MID / 3 FWD, total spend ≤ £100m, and player prices (`base_price`) now reflect what they were won for.

### 1f. Rollback safety (do this, then re-do 1a–1e, OR test on a later auction)
- [ ] **Before** ending the draft, as AM, try **Cancel Auction** mid-draft. Confirm budgets, rosters, and player prices all restore to the pre-auction snapshot and nothing is left half-assigned. (Then start over — or test cancel on a later mini-auction instead so you don't redo the whole initial draft.)

---

## Phase 2 — Scoring & standings (simulated)

- [ ] On your **admin** screen (**Settings → Danger Zone → "Simulate Gameweek Scores"**), simulate **GW1**.
- [ ] Go to **Standings**. Confirm the **5 playing teams** have a GW1 total and are ranked. The 2 empty teams have no rostered players, so they'll show **zero / nothing** — that's expected.
- [ ] Confirm **Gameweek Highlights** (player of the week / top team) render.
- [ ] Simulate **GW2**, then **GW3**. Confirm cumulative totals add up and rank changes (the ↑/↓ movement indicators) look right.
- [ ] Re-simulate **GW2** a second time. Confirm it **overwrites** (totals don't double-count that GW).

*(Remember the caveat: these totals count all 15 players and skip auto-subs. You're testing that scores flow, aggregate, and display — not XI/auto-sub correctness.)*

---

## Phase 3 — Squad management (team side)

Pick **one participant** and have them do this on their device (Team page):
- [ ] **Swap** a bench player into the starting XI and vice-versa. Confirm formation minimums are enforced (1 GK, 3 DEF, 3 MID, 1 FWD).
- [ ] Set a **captain** and **vice-captain**. Confirm only one of each.
- [ ] Have a *second* participant open that team's page (or use your guest tab) and confirm the changes are visible after refresh.

---

> ## Re-draft rules in force for this run
> Auctions run in real-season order: **Post-summer → Mini → Post-January**. (There are **no drops in the initial auction** — teams start empty, so dropping there is blocked.) The rule pivots on the **post-January window (≈ Feb 1)**:
> 1. **Dropped before post-January** (post-summer drop, or a pre-Jan mini drop) → re-draftable **by the same team from the post-January auction onward**. Blocked until then.
> 2. **Dropped in or after post-January** (the post-Jan auction itself, or any later mini) → **never** re-draftable by the same team that season.
> 3. **Same-window** → a team can never re-sign a player it dropped in the *same* auction (a drop resets the price to 50%, so this closes a budget exploit).
> 4. A **different** team can always re-draft a player someone else dropped.
>
> The steps below assert this. If any check behaves differently, log it.

## Phase 4 — Post-summer auction (first in-season, 3 free drops)

Real timing: end of the August transfer window (~31 Aug / 1 Sept). It's the **first** in-season auction. Gives **3 free drops**.

Pick **two of your five** participants — **Team A** (within quota) and **Team B** (will exceed quota).

### 4a. Stage drops
- [ ] On **auction_master**, create a **Post-Summer** auction. Set order — **include the 5 playing teams**.
- [ ] Confirm the free-drop quota shown is **3** (not 2).
- [ ] Have **Team A** drop **2 players** (**Mark for Drop**). Confirm each shows staged, drop price = **ceil(purchase × 0.5)**, min £1m.
- [ ] Have **Team B** drop **4 players** — one over the quota of 3 — for the penalty test.
- [ ] Have Team A **Return from Drop** one, then re-drop it. Confirm the count is right.
- [ ] Confirm a team **cannot** stage a drop with no auction window open (try before creating the auction).

### 4b. Commit & re-draft
- [ ] AM **Starts** the auction. Confirm each dropped player's roster slot is **freed**.
- [ ] AM advances to the dropped position(s) and nominates replacements. Confirm only teams **with an open slot at that position** can declare interest.
- [ ] Run the **interest phase**: teams **declare interest / pass**, then AM **Closes Interest & Starts Bidding**.
- [ ] Confirm a lot with a **single interested team** awards at **base price** without a bidding round.
- [ ] Buy Team A and Team B back to 15. **End Draft.**

### 4c. Re-draft checks
- [ ] **No drops in the initial auction:** as a sanity check, note that no team had the option to drop during Phase 1 — the post-summer auction is the **first** time dropping is possible.
- [ ] **Same-window / gate closed:** have a team that dropped a player in **this** post-summer auction try to re-sign that same player now. Expect a **block** (it's the same auction, and the post-January gate isn't open). Note this player — call them **"the post-summer drop"**; you'll re-test in Phases 5 and 6.

### 4d. Drop penalty
- [ ] On your **admin** screen, simulate the **next gameweek**. Confirm **Team B** (4 drops, 1 over quota) takes a **−4** penalty and **Team A** (within quota) does not. Confirm it shows in the GW breakdown and standings.

---

## Phase 5 — Standard mini-auction (2 free drops)

Recurring in-season transfer auction. Gives **2 free drops** (excess = −4 each).

### 5a. Quota & carryover
- [ ] Create a **Mini** auction (order = your 5 teams). Confirm the quota is **2**.
- [ ] Confirm **carryover**: a team that used *fewer* than its free drops in the post-summer auction carries at most **1** unused drop in, so its quota here may show as up to 3. Sanity-check the number.

### 5b. Same-window re-draft (the key check)
- [ ] Have **Team A** drop a player, start/commit, then have Team A try to **re-sign that same player in this same mini**. Expect a **block** — "You cannot re-sign a player you dropped in this same auction."

### 5c. Gate still closed (pre-January)
- [ ] Have the team that made **"the post-summer drop"** (Phase 4c) try to re-sign that player now, in this mini. Still **blocked** — the post-January auction hasn't happened yet, so the gate is closed. Message should mention re-drafting is only allowed from the post-January window onward.
- [ ] **Different-team check:** have a *different* team try to sign that same post-summer-dropped player. It should be **allowed** — the restriction only applies to the team that dropped him.

### 5d. Finish
- [ ] Buy affected teams back to 15. **End Draft.**

---

## Phase 6 — Post-January auction (3 free drops)

Real timing: after the January window closes (early February). Gives **3 free drops**.

- [ ] Create a **Post-Jan** auction (order = your 5 teams). Confirm quota is **3**.
- [ ] **Gate now OPEN — the key check:** have the team that made **"the post-summer drop"** (Phases 4–5) re-sign that player now. It should **succeed** — reaching the post-January auction opens the gate for pre-January drops. *(This is the whole point of the gate timing.)*
- [ ] **Post-January permanent ban:** have a team drop a player in **this** post-Jan auction, then confirm that team can **never** re-sign them — not here, and not in a later mini. (A *different* team still could.)
- [ ] **Same-window still blocked:** confirm a team can't re-sign a player it dropped in **this** post-Jan auction.
- [ ] Finish the drop → commit → re-draft → end-draft loop and **End Draft**.

> **Optional — post-Feb permanence:** if you run one more **Mini** auction after this, confirm a player dropped in *that* post-January-era mini is also **permanently** un-re-draftable by the same team (anything dropped once the post-January auction has happened is permanent).

---

## Phase 7 — Concurrency & edge cases

You have **5 real, independent devices** here — that's the ideal setup for this, since the races are genuine rather than simulated. Run these during any of the auctions above (or spin up a throwaway mini-auction for them).

- [ ] **Simultaneous bids:** pick two teams whose turn is coming up. When it's one team's turn and another is about to be, run a **"3… 2… 1… tap"** countdown and have both hit **Bid** together. Also try the same team double-tapping Bid. Confirm exactly **one** bid is accepted and no screen shows a corrupted price or turn.
- [ ] **AM-assign vs. bid race:** when a lot is down to the pending winner, on your **AM screen** click **Assign** at the same moment you tell a still-active team to **Bid**. Confirm the outcome is consistent on **every** screen (either the bid landed and that team can still be assigned, or the assign took the prior price — never a mismatch between screens).
- [ ] **Undo last assignment (AM):** right after assigning a player, on the AM screen click **Undo last assignment**. Confirm budget, roster, player price, and the lot all revert on all screens, and the lot can be re-assigned or returned to pool.
- [ ] **Mid-auction refresh:** have one participant hard-refresh their browser mid-lot. Confirm they recover the correct live state, don't double-submit, and the turn indicator is still right.
- [ ] **Live position advance:** while teams are watching, AM clicks **Advance Position** — confirm every team's player list switches to the new position **immediately**, with no manual refresh.
- [ ] **Guest view** throughout — confirm your guest tab is read-only, sees the same bids/log as everyone, and has no action buttons.

---

## Phase 8 — Auth & settings

- [ ] Have a participant change their **team name** (Settings). Confirm it updates across standings/auction on the other screens. *(If they change it, remember to change it back before the real season — or just note it.)*
- [ ] Have a participant change their **password**; they log out and back in with the new one. *(Have them set it back afterwards so their real-season login still works.)*
- [ ] On your **admin** screen, create a new user (CreateUserForm) and confirm the role/team assignment works, then confirm that login. *(Delete or ignore this throwaway user afterwards.)*
- [ ] Confirm a **team** account **cannot** reach admin/AM controls — ask a participant to try to open Settings' danger zone or create an auction; the buttons/pages should be hidden or blocked.

---

## Phase 9 — Season rollover (final)

- [ ] As **admin → Danger Zone → "Reset to Clean Slate."** Confirm: rosters, budgets, scores, drops, and player base prices all reset; **usernames, passwords, and team names survive**.
- [ ] Confirm the app is back to the Phase 0 clean state, ready for the real season.

---

## What this dry run does NOT cover (test on live data later)

- **Real FPL scoring**: auto-subs (non-playing starter → bench in priority order), formation-valid substitutions, and starting-XI-only points. The simulator can't exercise these. Do **one manual scoring sync of a real, completed gameweek** early in the season and eyeball a team's points vs the official FPL numbers.
- **The daily scoring cron** firing on its own schedule against a live GW.
- **FPL player-list refresh** at the August/January transfer deadlines (adds/updates players; must not reset auction-won prices — verified in code, worth a glance on real data).

---

## Bug Log

| # | Phase/Step | What you did | What you expected | What happened | Screens affected |
|---|-----------|--------------|-------------------|---------------|------------------|
| 1 |           |              |                   |               |                  |
| 2 |           |              |                   |               |                  |
| 3 |           |              |                   |               |                  |

> For anything in here, note the **auction log** entries and the affected **gameweek/team** — they're the best forensic trail for me to trace a fix.
