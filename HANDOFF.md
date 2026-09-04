# HANDOFF

**2026-09-03 — Claude Code (Fable 5.1)**

## Task / State
Close two known risks: receipts blowing the localStorage cap, and family names splitting on casing.
UNCOMMITTED, verified locally in browser (python http.server on :8765). Not pushed. SW bumped to v39.

- Receipts now persist in IndexedDB (`tutor-tracker` / store `receipts`) via new `js/receipt-store.js`.
  `App.state.receipts` is unchanged for every renderer. Legacy `tutoring-receipts` localStorage
  key migrates on first load and is removed only after the IndexedDB write confirms.
  `App.receiptsReady` gates Gist push. IDB failure -> localStorage fallback + push blocked.
- Family labels: `App.canonicalFamily()` on save joins an existing spelling case-insensitively;
  `migrateData()` merges existing variants to the most-used spelling (ties: first seen).

## Verified (browser, 2026-09-03)
Migration, coalesced double save, reload persistence, delete, clear-all, mid-load pull, simulated IDB failure (sync blocked, localStorage fallback), family merge Smith/smith -> Smith.

## Unverified
Real device with ~3.4 MB of receipts (only synthetic 1px images tested). Safari private mode.

## Next step
MTH: "Ship it" to deploy, then on live site unregister SW + hard refresh, open Expenses and
confirm thumbnails render and DevTools > Application > IndexedDB > tutor-tracker has rows.
Branch protection on main is still OFF (checked via gh api) — MTH's call.

## Files touched
js/receipt-store.js (new), js/app-core.js, js/sync.js, js/clients.js, index.html, sw.js,
CLAUDE-INSTRUCTIONS.md, README.md, SECURITY-PRIVACY.md
