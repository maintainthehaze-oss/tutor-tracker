# HANDOFF

**2026-09-10 (Fable): PORTED projected revenue into `protected/` (the app the live site actually serves). Root commit def9c33 had shipped it only to the retired root app. Files: `protected/js/sessions.js` (updateSessionTotals), `protected/styles.css` (.total-projected), `protected/sw.js` (REVISION -> protected-2026-09-10-v2). Browser-verified on localhost synthetic data: realized $430.00 + "+$245.50 projected" from 2 scheduled; status filter respected. NOT PUSHED — awaiting "Ship it". Unverified: live Pages build, real device.**

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
