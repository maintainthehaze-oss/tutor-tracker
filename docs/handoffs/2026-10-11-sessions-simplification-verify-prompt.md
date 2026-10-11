# Verify the 2026-10-11 Sessions-tab simplification against the LIVE app

Read `HANDOFF.md` and `docs/handoffs/2026-10-11-sessions-tab-simplified.md` first. Three commits from another session are on `origin/main` and were pushed with later commits (`4b59fa5`, `89e4f60`): `43c03dc` (Today first / Owed collapsed), `f8b09a1` (Completed button, Mileage on toolbar), `efa2778` (4-button toolbar + More, 9-column table, 3 header pills, no Duplicate, no table Mark paid). They were only ever observed on the fabricated local preview, never on the live site or real data. Your job: confirm they are live and still work after the commits that landed on top of them.

Live app: https://maintainthehaze-oss.github.io/tutor-tracker/protected/ (root redirects there). MTH's real data lives in his Chrome; read it only through the UI, never export, upload or paste records. If you use Claude in Chrome, hard-refresh once first (stale cached scripts after a deploy have thrown `is not a function` errors before).

## 1. Live files match origin/main
For each of `protected/index.html`, `protected/styles.css`, `protected/js/sessions.js`, `protected/js/this-week.js`, `protected/js/ui.js`, `protected/js/dashboard.js`: curl the live URL and diff against `git show origin/main:<path>`. Report byte-identical or not. If not, say which and stop before step 3.

## 2. Suite on the current tree
`git fetch`, then on `origin/main`: `node --test` (expect 216 pass or more, 0 fail), `node tests/slice1/static-guard.cjs` (PASS), `node --check protected/js/*.js`. The static test in `tests/this-week.test.cjs` pins toolbar order, 8 sortable columns, 3 header pills, no `duplicate-session`, no table `mark-paid`.

## 3. Live behaviour, on real data, read-only unless noted
Check each and report OBSERVED / NOT OBSERVED with what you saw:
- Header shows exactly Projected (hidden when nothing scheduled), Owed, Backup.
- Sessions toolbar: Filters, Mileage, More ▾, Add Session, Week. More opens; contains Show split, Edit Mode, CSV; closes after picking one and on a click elsewhere. Show split still toggles the Split column.
- "This week": Today's day first, then earlier days newest-first, then a "Coming up" divider before the days ahead. Chips read Completed / No-show / Cancelled on past/today rows, Skip on future rows.
- Owed is one line with a caret; tap opens the by-family list with Record payment; the total equals the header Owed pill.
- Table: Date, Time, Client(s), Duration, Amount, (Split only when shown), Mileage, Payment · Status, Actions. Any online/group session shows the type after the client name. Row actions are Completed (scheduled rows only), Edit, Delete. Totals row columns line up.
- Edit Mode: rows render with both Payment and Status selects in the merged cell, nothing shifted.
- Mileage button: ONLY if MTH says so in chat, press it, read the confirm text, and cancel. Do not run the routing without his word.
- Light theme and a ~640 px width: nothing overlaps or clips in the toolbar, week group, or table.
- Console: no errors on load or on these interactions.

## 4. Mutations only if MTH asks
Tapping Completed on a real scheduled row writes a real event. Do it only on his word, on a row he names.

## 5. Report
Lead with one line: live and working / live with issues / not live. Then the OBSERVED list, the NOT OBSERVED list, and anything that differs from the handoff. Update `HANDOFF.md` (one line) and append to `docs/handoffs/2026-10-11-sessions-tab-simplified.md`. Do not push; "Ship it" is the only push authorization.
