# Surat FL — Open Questions

All questions have been answered. This file is kept as a reference log.

---

## ✅ Resolved — Complete Reference Log

| # | Topic | Answer |
|---|---|---|
| 1 | Role hierarchy | **Admin is a superset of AM.** An admin has all AM rights. An AM cannot be admin. One account can hold the admin role and inherit all AM permissions. |
| 2 | Bid increments | +£1m minimum when current bid < £20m; +£2m minimum when current bid ≥ £20m |
| 3 | Bidding order | Must raise or pass; fold = eliminated for that player; ends when one team remains |
| 4 | Undo scope | **10 moves**; includes player assignments, timer resets, bid corrections; undo reverses assignment + refunds budget |
| 5 | Guest sessions | Browser close = sign out; unlimited concurrent guests; real-time auction view |
| 6 | Starting XI | 11 starting + 4 bench; minimums only enforced (no strict formations); bench has numbered priority order |
| 7 | Deadlines | Auto-lock at FPL gameweek deadlines via FPL API integration |
| 8 | Points & scoring | Real FPL points; leaderboard/standings page; calculated from starting XI of 11. Auto-sub rules apply (see Q15). |
| 9 | Auction types | Initial: all ~700 players; Mini: dropped + undrafted; AM decides when; post-Jan special rules apply (see Q16) |
| 9a | Transfer quotas | First in-season auction: 3 free; post-Jan auction: 3 free; all other mini-auctions: 2 free; max 1 rollover |
| 10 | Teams | Fixed at 7 |
| 11 | Budget / currency | £100m per team; **£** symbol throughout the app |
| 12 | Player stats in console | Position, Club, Injury/status, Total FPL points, Goals, Assists, Clean sheets, Bonus points, Yellow/Red cards, Minutes played, Defensive contribution points. **No** % selected or FPL price. |
| 13 | Login format | Username + password (not email); teams can update credentials after first login |
| 14 | Auction order source | First auction = previous year's standings (set manually in DB); subsequent = live standings confirmed manually by AM before each auction |
| 15 | Scoring sync | Automatic weekly sync after each GW ends + manual trigger by Admin/AM. Auto-sub rules: bench players replace non-playing starters in priority order (formation rules respected). -4 pt drop penalty deducted at end of the gameweek. |
| 16 | Re-draft restrictions | **(a)** General rule: a team cannot re-sign a player they dropped in the **same auction window**. **(b)** Pre-Jan drops: team can only re-draft after the **first January auction has started**. **(c)** Post-Jan drops: team can **never** re-sign that player for the rest of the season. |
| 17 | Auction order setup | First auction: manually set `auction_order` in database (no UI needed). Subsequent auctions: AM confirms the order manually before each auction starts. |
