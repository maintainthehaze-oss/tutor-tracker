# 2026-11-04 — Sessions toolbar "Week" button removed (Claude Code, Fable 5.1)

**Ask (MTH):** "I don't need the button in the Sessions tab for the week view. Currently sitting next to filters and add session in blue."

## Ruling
The Week button was the only entry into the "Log a week" modal (Slice A, 2026-10-11), so the whole feature behind it was removed too, not just the button, matching the 2026-10-15 "This week" removal. Veto if you want the modal kept reachable some other way; it is one `git revert` away.

## What changed
- `protected/index.html`: the `open-week-log` toolbar button, the `#modal-week` "Log a week" modal and the `js/week-log.js` script tag removed (31 lines).
- `protected/js/week-log.js`: DELETED (174 lines).
- `protected/js/ui.js`: the six `week-*` / `open-week-log` / `save-week` click cases and the `week-edit` change case removed (7 lines).
- `protected/styles.css`: the "Log a week" block removed (47 lines, `.week-*` classes; none used elsewhere).
- Tests: `tests/week-log-flow.test.cjs` DELETED (10 tests); `tests/sessions-layout-pins.test.cjs` toolbar pin now expects `['toggle-filters', 'add-session']`; `tests/helpers/ui-app.cjs` load list drops `week-log`.
- `CLAUDE-INSTRUCTIONS.md`: script load order drops `week-log`.
- Untouched: weekly recurring slots (`recurring.js`, client "Weekly schedule" fieldset), `signatures.js` (still used by recurring), Add Session, Filters, More menu, Owed.

## Verification
- `node --test` 243/243 (was 253; the 10 removed are the deleted file's). `node --check protected/js/ui.js` clean.
- Grep for `week-log`, `open-week-log`, `modal-week`, `openWeekLog`, `toggleWeekCell`, `editWeekTick`, `.week-*` across `protected/`, `tests/`, root docs: zero hits.
- OBSERVED on the fabricated preview (dark, desktop, `protected-static` on :8877): Sessions toolbar reads Filters / More / Add Session; no `open-week-log` element, no `#modal-week`, `App.openWeekLog` undefined, zero console errors.
- NOT observed: light theme, real data.

## State
SHIPPED on MTH's "Ship it": `main` `211107d → 285d688`, pushed by MTH from his own terminal (the session push was blocked by the deploy gate, as expected). Live `protected/index.html`, `js/ui.js`, `styles.css` identical to the commit after CRLF normalisation via curl on the 2nd poll (~40 s); `js/week-log.js` returns 404. Next: hard-refresh the live site and open Sessions.
