# HANDOFF

**2026-09-15 (Fable): MILEAGE IS NOW DAY-SEQUENTIAL (MTH caught a double count). Settings button renamed "Calculate mileage by day": routes each day home -> sessions in time order -> home, credits each session its leg (last one + drive home); corrects the round-trip values from the earlier fill; hand-entered and root-app-era values never touched. Pin button in the form is day-aware. Real routes only, no estimates. Browser-verified against independently computed expected legs. COMMITTED, NOT PUSHED (awaiting "Ship it"). Detail: `docs/handoffs/2026-09-15-mileage-autocalc.md` (follow-up 2).**

**2026-09-15 (Fable): FILL MISSING MILEAGE. Settings > "Fill missing mileage" adds round-trip miles to every in-person session with 0 mi (one ORS lookup per distinct client address, explicit confirm with counts); locked rows get append-only corrections via new repository command `session.correctMany`; existing miles never touched. Delete "bug" is not a bug: locked (completed/archived) rows cannot be deleted by MTH's own evidence policy; void them via pencil -> Status = cancelled. SHIPPED 2026-09-15 (commit 053730e); all 4 live files (index.html, sessions.js, ui.js, repository.js) verified via curl ~40s after push; Pages build "built". Detail: `docs/handoffs/2026-09-15-mileage-autocalc.md` (follow-up section).**

**2026-09-15 (Fable): MILEAGE AUTO-CALC RESTORED. Pin button next to Mileage in the session form now fills round-trip driving miles (OpenRouteService) from Business Address to the first selected client's address; editable before save; provenance stored in `mileageDetails`. No key = refuses (no guessed figures). Settings now actually saves the ORS key (it never did); CSP `connect-src` re-allows api.openrouteservice.org (it was blocking the call); fake "Recalculate 2026 Mileage" button removed. Browser-verified on synthetic data with mocked ORS + real error paths. SHIPPED 2026-09-15 (commit bfe7a7f); all 4 live files (index.html CSP, sessions.js, ui.js, SECURITY-PRIVACY.md) verified via curl ~30s after push; Pages build status "built". UNVERIFIED: real ORS key end to end. Detail: `docs/handoffs/2026-09-15-mileage-autocalc.md`.**

**2026-09-15 (Fable): LOCKED SESSIONS EDITABLE. Pencil on an archived/finalized row now opens the edit form; saving records an append-only `correction` event (original untouched, "View original" shows evidence + events). Un-pay a wrongly-paid session, fix amounts/notes/status, backdate payments via new "Paid on" field (also on new sessions). Single overlay chokepoint `App.recordPolicy.applyEvents`; Reports honour it. SHIPPED 2026-09-15 (commit 7077e7d); all 6 live files verified via curl ~60s after push (one-way door: do not roll back JS once a correction exists). Detail: `docs/handoffs/2026-09-15-sessions-math-review.md`.**

**2026-09-15 (Fable): ARCHIVED SESSIONS CAN BE MARKED PAID. Activation archives ALL pre-existing records (all 122 real sessions), so pre-activation unpaid sessions had no Mark paid path (Owed panel errored). Payment events now allowed on archived completed rows; originals untouched. SHIPPED 2026-09-15 (commit d9c56d0); live repository.js/sessions.js verified via curl ~40s after push. Same day, MTH ruling: pre-activation *scheduled* sessions now take append-only STATUS events (auto-complete when the date passes, or a select in the Status column: completed / cancelled / no-show; last wins; paid rows cannot be un-completed). Reports/Tax now honour status + payment events on archived rows (they did not before). SHIPPED 2026-09-15 (commit de52f44); all 5 live files verified via curl ~60s after push. Do not roll back the deployed JS once a status event exists. Detail: `docs/handoffs/2026-09-15-sessions-math-review.md`.**

**2026-09-15 (Fable): SESSIONS MATH REVIEW + FIXES. SHIPPED 2026-09-15 (commit 75c8b7b); live scripts verified. Verified totals correct. Fixed: Totals row alignment, Record payment→Mark paid (hidden on waived), bulk Mark Paid removed, select-all picks only unlocked rows, NEW auto-complete of past-dated scheduled sessions on load (they lock), cancelled/no-show rows show — and leave the Unpaid filter. Browser-verified on synthetic data. Unverified: real device / real data. Detail: `docs/handoffs/2026-09-15-sessions-math-review.md`.**

