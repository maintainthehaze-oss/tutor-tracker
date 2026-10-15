# 2026-10-15 — "This week" group removed (Claude Code, Fable 5.1)

**Ask (MTH):** "I want the 'This Week' collapsible view gone. I don't need it, and it's confusing me."

## What changed
- `protected/index.html`: the `<details id="this-week">` block (above Owed in the Sessions tab) and the `js/this-week.js` script tag removed.
- `protected/js/this-week.js`: DELETED (model, markup, notice bookkeeping, `recurringNotice`, `staleSlots` nudge).
- `protected/js/ui.js`: the five `this-week-*` click cases removed; the paid-row refusal title is now a local `PAID_TITLE` (still used by the table "Completed" button and `quick-*`); `init()` clears the orphan `localStorage` key `tutoring-last-seen` once (ids only).
- `protected/js/sessions.js`: auto-complete no longer records ids for the notice.
- `protected/js/session-table.js`: no `renderThisWeek()` call; two comments reworded.
- `protected/styles.css`: the `.this-week*` / `.tw-*` block removed (29 lines).
- `SECURITY-PRIVACY.md:24`: `tutoring-last-seen` row now says the key is no longer written and is deleted on load. ⚠️ Published privacy text; MTH may veto the wording or drop the row entirely.
- Tests: `tests/this-week.test.cjs` deleted (14 tests); its two unrelated pins (table tie-sort, narrow-layout CSS) moved to NEW `tests/sessions-layout-pins.test.cjs`; `tests/recurring-polish.test.cjs` kept the table "weekly" tag + Record-payment sentence tests, dropped the 4 that drew the group; `tests/backup-status.test.cjs` and `tests/helpers/ui-app.cjs` un-wired; `tests/slice1/static-guard.cjs` keeps the key allow-listed (comment explains: removeItem only).

## Kept on purpose
- Table "Completed" one-tap button, the Week (log-a-week) button, Owed panel, Mileage, weekly recurring slots: all untouched.
- `recurring.js` still produces the pass report; nothing reads its gap/skipped text now (the only reader was the group). Dead but harmless; candidate for a later sweep.

## Evidence
- `node --test`: 245/245 (was 261: −14 this-week, −4 recurring-polish, +2 moved pins). Static guard included in the suite, PASS.
- `node --check` clean on ui.js, sessions.js, session-table.js.
- OBSERVED on the fabricated preview (dark, ~800 px): Sessions tab = month navigator → Owed → table; `document.getElementById('this-week')` null; no this-week script; zero console errors.
- NOT observed: real data, light theme, 640 px. No mutation check (pure removal).
- SHIPPED: `main` `241dfe7 → 5484249`, pushed by MTH; live files byte-identical on the 3rd curl poll, `this-week.js` 404.
