# 2026-11-04 — Sessions-tab monthly calendar (dashboard slice 2)

Tool: Claude Code, Fable 5.1 (side session started by the slice-1 session). State: **SHIPPED** — MTH said "Ship it" and pushed `f197cd8` from his own terminal; all six changed live files curled identical to local (CRLF-normalised) on the first poll (~20 s), markers `session-view` / `calendar-grid` / `dash-scheduled-count` / `renderSessionCalendar` present.

## What changed (one sentence)

The Sessions tab has a **List / Calendar** toggle next to the month navigator; Calendar draws a 7-column grid for the shown month with one chip per session and a hover "+" per day that opens Add Session on that date; the Dashboard gets one line ("N sessions scheduled this month · Open calendar"), no grid.

## Rulings (veto-able, all delegated)

| # | Ruling | Why |
|---|---|---|
| R1 | `CLAUDE-INSTRUCTIONS.md` "do not re-add calendar" line rewritten: Dashboard stays calendar-free, Sessions-tab calendar IS wanted (ruled 2026-11-04). MTH starting slice 2 counts as the override. | The old line would have blocked this slice forever; the Dashboard half of the ban still stands. |
| R2 | Toggle state is **in memory only** (`let sessionView = 'list'` in `session-calendar.js`). Reload = List. No storage key, so nothing for `SECURITY-PRIVACY.md`; a static pin forbids `localStorage`/`sessionStorage`/`indexedDB`/`runCommand` in the module. | Given in the brief. |
| R3 | The calendar is **by month**: clicking **All time** in calendar mode drops back to List; clicking **Calendar** while on All time jumps to the current month first. | A calendar with no month has nothing to draw; silently keeping the toggle lit over an empty grid would mislead. |
| R4 | Table filters (client, payment, status, From/To) apply to the grid too: `renderSessions()` hands the same `filtered` rows to `App.renderSessionCalendar(filtered)` in both branches. | One scope rule for both views; no second filter model. |
| R5 | Chip label = the client's **family group** when set, else the client name; siblings on one session collapse to one label. Chip shows time (omitted when blank) · label · duration. Full detail in the chip `title`. | Matches "Hours by family" on the Dashboard; cells are narrow. |
| R6 | Chip colours: scheduled = info blue, completed paid **or waived** = success green, completed unpaid = warning amber, cancelled / no-show = muted + strikethrough. | Waived is settled money, not owed. |
| R7 | Weeks start **Sunday**; leading/trailing cells of neighbouring months are blank (no numbers). Today gets an accent ring. | Fewer things to misread; matches the US locale the month label already uses. |
| R8 | Dashboard count comes from `cmp.pace.scheduledCount` (the comparison model's "still scheduled this month"), not a new read of `App.state.sessions`. "Open calendar" = `App.openSessionCalendar()`: current month, calendar mode, Sessions tab. | Read-guard invariant; one source for "scheduled this month". |
| R9 | Edit mode is a List concern: chips ignore `App.state.editMode` (no checkboxes or inline inputs in cells). | Bulk selection is table-only. |
| R10 | Desktop only; no narrow-width CSS for the grid (MTH never uses a phone). | Memory: desktop-only. |

## Files

- NEW `protected/js/session-calendar.js` (loaded after `session-table.js`, before `session-form.js`): `renderSessionCalendar(filtered)`, pure `calendarHtml(ym, rows)`, `setSessionView`, `getSessionView`, `openSessionCalendar`.
- `protected/js/session-table.js`: two `if (App.renderSessionCalendar) App.renderSessionCalendar(filtered);` calls (empty-month branch and normal branch).
- `protected/index.html`: `.view-toggle` inside `<nav class="month-nav">` (`data-action="session-view" data-view="list|calendar"`), `#session-calendar` (hidden) above the table, `id="sessions-table-wrap"` on the table wrapper, `#dashboard-calendar-line` under `.summary-cards` with `#dash-scheduled-count` and `data-action="open-calendar"`, new script tag.
- `protected/js/ui.js`: `case 'session-view'` and `case 'open-calendar'`.
- `protected/js/dashboard.js`: one `setText('dash-scheduled-count', …)` line in `renderDashboard()`.
- `protected/styles.css`: `.view-toggle`, `.session-calendar`, `.calendar-weekdays`, `.calendar-grid` (7 columns), `.calendar-day` (today ring, outside cells), `.calendar-add` (opacity 0, shown on `:hover` / `:focus-within`), `.calendar-chip` + four colour classes, `.dashboard-calendar-line`.
- `tests/helpers/ui-app.cjs`: `'session-calendar'` added to `PAGE_SCRIPTS` in page order.
- NEW `tests/session-calendar.test.cjs` (5 tests).
- `CLAUDE-INSTRUCTIONS.md`: R1.

Quick add and chip open are the **existing** paths: `data-action="add-session" data-date="YYYY-MM-DD"` → `openSessionForm(undefined, date)`; `data-action="edit-session" data-id` → `openSessionForm(id)`. No new write path; the module never calls `runCommand`.

## Tests

- `node --test`: **253 / 253** (was 248; +5 in `tests/session-calendar.test.cjs`). `node --check protected/js/*.js`: clean.
- Mutation-verified (each red, then file restored and SHA-256 compared **byte-identical**):
  - M1 remove the All-time → List fallback: 4 pass / 1 fail.
  - M2 drop the unpaid chip class: 3 / 2.
  - M3 inject the chip label unescaped: 4 / 1 (the hostile-name fixture catches it).
  - M4 dead `open-calendar` case in `ui.js`: 3 / 2.
- Not mutation-verified: CSS pins, script-order pin (static text checks only).

## Observed in the built-in browser (fabricated preview, `fixtures/synthetic.json`, ~800 px, dark then light)

- Dashboard line "0 sessions scheduled this month · Open calendar" under the cards; clicking it lands on Sessions, **November 2026**, Calendar pressed, 30 day cells, today (4th) ringed, hover "+" on a day.
- February 2026 (set via `App.setSessionMonth`): 28 cells, two chips (amber unpaid completed; muted strikethrough cancelled), Owed panel and month navigator unchanged above the grid.
- "+" on 14 Feb → Add Session modal with Date `02/14/2026`, empty id. Chip on 1 Feb → "Edit Session (original kept)", id `3`, date `2026-02-01` (a locked fixture record opens read-only exactly as the table's Edit does).
- Light theme: grid, chips and hover "+" readable. List button → table back (2 rows), calendar hidden.
- Console: **no messages at all** throughout (errors or otherwise).
- Preview served by a new `protected-slice2` launch entry (port 8881, `autoPort: false`) in `C:\Users\dev31\Tutoring Tracker Pro_files\.claude\launch.json` because `protected-static` (8877) is held by another session. That launch file sits outside the repo.

## UNVERIFIED

- Real data (fixture only). A month with 6+ sessions on one day (cells grow; no cap or "+N more" — ruled unnecessary for one tutor, veto if wrong).
- Widths under ~800 px (desktop-only ruling). Print stylesheet (grid not hidden on print; untested).
- `showMonthOf` after a save from calendar mode: pinned in code (view survives, `App.getSessionView()` stays `'calendar'`), not clicked through in the browser.
- Live deploy verified by curl only; MTH's hard-refresh + a click on Sessions → Calendar on real data not yet reported.

## Next

1. MTH: "Ship it" → `git push origin main` from his terminal, hard-refresh, Sessions → Calendar.
2. Post-push: curl live `session-calendar.js`, `index.html`, `styles.css`, `ui.js`, `dashboard.js`, `session-table.js` and grep `session-view` / `calendar-grid`.
3. Slice 3 (whatever MTH asked next) is not started.