**2026-09-10 (Fable): SESSIONS TABLE FIT-TO-SCREEN + "View details" removed. Pencil now opens the read-only detail for protected rows (openSessionForm already routed there); `view-session` action deleted. New `#sessions-table` CSS block (compact padding, `.col-client` wraps, small inline inputs, 28px icon buttons). Measured on synthetic data: fits at 1024px in normal, split-shown, and edit mode; 1280 comfortable. Horizontal scroll remains only as fallback below ~1000px.**

**2026-09-10 (Fable): ROOT WORKER KILLED. Root `sw.js` is now the same kill switch (clear caches, unregister, reload); root redirect stays plain JS (`protected-redirect.js`). `protected/js/upgrade-shim.js` now unregisters BOTH tracker scopes and deletes all `tutor-*` caches on load. No service workers remain anywhere in the deployed site.**

**2026-09-10 (Fable): UPGRADE PANEL HIDDEN ON LIVE SITE. `#protection-panel` (heading, status line, buttons) is hidden by `updateProtectionStatus` when production && repository.ready && !maintenance. Reappears only if activation is missing ("Device upgrade required") or maintenance flag is on. "Enter maintenance" removed; button is now exit-only ("Leave maintenance"), shown only while maintenance is on. Localhost keeps the panel for "Initialize fabricated preview".**

