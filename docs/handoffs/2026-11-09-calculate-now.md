# 2026-11-09 — Mileage "Calculate now" (offline scan + review) replaces "Calculate mileage by day"

Tool: Claude Code, Fable 5.1 (subagent in an isolated worktree, branch `worktree-agent-a6e5733b65fa16024`). State: **BUILT, UNCOMMITTED, NOT pushed**; the primary reviews the diff. Design approved by MTH beforehand; this doc records what was built and where it deviates.

## Why

The old More > Mileage / Settings "Calculate mileage by day" re-routed every writable row in all history on each click (on real data: 73 rows over 55 days, 68 of them locked) and copied whatever OpenRouteService answered that day. On 2026-11-08 ORS returned 19.2 mi for a home -> client leg that had been 12.9 on every earlier row. Separately, a leg went stale when a second stop was added to a day after the first had been calculated. A route table in settings is not an option: `finalize()` copies settings into every locked row (`repository.js` ~526) and `reconcileSnapshots` demands settings equality (~251).

## What changed (one sentence)

A visible **Calculate now** button on the Sessions toolbar (and the same action in Settings) scans every day offline against the owner's own earlier legs, asks ORS only for a leg shape history cannot answer, lists each proposed change in a review modal, and writes only the ticked rows.

## Rules (as built, `protected/js/mileage.js`, all exposed on `App.mileage`)

