# Slice E — weekly recurring slots, built (2026-10-11, Claude Code Fable 5.1 + Sonnet subagents)

Design: `docs/handoffs/2026-10-11-slice-e-design.md`. Rulings: all five from the 2026-09-19 spec §6 accepted by MTH on 2026-10-11 ("Accept all five"); R1 (Also-attending defaults from the usual sibling set) and R2 (no new localStorage key) delegated, not vetoed.

## Commits (local, NOT pushed; `origin/main` = `20515f5`)
| Commit | Slice | Model | What |
|---|---|---|---|
| `f8095ad` | E1 | Fable (primary) | `case 'recurring.apply'` in `protected/js/repository.js` before `client.save` (one revision per pass; remove only unlocked generated scheduled rows; insert only scheduled generated rows; replace marked clients' `slots`); `tests/recurring-writer.test.cjs` incl. the chokepoint guard |
| `381b49f` | E2 | Sonnet, reviewed | `runRecurringPass` + kill switch `App.features.recurringPass` in `recurring.js`; triggers in `ui.js` init (after auto-complete) and a `visibilitychange` listener (day changed, no modal open), `clients.js` after save/retire; `tests/recurring-flow.test.cjs`; inert clause retired from `tests/recurring-engine.test.cjs` |
| `f6fa193` | E3+E4 | Sonnet ×2, reviewed | "Weekly schedule" fieldset in the client modal (`index.html`, `clients.js`, `styles.css` appended), card line, `tests/recurring-modal.test.cjs`; "weekly" tags (`sessions.js`, `this-week.js`), Record-payment sentence (`payments.js`), gap/skipped notice + "Still tutoring?" nudge (`this-week.js`, `ui.js` case `this-week-pause`), `SECURITY-PRIVACY.md` one row; `tests/recurring-polish.test.cjs` |

## Primary-review fixes applied to subagent output (in `f6fa193`)
1. **Pass after a client save never ran.** `closeModal` (`ui.js:468-477`) hides the overlay 200 ms later; the wrapper's modal check saw it still open and skipped. OBSERVED in the preview (slot saved, `through: null`, 0 rows). Fix: the check keys on `.modal-overlay.modal-active` (`recurring.js` `modalOpen`), the overnight guard in `ui.js` likewise; flow test fake updated; mutation (old predicate) → test red.
2. **Generated-row predicate** tightened to `s.recurring && s.recurring.slotId` in `sessions.js`, `this-week.js`, `payments.js`: the fabricated fixture carries legacy `recurring: {seriesId}` objects. Real data (recovery r093, aggregate count only): 78 rows, all `recurring: null`, so no legacy objects there.
3. **Chokepoint regex** in `tests/recurring-writer.test.cjs:111` flagged `through: null` with a space (`\s*` backtracking); now `through\s*:(?!\s*null\b)`.
4. E3's untouched-slot rule, E2's wrapper names (`repository.maintenance`, `App.state.activeTab`, `renderTab`, `updateHeaderStats`) traced to live code.

## Gates
- `node --test` 244/244 (was 221 at the start of E; +4 writer, +6 flow, +7 modal, +6 polish); `node --test tests/slice1/static-guard.test.cjs` 18/18; `node --check protected/js/*.js` clean.
- Mutations red then restored byte-identical: E1 ×3 (exists-throw, `!s.recurring` remove guard, forged `'rec:'` in clients.js); E2 ×3 (runCommand route, modal guard, kill switch) + primary ×1 (modal-active predicate); E3 ×3 (edited slot keeps id, untouched slot new id, slotProblem gate); E4 ×3 (`!paid` in staleSlots, recurring check in autoLoggedCount, weekly tag).
- OBSERVED on the fabricated preview (dark, desktop): Edit client → Weekly schedule rows (Day/Time/Type/Every/First session/duration chips/+ Add); Save → +2 revisions (client.save + pass), 4 Thursday rows `16:00` at the client's rate, `through` = window end; "weekly" tags in the table (6) and the week group (2). Notices empty (no gaps/skips in the fixture).
- NOT observed: light theme; the Record-payment sentence; the gap/skipped notice and the nudge with real content; the `visibilitychange` trigger (fake window has no event plumbing; pinned statically only); the pause chip end to end; real data.

## Kill switch / reversal
`App.features.recurringPass = false` (one line in `recurring.js`) stops all passes; generated rows stay ordinary sessions; slots stay inert on clients. A `git revert` of the three commits needs no store migration (older JS ignores `slots` and `recurring`; the writer test reopens the envelope and verifies).

## Post-deploy signal to watch
After "Ship it" and a hard refresh: add one real slot → the Sessions tab should show 4 new scheduled rows with the "weekly" tag within a second, and the Backup pill should move by exactly +2 changes (save + pass). If rows do not appear, the modal-fade race or the kill switch is the first suspect.

## Follow-ups (not in this slice)
- ⚠️ `SECURITY-PRIVACY.md:21` new row is published privacy text — MTH to read/veto.
- `slots: []` is now written on every client save (empty array; harmless, but every finalized session's clients snapshot carries it).
- 640 px: the slot fieldset has no wide descendants (measured); the page's 865 px scroll width at 640 px comes from the PRE-EXISTING header (`header-right` with the sync note + backup pill) once data and the backup pill are present. Not touched here; separate task.

## Independent fresh-eyes review (fleet-reviewer, read-only)
Verdict GO with low-severity items. Taken: the writer now also refuses to remove a generated row that is paid, waived, noted or has miles ("Edited generated sessions stay"), pinned in `tests/recurring-writer.test.cjs`, mutation red then restored. Ruled no change: two slots on the same weekday both create rows (spec §1: "two slots on one day coexist"); the ~16 ms window between `openModal` setting `hidden=false` and adding `modal-active`, and a form opened during a pass's IndexedDB write, can make that form's Save fail "Stale action" once (reopen the form; nothing is lost). Reviewer did not read the E4 predicates or run mutations itself; those were mutation-verified by the primary and the slice agents above.