**2026-09-10 (Fable): OFFLINE CACHING / INSTALL-AS-APP REMOVED from `protected/` (MTH ruling: desktop browser only). `protected/sw.js` is now a kill switch (skipWaiting, delete all caches, unregister, reload tabs) so browsers holding the old worker self-clean on next visit. `js/sw-register.js` -> `js/upgrade-shim.js` (unregisters protected-scope workers on load; keeps `window.TrackerUpgrade` resolving so restore/upgrade paths in ui.js don't throw; retireLegacyRoot is a no-op, root redirect is plain JS). `manifest.json`, apple/mobile meta, apple-touch-icon deleted. Root app untouched. Kill switch verified on localhost. From now on: no cache bump on protected/ deploys; plain reload picks up changes.**

**2026-09-10 (Fable): REMOVED Sessions-tab Monthly Summary panel (redundant with Totals row + header pills). Deleted `#monthly-summary` aside, `renderMonthlySummary`, `.monthly-stat*` CSS. Owed panel kept. SW REVISION -> v4.**

**2026-09-10 (Fable): PROJECTED PILL IN HEADER. `#header-projected-pill` next to Revenue; sums ALL scheduled sessions (any date, waived = $0) in `updateHeaderStats` (`protected/js/dashboard.js`); hidden when $0. SW REVISION -> protected-2026-09-10-v3. Browser-verified desktop + mobile wrap.**

**2026-09-10 (Fable): COMPANY SPLIT COLLAPSED BY DEFAULT (MTH ruling). Every split figure carries class `split-info`; `body.split-collapsed` hides them (CSS). Per-device pref in localStorage `tutoring-show-split` (default off); "Show split"/"Hide split" buttons in Sessions toolbar + Reports filter bar (`data-action="toggle-split"`, `App.toggleSplit`). Covers: Sessions Split column, Co. Split monthly stat, dashboard sub-line + Historical-share chart dataset, Reports share card + both tables, session-detail company rows, client legacy-details section. CSV exports and tax Commissions line untouched. Browser-verified both states + persistence across reload. SHIPPED 2026-09-10 (commits e0561b1, 655f866, 30df951); live sw.js = protected-2026-09-10-v2 verified.**

**2026-09-10 (Fable): WAIVED FEES ARE NOT REVENUE (MTH ruling). New `App.isWaived/revenueAmount/revenueSplit` in `protected/js/app-core.js`; applied in computeMetrics, report-model (current mode only; captured-v1 frozen on purpose), Sessions totals + projected, monthly summary, per-client report stats. Hours/miles/session counts still include waived. Browser-verified on synthetic data: every gross figure dropped by exactly the $50 waived session; captured-v1 unchanged. SHIPPED 2026-09-10 (commits e0561b1, 655f866, 30df951); live sw.js = protected-2026-09-10-v2 verified.**

**2026-09-10 (Fable): PORTED projected revenue into `protected/` (the app the live site actually serves). Root commit def9c33 had shipped it only to the retired root app. Files: `protected/js/sessions.js` (updateSessionTotals), `protected/styles.css` (.total-projected), `protected/sw.js` (REVISION -> protected-2026-09-10-v2). Browser-verified on localhost synthetic data: realized $430.00 + "+$245.50 projected" from 2 scheduled; status filter respected. SHIPPED 2026-09-10; live verified. Unverified: real device.**

**2026-09-09 (Cowork, owner-reported): DEVICE UPGRADE ACTIVATED (122 sessions). Root retirement live. Newest recovery save in Downloads/tutor-tracker-recovery is authoritative; copy to USB. Remaining I4 mobile check. Detail: `docs/handoffs/2026-09-08-root-retirement-diagnosis.md`.**

**2026-09-08 (Fable, NO CODE): Claude Code `/doctor` health check + independent verify. Global setup clean, zero changes. Detail: `docs/handoffs/2026-09-08-doctor-review.md`.**

**2026-09-08 (Fable, NO CODE): cleaned the OneDrive TUTORING TRACKER clone (dead worktrees, merged branches, temp_clone, obsolete .bat, gc); live site verified v41. Cross-session remediation plan, all items CLOSED 2026-09-08 (docs commit 7f7f256 not yet pushed; stale C:\Users\dev31\Claude\Projects clone recycled): `docs/handoffs/2026-09-08-remediation-plan.md`. Detail: `docs/handoffs/2026-09-08-live-repo-cleanup.md`.**

**2026-09-08 — Claude Code (Opus 4.8)**

## Task / State
Make picking a student when adding a session easier / less scrolling.
Replaced the cramped native `<select multiple>` client picker with a clickable name list.
SHIPPED 2026-09-08 (SW bumped v40 -> v41). Landed alongside the parallel projected-revenue
work (shared working tree caused mid-session churn; verified both features coexist before push).

- `#session-clients` is now a `<div class="client-picker">` of `<button class="client-pick">`
  tiles (name + rate). Tap toggles; no Ctrl/Cmd. Active clients only.
- Order computed once per open (no jumping on tap): selected first, then most-recent
  session date, then alphabetical. `renderClientPicker()`, `getSelectedSessionClientIds()`,
  `toggleSessionClient()` in js/sessions.js; all three on `App.*`.
- Click wired via delegated `data-action="toggle-session-client"` in js/ui.js; removed the
  obsolete `session-clients` change listener; `calc-mileage` now reads the new getter.
- Note: old populate used strict `c.status === 'active'` (excluded status-less clients);
  new code uses `(c.status || 'active') === 'active'` — status-less clients now show, matching
  the rest of the app.

## Verified (browser, 2026-09-08, python http.server + Browser pane)
Active-only filter (inactive/paused excluded); recency+alpha ordering; single-select shows
Repeat-last banner; multi-select (family) hides banner; auto-amount = avg rate x duration
($62.50 for 70/55); save persists numeric clientIds [3,2]; edit re-opens pre-selected + floated
to top; toggle on/off; empty-state message when no active clients. No console errors from new code
(only a pre-existing SW-fetch error under the plain static server).

## Unverified
Real device touch targets. Long client lists (>~30) scroll feel inside the 260px max-height box.
Live GitHub Pages build (confirm live sw.js = v41 after Pages deploys).

## Next step
MTH: after Pages builds, hard-refresh the live site and confirm the Add Session picker shows
clickable names (not the old dropdown). If two sessions run again, give each its own worktree
— the shared OneDrive folder caused file races this session.

## Files touched
index.html (picker markup + hint), styles.css (.client-picker/.client-pick),
js/sessions.js (picker render/read/toggle + openSessionForm/saveSession/updateSessionPrefill),
js/ui.js (click case, removed change listener, calc-mileage)
