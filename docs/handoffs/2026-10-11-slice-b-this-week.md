# 2026-10-11 — Slice B: "This week" group in the Sessions tab + one-tap exceptions + Undo (design contract + closeout)

Tool: Claude Code, Fable 5.1. Branch `this-week-group` off `main` @ `b7e7394`. Nothing pushed. Roadmap: `~/.claude/plans/stateless-bouncing-codd.md` §3 Slice B.
Fabricated fixtures only (public repo). No real data read this session.

## 1. What shipped (local branch)

The Dashboard strip MTH removed on 2026-09-29 is back as a collapsible group at the top of the **Sessions** tab (plan ruling 2: exception loop lives there), above the Owed panel. Every session dated today-7 .. today+7, grouped by day, time order, today highlighted, a "+" per day that opens the session form pre-dated.

Chips per row state (ported from commit `1d9eacc`, same rules):

| row | chips | command | Undo |
|---|---|---|---|
| unlocked, dated after today | Skip | `session.delete` | re-saves the STORED record (byte-identical) via `session.save` |
| unlocked, today or earlier | Happened / No-show / Cancelled | `session.update` | No-show / Cancelled: correction back to completed. Happened: none |
| locked (finalized or archived), unpaid | same three, current one lit | one `session.correct` per tap | correction back to the previous status (none if it was `scheduled`) |
| paid (any) | same three, disabled | refused with a warning toast whatever the DOM sends | — |
| locked, completed, unpaid | + Mark paid | existing `session.payment` | — |

NEW vs the old strip: an **"N sessions auto-completed since your last visit"** section at the top of the group. `autoCompleteOverdue` (`sessions.js`) now reports the ids it completed; they sit in the notice (any date, each with the three chips) until the row is reviewed (its status leaves `completed`), deleted, or MTH taps **Dismiss**. Bookkeeping key: localStorage `tutoring-last-seen` = `{ at, autoCompleted: [ids] }`. Ids only; pruned on every render so it never grows; storage failure is silent (notice becomes per-load).

## 2. Blast-radius map (traced)

- `protected/js/this-week.js` NEW (pure model `thisWeekDays` / `thisWeekNotice`, pure markup `thisWeekHtml`, `renderThisWeek`, `App.thisWeek.{recordAutoCompleted,dismissNotice,pending}`). No `App.state` writes, no commands, no `style.display`.
- `protected/js/sessions.js`: `renderSessions` first statement calls `App.renderThisWeek()`; `autoCompleteOverdue` collects `completedIds` and hands them to `App.thisWeek.recordAutoCompleted`, then redraws the group.
- `protected/js/ui.js`: `groupRefusesPaid`, `undoToStatus`, `OUTCOME_WORDS`; cases `quick-complete` / `quick-noshow` / `quick-cancel` (restored) and `this-week-status` / `this-week-skip` / `this-week-add` / `this-week-dismiss`. `showToast(message, type, action)` was already in place.
- `protected/index.html`: `<details class="monthly-summary this-week" id="this-week" open>` after the bulk bar, before `#sessions-owed`; script `this-week.js` after `week-log.js`.
- `protected/styles.css`: `.this-week-*` and `.tw-*` rules next to the existing `.toast-action` block.
- `tests/slice1/static-guard.cjs`: `tutoring-last-seen` added to `uiPreferenceKeys` (the only allow-list change).
- `tests/helpers/ui-app.cjs`: `this-week` added to `PAGE_SCRIPTS`.
- `tests/backup-status.test.cjs`: one exact-dump assertion now ignores the new key (its fixture auto-completes `a6` on boot).
- `SECURITY-PRIVACY.md`: one table row for the new key. ⚠️ Published privacy text: MTH reads it once and vetoes if he does not want it stated.
- `repository.js`, `record-policy.js`, `dashboard.js`: untouched. No event type, schema or envelope change.

## 3. Verification

- `node --test`: **198 / 198** (was 187; `tests/this-week.test.cjs` adds 11). `node tests/slice1/static-guard.cjs` PASS. `node --check protected/js/*.js` clean.
- MUTATION-VERIFIED (each applied, watched red, restored byte-identical via `cmp`):
  1. paid guard removed from `this-week-status` → 1 red ("paid rows cannot be changed").
  2. locked tap routed through `session.update` instead of `session.correct` → 3 red (repository refuses; evidence tests).
  3. Skip Undo re-saves the READ view instead of the stored record → 1 red (byte-identical pin).
  4. `tutoring-last-seen` dropped from the guard allow-list → guard fails "Storage writer outside repository" + 1 red.
- OBSERVED on the fabricated preview (`preview_start` protected-static, 127.0.0.1:8877, revision 2 → 11), dark and light, 1024 px and 640 px:
  - group drew 4 rows across Mon Oct 5 / Tue 6 / Wed 7 / Today Sun 11; badge 4.
  - No-show on a locked unpaid row: +1 revision, exactly one correction event, stored row byte-identical, Owed $593.84 → $470.38, No-show lit, Mark paid gone, toast "Marked as no-show · Undo".
  - Happened → Undo: Owed back to $470.38 / status no-show, third correction event, "Back to no-show".
  - Two fabricated rows saved (future Oct 14 scheduled; overdue Oct 9 scheduled) → reload → init auto-completed Oct 9, notice "1 session auto-completed since your last visit" with its date + chips, key `{"at":…,"autoCompleted":["preview-overdue"]}`.
  - Skip on Oct 14: row gone (13 rows, rev 10) → Undo: 14 rows, rev 11, stored record byte-identical, not locked, Skip chip back.
  - Dismiss: notice gone, key `autoCompleted: []`, store untouched, Oct 9 row back under its day.
  - 640 px: rows wrap cleanly; the page's horizontal overflow there is the header stat pills and the sessions table (pre-existing, not the group).
  - Browser HTTP cache served the old `sessions.js` after the first reload; a `cache: 'reload'` fetch fixed the preview. On the live site the same can happen → MTH hard-refreshes once after a deploy (as with Slice A).
- NOT observed: real data; the archived (`session.status`) auto-complete path in a browser (unit-tested in `this-week.test.cjs`).

## 4. Rulings made (veto in one word)

1. Group sits above the Owed panel, open by default, open/closed choice kept for the page load only (not persisted). Veto: "Closed".
2. Notice rows are drawn once, in the notice, not again under their day; Dismiss returns them. Veto: "Twice".
3. The notice key stores ids only and is pruned on render. Veto: "NoKey" (then the notice is per-load and `SECURITY-PRIVACY.md` row + guard entry come out).
4. `quick-*` handlers restored exactly as they were before 2026-09-29 (they had been removed with the strip). No veto needed; noted for the record.

## 5. Next

- SHIPPED 2026-10-11: `main` `b7e7394 → 99ba1b8`, 5 live files + SECURITY-PRIVACY.md curl-verified. MTH: hard-refresh once, confirm counts match the last recovery file, read the new `SECURITY-PRIVACY.md` row.
- Then Slice C ("Usual" tiles on the session form, reuses `App.sessionSignatures`).
