# 2026-10-11 — Slice C: "Usual" quick-pick tiles on the session form (Claude Code, Fable 5.1)

**State: built and verified on local branch `slice-c-usual-tiles` (one commit on top of `main` 55ede45). NOT pushed. "Ship it" is MTH's gate.**

## 1. What it does

Above the Client(s) picker in the Add Session form there is a new "Usual" row: up to 5 pill tiles such as
`Client Alpha + Client Beta · 2h · $300.00 · in-person · Tue`. One tap fills clients, duration, type, amount and
time. Date, status, payment and mileage are left exactly as the form had them. Add → tap tile → Save = 3 clicks.

- Source of truth: `App.sessionSignatures` (Slice A, `protected/js/signatures.js`). Nothing new is stored.
- Ranking: frequency in the last 90 days (ties: most recent), then all-time frequency for combos not already listed.
- A tile is offered only when every member is an active client (the picker could not select anyone else).
- Cancelled / no-show rows never count (same rule as Slice A). The "usual days" suffix appears only when a clear pattern exists (≤3 days with at least half the busiest day's count).
- The tile that matches what the form currently holds shows a ✓; changing a client, duration, amount or type un-ticks it.
- Hidden while editing an existing session, and when nothing is usual yet. "Repeat last session" is untouched and still appears alongside.

## 2. Files

- `protected/js/signatures.js` — new pure `usualWeekdays`, `usualTiles` (exported as `App.usualTiles` and in `App.weekPlan`). Still no DOM / state / storage.
- `protected/js/sessions.js` — `renderUsualTiles`, `syncUsualTiles`, `pickUsualTile`, `usualTileLabel`; called from `openSessionForm` and `updateSessionPrefill`.
- `protected/js/ui.js` — one click case `pick-usual`.
- `protected/index.html` — `#session-usual-group` / `#session-usual` block above `#session-clients`.
- `protected/styles.css` — `.usual-tiles`, `.usual-tile` (pill, wraps at narrow widths).
- NEW `tests/usual-tiles.test.cjs` — 8 tests (pure ranking/weekdays/label, the 3-click flow through the real ui.js delegation, editing hides tiles, empty data, source guards).
- `repository.js`, storage keys, schema, `SECURITY-PRIVACY.md`: untouched. No new localStorage key.

## 3. Verification

- `node --test`: 206/206 (was 198). `node --check` on every `protected/js/*.js` clean. `node tests/slice1/static-guard.cjs` PASS.
- MUTATION-VERIFIED (each applied, watched red, restored byte-identical by SHA-256):
  1. all-time ranking placed before the 90-day window → 4 red.
  2. active-member filter dropped → 4 red.
  3. tile tap stops filling time → 2 red.
  4. tiles painted while editing → 2 red.
  5. `pick-usual` click case removed from ui.js → 4 red.
- OBSERVED on the fabricated preview (`preview_start` protected-static, 127.0.0.1:8877, Slice B's store at revision 11, dark theme, 1024 px and 640 px, light theme spot-checked via `data-theme`):
  - Add Session shows the Usual row with 2 tiles (`Fixture Beta · 1h · $123.46 · in-person`, 4 sessions on file; `… $50.00 … Wed`).
  - Tap tile 0 → client tile pressed, duration 1, 60-min chip lit, amount 123.46, type in-person, ✓ on the tile, Repeat-last banner still shown, date untouched.
  - Save → revision 12 → 13, +1 row, stored row = {date today, clientIds ['102'], 1 h, $123.46, in-person, completed, unpaid, mileage 0}.
  - Three fabricated 2-client rows were added to the preview store (revision 11 → 12) to test a combo tile; it correctly did NOT appear because the second fixture client is not active.
  - 640 px: tiles wrap, no horizontal overflow in the row.
  - First render of the ✓ was garbage: the CSS escape had been written through a shell heredoc and came out as raw bytes (one NUL). Fixed before commit; computed `::before` content now reads "✓ ".
- NOT observed: real data (whether the tiles match MTH's real combos is the open real-data question in the roadmap §6); the browser cache note from Slices A/B still applies: hard-refresh once after deploy.

## 4. Rulings made (veto in one word)

1. Tiles need every member active. Veto: "Any" (then tiles for paused/inactive members would select nobody).
2. Time is filled from the tile's most common start time, blank if the combo has none. Veto: "Keep time".
3. Tile count capped at 5, labels use full client names (no C2/C7 codes). Veto: "Short".
4. No weekday restriction on ranking: a Tuesday combo is offered on a Saturday too. Veto: "Weekday".

## 5. Next

- MTH: "Ship it" (fleet authorization file), hard-refresh once, open Add Session on real data and see whether the top tiles are his real combos.
- Then Slice D (family payment intake + statement PDF).
