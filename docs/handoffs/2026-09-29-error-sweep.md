# 2026-09-29 — Error sweep + "This week" strip removed (Claude Code, Fable 5.1)

Branch: `error-sweep-2026-09-29`, fast-forwarded onto `main` and pushed on MTH's "Ship it" (`4cc4105 → dae6aa2`). **Deployed 2026-09-29**; every changed live file verified via curl. Not observed: real data on the real device (MTH should hard-refresh once).

## Asked
Go through the whole tracker, find and fix errors; remove the "This week" view from the Dashboard.

## Method
Three read-only Opus reviewers swept `protected/` by module (core/data, sessions/clients/ui, dashboard/reports/expenses). Every finding below was re-traced in the code by the primary before a change was made. `node --test`: 155 tests, 155 pass (was 163; the 8 week-strip tests went with the strip). Fixes observed on the fabricated preview at 127.0.0.1:8877 unless marked otherwise.

## Removed
- **"This week" strip** (shipped 2026-09-27 with the recurring-slots stack): the `#week-strip` article in `index.html`, `weekStripDays`/`weekStripHtml`/`renderWeekStrip` and `STRIP_*` in `dashboard.js`, the `strip-*` and `quick-*` click handlers plus `stripRefusesPaid`/`undoToStatus` in `ui.js`, the `.week-strip`/`.strip-*` CSS, `tests/week-strip.test.cjs`, and the strip's read-guard exemption. `showToast`'s optional Undo action and `.toast-action` CSS stay (generic, unused for now). `recurring.js` (inert planner) untouched.
- **Google Fonts `<link>`s** in `index.html`: the page's own CSP blocked the stylesheet on every load (console error on live); the preconnects still contacted Google. Font stack falls to `system-ui`.

## Fixed (all verified in code; browser-observed where noted)
1. **False correction on a no-edit save of a locked paid session with no stored payment date** — `sessions.js` (`openSessionForm`, `saveSession`, `saveCorrection`). The form pre-filled "Paid on" with today and Save wrote `{paymentDate: today}`, moving old income into the current tax year. Now blank when unknown; today is assumed only when a row *becomes* paid. Same guard for a legacy time not in HH:MM or a type outside the select. OBSERVED: with the old code, Save on fixture session "2" wrote 1 correction; with the fix, sessions 2/3/7 all give "No changes", 0 events written.
2. **Reports showed "Unknown client" after a correction pointed a locked row at a client added later** — `report-model.js`: current mode falls back to today's client list; `clientIds` are normalized *after* the event overlay.
3. **Archived status dropdown refused "completed" with "already completed" after a trash-can cancel** — `repository.js` `session.status` compares against the full event overlay (corrections included), not status events alone.
4. **OpenRouteService key field was disabled on the live site**, not just the preview — `ui.js` init: now `if(!production())`. This is why the mileage pin/by-day tools always said "Add your key". NOT observed on live.
5. **Mileage pin could write another session's miles** if the form was closed/reopened during the lookup — `calcFormMileage` now checks the modal generation, like receipts do.
6. **Clicking Type / Split / Mileage headers scrambled the Sessions table** — sort click/keydown only match `th.sortable[data-sort]`. OBSERVED.
7. **Escape closed Settings under an open Confirm** — closes the last open overlay. OBSERVED.
8. **Editing an unlocked session silently replaced its stored address** with the first client's current address — kept when the client list is unchanged.
9. **Header select-all checkbox stayed ticked after Deselect** — mirrors the selection on every render.
10. **"View sessions" from a client card kept an old From/To range** — cleared; filter toggle `aria-expanded` set.
11. **Dashboard trend arrows never coloured** (`trend-up`/`trend-down` classes had no CSS). OBSERVED (green/red).
12. **Receipt thumbnail in the Expenses table had no styling** (full-size image in a default button). OBSERVED 40×40.
13. **Backup pill said "today" for a backup made last night** — calendar days, not 24 h spans. Test updated (now pins 11 pm → "1d").
14. **Service-worker kill switch deleted every cache on the shared github.io origin** — only `tutor-*` now.
15. **YoY chart**: "Historical share" series hidden when split figures are hidden; empty state message instead of a blank card.
16. **Unreadable PDF receipt was stored as a broken image** — now toast only; **undecodable image** (HEIC etc.) now toasts instead of failing silently; **receipt viewer** falls back to a receipt stored inside an old expense record.
17. **Negative money read `$-500.00`** → `-$500.00`. OCR total skips "TOTAL SAVINGS"/discount lines.
18. Status/type values are HTML-escaped where they become class names (`clients.js`, `sessions.js`); `.text-muted` notices are actually muted.
19. Parent folder `.claude/launch.json` still pointed at the old OneDrive paths (project moved 2026-09-19) — repointed.

## Follow-up the same evening (MTH replies)
- MTH: only one device is used → ruling B (backup-merge event order) is moot; left as is.
- MTH: paused-client behaviour is fine → ruling D closed.
- MTH asked for `SECURITY-PRIVACY.md` → the two backup-bookkeeping keys are now in the data inventory (ruling E closed).
- MTH: "Why is there an error on the Tax page" → it is the amber **data notice** ("Incomplete inputs…"), not a failure: the report engine lists every record with a missing/unknown field (payment date, work type, companyAmount, duration, mileage) so totals are labelled as known subtotals. On real data with archived legacy records that list is long and reads like an error. Change: `App.reportModel.renderNotice` now prints one sentence with the record COUNT and puts the per-record lines in a collapsible "Show the N records" (`<details>`), on the Tax page, Reports page, Dashboard and YoY notices. PDF/CSV still carry the full list. OBSERVED on the fixture (9 records, list opens). 155/155.

- MTH: "yes strip it" → `repository.js` `finalize()` now snapshots settings through `withoutSecrets()` (ORS key, gist id/token, token/secret-shaped keys dropped; address, rates, split kept). New test in `tests/slice1/repository.test.cjs`; MUTATION-VERIFIED (dropping the strip turns the test red; restored byte-identical). Snapshots locked before this ship still hold the key and cannot be purged. `SECURITY-PRIVACY.md` inventory updated. 156/156.

## NOT changed — MTH rulings still open
- ~~A~~ (done 2026-09-29, forward only) ORS API key was copied into every finalized session's settings snapshot** (`repository.js` finalize) and so into every recovery file, immutably. Security posture: strip `orsApiKey`/gist fields from the snapshot (or keep the key in a per-device key). Existing copies can't be purged.
- ~~B~~ (moot: single device) Backup merge applies events in append order, not `recordedAt` order** (`reconcileSnapshots`). Only bites with two devices both recording events. Changing overlay order is a one-way door for existing data.
- **C. Schedule C line placement**: `advertising`, `travel`, `equipment` categories fall to line 27b "Other" (`reports.js`). Tax treatment is a CPA question; totals (28/31) are unaffected.
- ~~D~~ (closed: fine as is) Paused clients are excluded from the session client picker but shown with actives on the Clients tab; picker labels them "(inactive)". Intent unclear.
- ~~E~~ (done) `SECURITY-PRIVACY.md` owed the two backup-bookkeeping localStorage keys (carried from 2026-09-27).

## UNVERIFIED
Real data on the real device; ORS key end to end on live (fix 4); fixes 3, 5, 8, 9, 10, 13–17 are code-traced and unit-tested where a test existed, not all browser-observed.