- **Shape** = (previous stop's address or home, this address, last stop or not), from the existing `dayStops` order (`dayShapes`).
- **Consensus** (`shapeConsensus`): rows whose `mileageDetails` equals the exact `Leg i of n[ + return home] (driving route, day order)` label for their actual day position vote, grouped at 0.1 mi; known = the single most common value with 2+ rows; a tie or fewer than 2 rows = unknown. Mislabelled rows never vote.
- **Needs work** (`rowIssue`, writable rows only = `isAutoMileage`): `blank` 0 mi; `stale` label does not fit the day (position, count, last-ness, or an older tool label); `jump` label right, shape known, more than 10% off (`JUMP_RATIO`). 10% or less: no change, no flag.
- **Proposal**: known shape -> history value, no lookup; unknown -> real ORS legs via `routeMiles` (only the legs that stop needs), tagged "New route, check it". Never an estimate. No proposal when label is right and miles already within 0.05 (`SAME_MILES`).
- **Write** = `{mileage, mileageCalculated:true, mileageManual:false, mileageDetails}` with the correct label; unlocked -> `session.update` per row, locked -> one `session.correctMany` (same pattern as before, `applyProposals`). Manual and root-app "(real route)" rows are never written but still shape the day.
- **Skipped days**: 2+ stops with a blank time (no order) or any stop without an address. Counted only when a writable row there is blank, carries a foreign label, or the wrong `n` (`roughIssue`); a blank-time day whose labels all fit is left alone silently (ruling R1 below).

## Flow

Click -> `planCalculateNow()` (offline). Nothing -> info toast (warning when days were skipped). Only known shapes -> review modal straight away, no key needed. Any lookup -> `requireMileageSetup`, then one confirm stating the session count and "Up to N addresses go to OpenRouteService" (the 2026-09-15 disclosure kept) and how many other changes are answered offline; lookups run per day with the button disabled and showing progress; a fatal ORS error toasts and writes nothing, a day with no route is skipped and counted. Review modal `#modal-calc-now`: date + time, client last name(s), old -> new miles, tag (Blank / Day changed / Jump / New route, check it; Jump amber, New route red), checkbox ticked by default; **Save selected** / **Cancel** (Cancel = `close-modal`, writes nothing). Save closes the modal, writes the ticked rows, `runCommand` re-renders and reports a stale revision as before, then one toast with written / left-alone / skipped counts. Every client-supplied string goes through `escapeHtml`; actions are `data-action="calc-now"` and `calc-now-save` in `ui.js` (CSP, no inline handlers).

## Rulings (veto-able, delegated)

| # | Ruling | Why |
|---|---|---|
| R1 | A skipped day is **counted** only when a writable row there visibly needs work (blank, foreign label, wrong `n`). | Otherwise every historical multi-stop day with one blank time would inflate the count forever although nothing is wrong. |
| R2 | The old `calculateMileageByDay` / `runCalculateMileageByDay` were **deleted**, not hidden. | Brief: not reachable from the UI; dead code fails the repo's own sweeps. |
| R3 | Toolbar order: Filters / More / **Calculate now** / Add Session (button after the More menu, with the pin icon the session form already uses). | Tools left, primary action right; the pin icon is the mileage glyph the owner already knows. |
| R4 | A row whose label is right and whose 0 mi is also the known value (same address as the previous stop) is never proposed. | The 0.05 rule; avoids an endless 0 -> 0 proposal. |
| R5 | No `?v=` cache-bust added. | The repo does not version `mileage.js`/`ui.js`/`styles.css` (only `historical.js?v=2`); deploy checklist = MTH hard-refreshes once. |
| R6 | `SECURITY-PRIVACY.md` §2 item 1 still says Settings > "Calculate mileage by day". **Not edited** (published privacy text is MTH-only). | Needs one word change to "Calculate now"; the disclosure itself (confirm with counts, addresses sent, key in header) is unchanged and still true. |

## Files

- `protected/js/mileage.js`: new CALCULATE NOW block (`dayShapes`, `shapeConsensus`, `rowIssue`, `roughIssue`, `planCalculateNow`, `toProposal`, `lookupStops`, `calculateNow`, `runLookups`, `proposalWho`, `openReview`, `saveCalculateNow`, `applyProposals`, `legLabel`); `planDay` uses `legLabel`; pin-button toast now points at Calculate now; old tool removed; `App.mileage` chokepoint extended.
- `protected/js/ui.js`: `calc-mileage-by-day` case -> `calc-now` + `calc-now-save` (2 lines).
- `protected/index.html`: More > Mileage removed; toolbar Calculate now button; Settings button + hint rewritten; new `#modal-calc-now`.
- `protected/styles.css`: `.calc-now-table`, `.calc-now-miles`, `.calc-tag` + blank/jump/new colours (11 lines).
- `tests/sessions-layout-pins.test.cjs`: toolbar pin re-pinned (direct actions `toggle-filters, calc-now, add-session`; More = Edit Mode + CSV; no `calc-mileage-by-day` anywhere; 2 `calc-now` buttons) and the wiring test now covers `calc-now` + `calc-now-save`. These are the only pre-existing pins changed.
- NEW `tests/calculate-now.test.cjs` (11 tests).
- This doc; `HANDOFF.md` pointer.

## Tests

- `node --test`: **268 / 268** (was 257; +11). `node --check protected/js/mileage.js ui.js`: clean. Static writer guard PASS (first draft failed it: annotating the stop wrappers in place reads as a record mutation; rewritten to build fresh objects).
- Mutation-verified (scratch script, file restored byte-identical, SHA-256 checked):
  - M1 manual guard dropped from `isAutoMileage`: 10 pass / 1 fail (manual-rows test).
  - M2 `JUMP_RATIO` 0.1 -> 0.05: 10 / 1 (detection test: 13.9 flagged).
  - M3 consensus `>= 2` -> `>= 1`: 10 / 1 (single row became known).
  - M4 label filter dropped from the consensus vote: 9 / 2 (4 mislabelled rows at 30 outvoted 3 correct at 12.9; manual test also red).
  - M5 `.filter(el.checked)` -> all rows: 10 / 1 (unticked locked row written).
- Baseline note: in this worktree the vendor hash test failed before any change because the checkout had converted `protected/vendor/reporting/*` to CRLF (`core.autocrlf=true`); restored to LF bytes with `git -c core.autocrlf=false checkout`, no repo change, `git status` clean apart from this feature.

## Real-data dry run (read-only scratch script, recovery file of 2026-11-08 r200, events overlaid per `applyEvents`)

167 sessions, 111 drive-stop days, 8 known shapes, 0 skipped days. Exactly the 9 expected rows (clients lettered here; the report to MTH names them):

| Date | Client | Old -> new | Tag |
|---|---|---|---|
| 2026-09-22 | A | 5.7 -> 3.0 | Day changed (locked) |
| 2026-10-06 | B | 12.9 -> 26.6 | Day changed (locked) |
| 2026-10-12 | C | 14.8 -> 8.4 | Day changed (locked) |
| 2026-10-13 | A | 5.7 -> 3.0 | Day changed (locked) |
| 2026-11-09 | B | 19.2 -> 12.9 | **Jump** (open) |
| 2026-11-10 | A | 5.7 -> 3.0 | Day changed (open) |
| 2026-10-14, 10-21, 11-04 | D | 9.0 -> ORS | New route (3 lookups, 3 addresses to ORS) |

## Observed in the built-in browser (fabricated preview on localhost:8766 served from this worktree, dark, 1100 px, fabricated client/sessions seeded through the app's own commands)

- Toolbar shows Filters / More / Calculate now / Add Session; More = Edit Mode, CSV.
- Click Calculate now -> review modal with 2 rows (Nov 3 19.2 -> 12.9 Jump; Nov 12 0.0 -> 12.9 Blank), both ticked, note "3 days skipped (...)" for the fixture's address-less rows.
- Untick Jump, Save selected -> revision 7 -> 8, table shows 12.9 mi on the scheduled row, Nov 3 keeps 19.2, toast "Mileage set on 1 session. 1 left as it was. 3 days skipped (no time order or no address)."
- Run again, Save -> revision 9, one `correction` event on the locked Nov 3 row (original 19.2 kept on file, view 12.9), planner then proposes nothing. Zero console messages.

## UNVERIFIED

- The ORS path in a browser (confirm -> lookups -> "New route" rows): Node-tested with a mocked `fetch` only; no key in the preview.
- Real data: the dry run is read-only; nothing has been written to MTH's store. The 2026-10-06 (B) 12.9 -> 26.6 and 2026-10-12 (C) 14.8 -> 8.4 changes are what the day-order rule says; MTH should eyeball them in the review before ticking.
- Light theme, print, narrow widths (desktop-only app by ruling).
- `SECURITY-PRIVACY.md` wording (R6) awaits MTH.

## Next

1. Primary reviews the diff in the worktree; MTH reads the rulings.
2. MTH: "Ship it" -> commit + push from his terminal, hard-refresh, Sessions -> Calculate now, review the 9 rows, tick, Save selected.
3. MTH: one-word edit to `SECURITY-PRIVACY.md` §2 item 1 ("Calculate mileage by day" -> "Calculate now").
