# Buds League History

Public history site for ESPN fantasy football league **436050287**.

**Website:** https://brian732.github.io/buds-league-history/

Uses the original league site's design and features: standings, trophies, all-time records, sortable/filterable regular-season and playoff records, full head-to-head matrix, rivalry comparison and game log, owners, seasons, record book, rulebook, commissioner history, personal appearance settings, shared photos, and editing of profiles/recaps/awards.

## Verified coverage and ownership

The ESPN archive covers 2021–2026 through Week 8 of 2026. Every team's seasonal W/L/T, points for and points against reconciles with completed ESPN matchup results: **365 regular-season games** and **20 championship-bracket playoff series**. Multiweek playoff series count once. Consolation games are excluded from playoff records.

Tom Ribaudo owned team 2 in 2021, and Jacob Lavigne took over in 2022. The user confirmed Tom should be excluded from visible history, owner profiles and head-to-head results. Other owners' games against him remain in their overall records. As a result:

- Jacob has **60** regular-season games (2022–2025: 52; 2026: 8).
- The other nine listed owners have **73** regular-season games (2021–2025: 65; 2026: 8).
- Head-to-head history contains **352** regular-season games between listed owners; the 13 games involving the excluded owner are omitted on both sides.
- The 2021 season table shows only listed owners, while retaining their complete regular-season records.

The ownership policy is explicit in `scripts/ownership-policy.json`; do not transfer the excluded owner's games to Jacob or change the policy based on reused team IDs. No account aliases are inferred from team names.

## Data maintenance

The ESPN league is private. The site uses imported data, and does not contain ESPN cookies, credentials, notifications, player rosters or account contact information. It does not refresh private ESPN data unattended. Commissioner history, fees, payouts and punishments are unrecorded until supplied.

Place sanitized ESPN season responses in the ignored `imports/YYYY.json` files and run `python3 scripts/import-espn.py` to reconcile and regenerate the data. Keep every historic season and preserve the ownership policy. The importer preserves written bios, display names, photos, recaps and awards. Current rulebook entries reflect the 2026 ESPN settings.

## Shared photos and editing

The site is served by GitHub Pages from the main branch's root. Shared profile photos are resized and saved in `data/league.json` so every visitor sees them. The Commissioner’s desk supports draft, preview, download and publication.

Publication uses GitHub's Contents API. A fine-grained token needs **Contents: Read and write** access to **brian732/buds-league-history**. Tokens are sent only to GitHub and cleared after each attempt; they are never saved in browser storage or source. Anyone may view and draft locally; GitHub enforces write authorization. File SHA and field conflict checks protect concurrent edits. Scores and owner IDs cannot be changed through the editor.

Edit `data/league.json` on GitHub directly if preferred. Committing changes triggers GitHub Pages deployment. Browser-only preferences use league-specific keys to avoid changing settings for the original site.

## Checks

- `node scripts/test-history.cjs`: 365 overall games, 352 head-to-head games, 20 playoff series, ownership exclusions, season/competition filters, points, GP counts and zero-title rows.
- `node scripts/test-customization.cjs`: edit validation, shared images, Unicode, protected records, conflicts, token clearing and mocked GitHub publication.
- `python3 -m http.server 8767 --bind 127.0.0.1`: local preview; open http://127.0.0.1:8767/.

No dependencies or build step. Do not publish `imports/` or any private ESPN authentication data. This repository is separate from `brian732/theleague-history`.
