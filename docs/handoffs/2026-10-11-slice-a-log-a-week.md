# 2026-10-11 — Slice A: "Log a week" grid + "Repeat last week" (design contract + closeout)

Tool: Claude Code, Fable 5.1. Branch `log-a-week` off `main` @ `2a5c4b0`. Nothing pushed. Roadmap: `~/.claude/plans/stateless-bouncing-codd.md` §3 Slice A.
Fabricated fixtures only (public repo). Real data was read once, read-only, for the open item below; no names copied.

## 0. Open item checked first: the three "un-auto-completed" rows — NOT A BUG

The 2026-09-30 backup shows three pre-activation (archived) rows dated 09-15 / 09-22 / 09-29 with STORED `status: 'scheduled'`.
Archived originals are immutable by design (`repository.js` `validateTransition`: "Archive replacement forbidden"), so their outcome lives in append-only events.
Applying `App.recordPolicy.applyEvents` (`record-policy.js:40-48`) to those rows gives the read view the app actually shows:

| stored | events on the row | read view |
|---|---|---|
| 09-15 scheduled | correction(status), 2× correction(mileage), payment | completed, paid |
| 09-22 scheduled | 2× correction(mileage), status, payment | completed, paid |
| 09-29 scheduled | mileage + amount + 3× status corrections, payment | completed, paid |

The plan's data pass read stored status, not the overlay. Auto-complete (`sessions.js:921-945`) never needed to fire: each row was completed by hand (pencil correction or the Status select) and then paid. Nothing to fix; the plan's §1 "Things to check" bullet is closed.

## 1. Blast-radius map (traced to live code)

Writer / chokepoint
- `protected/js/repository.js:565-577` `session.correctMany` is the pattern. NEW `case 'session.saveMany'` goes right after it (one case; `default:` at `:610` stays byte-identical, anchored by `tests/slice1/repository.test.cjs:216`).
- Per record it reuses `index`, `mergeRecord` (`:471`), `validateNewSession` (`:497`), `finalize` (`:490`). The draft is sealed once (`:613-617`) → one revision, one hash, one CAS (`:615`).
- `validateTransition` (`:132`) enforces revision+1, archive untouched, finalized immutable, events append-only. Unchanged.

Readers the new rows reach (no change needed; rows are plain `session.save` shapes)
- Sessions table / month view / Owed panel: `sessions.js:102` `renderSessions`, `app-core.js:434` `computeOwedByFamily`.
- Reports/Tax/Dashboard via `App.reportModel` (read-guard `tests/slice3/read-guard.test.cjs` untouched; the new module is operational UI, not a report reader).
- Auto-complete on load (`sessions.js:928-932`) picks up grid rows like any other scheduled row.
- Mileage by day (`sessions.js:1100+`) sees `mileage: 0, mileageCalculated: false` rows and may fill them later (same as `duplicateSession`).

UI surfaces
- `protected/index.html:362` Add Session button → add "+ Week" button beside it; new `#modal-week` overlay after `#modal-session` (`:1108+`).
- `protected/index.html:1494-1495` script order: `sessions.js` → NEW `signatures.js` → NEW `week-log.js` → `recurring.js`.
- `protected/js/ui.js:592` click delegation: new `data-action` cases; `:854` change delegation: `week-edit` (duration/amount edits in the review list).
- `protected/styles.css` (after `.repeat-last`, `:2364`): grid + cell + review-list styles. Dark primary, light via existing tokens.
- `tests/helpers/ui-app.cjs:9` `PAGE_SCRIPTS` must list the two new modules or the flow tests cannot boot them.

Existing state / migration: none. No new envelope field, event type, settings key or localStorage key. Rows carry `recurring: null` like the form (`sessions.js:802`).

Guards that scan automatically: `tests/slice1/static-guard.cjs` walks every `protected/js/*.js` (new files included) — the grid must never mutate `App.state`; it keeps its own model and writes only through `App.runCommand`.

## 2. Chokepoint + bypass guard

Chokepoint: `App.runCommand('session.saveMany', { records }, revisionAtOpen)` — exactly ONE call per Save.
Bypass-guard tests (`tests/week-log.test.cjs`):
1. Source guard: `week-log.js` contains the string `session.saveMany` and never `'session.save'`, `session.update`, `session.correct`, `session.delete`.
2. Revision pin: 6 ticked cells + Save → `repo.revision` rises by exactly 1 and `working.sessions.length` by 6. Mutation (closeout): route the UI through sequential `session.save` → revision pin goes red.
3. All-or-nothing pin: one invalid record in a 6-record payload → zero rows written, revision unchanged.

## 3. Invariants (hold on every surface)

- Insert-only: `saveMany` refuses an id that already exists and duplicate ids inside the payload. It never edits, never touches locked rows, never writes events.
- Same validation and finalization per record as `session.save`; `companyAmount/companySplit = 0` forced.
- Money: cents via `App.newAmount(value, null)` (`sessions.js:30`) for every generated amount; no new money math.
- Status: `App.defaultStatusForDate(date, today)` (`sessions.js:442`); past cells lock on save, exactly like the form.
- Double-book: a cell whose client(s) already have a session that day is disabled ("logged"); ticking a combo disables its members' single cells that day and vice versa (planner rule, `recurring.js:144`, re-implemented as a pure function; `recurring.js` untouched).
- Mileage never copied (0); address = primary client's address (`sessions.js:795`); notes empty.

## 4. Failure modes + kill switch

- Repository throws (stale revision, maintenance, invalid record) → `runCommand` toasts, nothing written, modal stays open.
- Render failure after a committed save → existing "Saved successfully, but the screen could not refresh" path (`app-core.js:248`).
- Kill switch: delete the `week-log.js` script line and the "+ Week" button; the app is byte-for-byte today's app. `signatures.js` and `session.saveMany` are inert without callers. Saved rows are ordinary sessions. No one-way door: JS can be rolled back (no new event type).

## 5. Slices (this branch)

A1 (Fable): `repository.js` one case + `tests/week-log.test.cjs` repository section. Accept: 6 records → +1 revision, +6 rows, completed ones finalized, scheduled not; refuse existing id / duplicate id / empty / invalid (zero written); stale revision refused; maintenance refused.
A2 (Fable): `protected/js/signatures.js` → `App.sessionSignatures(sessions, clients, since)` pure; `App.weekLog` pure model helpers. Accept: pure tests.
A3 (Sonnet, after A1–A2 land): `week-log.js` UI + `index.html` + `styles.css` + `ui.js` wiring + `ui-app.cjs` + flow tests. Accept: §2 pins, "Repeat last week" pre-ticks exactly last week's non-cancelled rows, logged cells disabled, amounts = rate × duration (cents) when no signature exists, saved rows appear in month view + Owed.

## 6. Rulings (delegated; veto in one word)

1. Grid UI lives in a NEW file `week-log.js`, not `sessions.js` (already 1,240 lines; plan §4.4 wants it split). Veto: "InSessions".
2. `saveMany` is insert-only (no edit path). Veto: "AllowEdit".
3. Pre-fill amount = the signature's usual amount when one exists (that is what he charges, e.g. trio $300 ≠ sum of rates); rate × duration only when no signature exists. Both pass through `newAmount`. Veto: "RateOnly".
4. Review list under the grid shows every row to be created with editable duration + amount, because past cells lock on save. Veto: "NoReview".
5. Week starts Monday; Sunday is the last column. Veto: "SundayFirst".
6. Rows = active clients alone + every multi-client combo seen in the last 60 days + any combo present in the week being repeated. Veto: "SinglesOnly".

## 7. Closeout record (2026-10-11, Fable 5.1)

Branch `log-a-week`: `7e23690` (A1 repository case + A2 signatures.js + 20 tests), `41c9809` (A3 UI by a Sonnet subagent, reviewed line by line by the primary; one defect fixed: editing a tick in the review list did not refresh the grid cell). NOT pushed, NOT merged.

Gates: `node --check protected/js/*.js` clean; `node tests/slice1/static-guard.cjs` PASS; `node --test` 187 tests, 187 pass, 0 fail (was 157; +30).
Mutation-verified (each applied, suite red, file restored byte-identical by `cmp`): sequential `session.save` instead of `saveMany` → 4 red; cents rounding removed from `buildRecords` + review edit → 2 red; `finalize` skipped in `saveMany` → 5 red; existing-id check removed → 2 red.

OBSERVED on the fabricated preview (127.0.0.1:8877, "Initialize fabricated preview"): Week button on the Sessions tab opens the modal; 3 ticks + Save took the revision 1 → 2 and added 3 rows (past dates Completed + locked, mileage 0, recurring null); the Monday cell showed "logged" after an earlier save; review-list amount edit 123.456 → 123.46 stored; month view, Totals and Owed updated; "Repeat last week" on the next week ticked the 4 matching cells and kept a tick from another week; Scheduled vs "Completed (locks)" pills correct; dark and light themes at 1024 px; no console errors.

UNVERIFIED: real data on the real device (how the rows/combos look with 6 active clients and the family trio); the 640 px breakpoint; keyboard focus order inside the new modal; `node --test` only proves wiring, not pixels.
Follow-ups (not done, out of scope): Slice B (this-week group), Slice C reuses `App.sessionSignatures`; the plan's "three un-auto-completed rows" item is CLOSED (§0).
