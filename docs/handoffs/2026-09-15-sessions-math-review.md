# 2026-09-15 — Sessions tab math / status review (Fable, NO CODE CHANGES)

Scope: `protected/js/sessions.js`, `app-core.js` (computeMetrics), `repository.js` session commands,
`ui.js` bulk/payment handlers, `report-model.js` rate(). Verified on localhost synthetic fixture
(`.claude/launch.json` → `protected-static`, python http.server; fixture auto-loads at `/`).

## Verified correct (synthetic data, all-time view)
- Totals: hours 5h30m, realized $380 (waived $50 excluded), miles 20.0, projected +$245.50 (waived scheduled $500 excluded). All match hand calculation.
- Owed by family $100 = the one completed unpaid session. Multi-client sessions split evenly; owed/report rollups agree.
- IRS mileage rates 2024/2025/2026 = 0.67/0.70/0.725 in BOTH `App.MILEAGE_RATES` and `reportModel.rate()`; deduction = miles x year rate.
- Payment date preserved on re-edit of an already-paid session; unpaid→paid stamps today.
- Every non-scheduled session is finalized on save (read-only). Payments on finalized rows go through append-only `session.payment` events.

## Findings (unfixed)
1. Totals row misaligned in the DEFAULT view (`protected/index.html` ~L468). `colspan="5"` assumes the checkbox column is visible; with checkbox hidden (normal mode) and Split collapsed (default), Duration total sits under Amount, Amount under Mileage, Miles under Payment. Measured via getBoundingClientRect. Aligns only in Edit Mode with Split hidden. Fix: `<td class="col-check" hidden></td><td colspan="4">Totals</td>…<td class="split-info"></td>…`.
2. Bulk "Mark Paid" can never succeed: only scheduled rows get checkboxes (everything else is finalized/locked) and `session.payment` requires status completed. Verified toast: "Complete the session before recording a payment". Also `select-all-sessions` (`ui.js` L673) adds ALL filtered ids incl. locked → "10 selected" with 2 checkboxes; Delete / Mark Unpaid then fail for the whole batch.
3. Payment date cannot be backdated: `record-payment`, `mark-group-paid`, `bulk-mark-paid` all use `todayISO()`. Cash-basis tax gross keys on paymentDate → late entry moves income across tax years.
4. `dashboard.js` L139 claims past-dated scheduled sessions auto-complete on load; no such code exists anywhere in `protected/js`. Overdue scheduled sessions never become revenue/owed and inflate Projected indefinitely.
5. "Record payment" button shows on Waived sessions (condition is only `!s.paid`, `sessions.js` renderSessionRow).
6. Cancelled / No-show rows show an "Unpaid" badge and their Amount but are excluded from totals/owed (status gate). Math consistent, display misleading. No-show fees (if ever charged) are never revenue.
7. Auto amount for multi-client sessions = AVERAGE client rate x duration (not sum). Business-rule question. Reports per-client $/hr gives each client full hours but a revenue share, so client vs family tables disagree (`reports.js` L184).
8. Minor: `formatDuration(1.999)` → "1h 60m" (quarter-hour inputs safe); `formatCurrency(-5)` → "$-5.00"; Payment sort treats Waived as Unpaid; legacy Split shows "0% / $40.00" when percent missing; form's calc-mileage button is dead (always warns).

Next step: MTH picks which of 1–6 to fix; 1, 2, 5 are mechanical. 3, 4, 7 need a ruling.

## Same day — fixes applied (Fable). SHIPPED commit 75c8b7b; live ui.js/sessions.js/index.html verified via curl ~140s after push
MTH rulings: no separate "Record payment" concept (just Mark paid); scheduled sessions auto-complete once the day has passed; fix 6; a family has one rate (7 needs no code: average of equal sibling rates = that rate).

Changes (`protected/index.html`, `protected/js/sessions.js`, `protected/js/ui.js`):
- Totals row: `<td class="col-check" hidden>` + `colspan="4"` + empty `.split-info` cell → aligned in normal, edit, and split-shown modes (measured via getBoundingClientRect).
- Row button "Record payment" → "Mark paid" (`data-action="mark-paid"`), hidden on waived rows; toast "Marked paid". Bulk "Mark Paid" button + handler removed. Select-all now adds only unlocked rows.
- `App.autoCompleteOverdue()` (sessions.js) runs in `ui.js init()` right after `loadData()`: scheduled + date < today + valid + unlocked → `session.update {status:'completed'}` in one batch, toast with count. Skips in maintenance mode. RISK: auto-completed sessions lock; a session that did not happen must be cancelled on or before its date.
- Cancelled / no-show rows show "—" for Amount and Payment; Unpaid filter excludes them; Payment sort buckets Paid / Unpaid / Waived.
Browser-verified on synthetic data: past scheduled row → completed + locked on reload (toast shown), Mark paid flips it and Owed drops, projected pill unchanged, footer aligned in all modes.
Known pre-existing: archived (imported historical) unpaid sessions have no Mark paid path — `session.payment` rejects archived rows — so the Owed panel's Mark paid errors for them.

## Later same day — archived sessions can now be marked paid (Fable). SHIPPED commit d9c56d0; live files verified via curl ~40s after push
Finding: activation (`stageLegacyActivation` / `activateSynthetic`, `repository.js`) puts EVERY pre-activation record in
`archive.manifest`, not just imported historical data. So all 122 of MTH's real sessions are "archived", and any that were
unpaid on 2026-09-09 could never be marked paid: `session.payment` threw "Read-only historical sessions" and the store
validator rejected payment events for archived ids. The Owed panel's Mark paid errored for those groups.

Fix (invariant preserved: originals stay byte-identical, `unchangedRows` still enforced; payments are append-only events
overlaid on read):
- `repository.js` validator: payment event target must be archived OR finalized (was: finalized AND NOT archived).
- `repository.js` `session.payment`: removed the archived rejection. Status must still be completed; one payment per session.
- `sessions.js` row: Mark paid button no longer hidden on archived rows; read-only detail shows "Later payment events" for archived rows too.
Browser-verified on the synthetic store (session 3, archived, completed, unpaid $100): Mark paid -> paid, paymentDate
stamped, Owed $100 -> $0, original record unchanged, event listed in the detail modal, store reopens after reload with the
event (validator accepts it). Second Mark paid correctly refused ("Payment already recorded"). Owed-panel group button uses
the same command (`ui.js` mark-group-paid) — verified by code trace only.

RISK still open: archived SCHEDULED sessions (any session that was still "scheduled" at activation on 2026-09-09) are
frozen forever — cannot be completed, cancelled, or paid, and they inflate the Projected pill. Auto-complete skips locked rows
on purpose. Needs a ruling: (a) allow status events on archived scheduled rows the same append-only way, or (b) MTH re-enters
them as new sessions and ignores the frozen ones. Unknown whether real data has any; check Sessions tab for Scheduled rows dated
before 2026-09-09.

## Later same day — pre-activation SCHEDULED sessions get status events (Fable). SHIPPED commit de52f44; live files verified via curl ~60s after push. MTH ruling: "allow status changes on the frozen scheduled ones"
Files: `protected/js/repository.js`, `report-model.js`, `sessions.js`, `ui.js`, `protected/styles.css`.
- New append-only event `{type:'status', sessionId, status:'completed'|'cancelled'|'no-show', recordedAt}`. Only valid for
  archived sessions whose stored status is `scheduled`. Last event wins (so a wrong choice can be corrected). Original row
  stays byte-identical; `unchangedRows` still enforced. Store validator checks status events first, then requires payment
  events to target an EFFECTIVE status of completed. `session.payment` uses the effective status and ignores status events
  when checking "already recorded".
- New command `session.status {ids, status}`. Refuses non-archived or non-scheduled originals, a no-op status, and any change
  away from completed once a payment event exists ("A paid session cannot be changed to …").
- Read view (`repository.read`) overlays `status` and sets `s.statusEvent = true`. `report-model.js` (current mode) now
  overlays BOTH status and payment events on legacy/archived rows too — before this, the 2026-09-15 archived-payment fix
  showed paid in the app but Reports/Tax still read those rows as unpaid. captured-v1 untouched (frozen on purpose).
- `autoCompleteOverdue` second batch: archived scheduled rows dated before today -> `session.status completed`.
- Sessions row: archived rows that were scheduled at activation show a small `<select class="archived-status">` in the
  Status column (scheduled / completed / cancelled / no-show; "scheduled" disabled once an event exists). Change ->
  `App.setArchivedStatus` -> command -> toast. CSS keeps the select at normal row height (measured 42px, same as other rows).
Browser-verified on a FRESH synthetic activation with fixture session 5 temporarily back-dated to 2026-09-01 (fixture restored
after, clean diff): load-time auto-complete emitted the status event (owed +$200, projected pill hidden, totals +2h/$200);
select -> no-show (amount/payment show —, owed drops) -> completed (last wins); Mark paid on the archived+completed row
worked; select -> cancelled on the paid row refused with toast and select reverted; report-model current: status completed,
paid, paymentDate; captured-v1: still scheduled/unpaid; original untouched; 4 events persisted and store reopened after
reload; Reports and Tax tabs render. Unverified: real data, real device.
Recovery/backup files: events array now may contain `type:'status'` entries. Older app versions would reject such a store
("Invalid or conflicting payment event") — do not roll back the deployed JS after any status event has been recorded.

## Later same day — LOCKED SESSIONS ARE EDITABLE via correction events (Fable). SHIPPED commit 7077e7d; live files verified via curl ~60s after push
MTH: "I want to be able to edit past sessions, one is marked as paid but it wasn't yet." Ruling (Fable, veto open): keep the
read-only originals, add append-only `correction` events instead of removing the locks.

Chokepoint: `App.recordPolicy.applyEvents(record, events)` in `protected/js/record-policy.js` — the ONLY place event overlays
happen (status, payment, correction; in event order, last wins; sets `statusEvent` / `corrected` flags on the view). Used by
`repository.read()`, the `session.payment` / `session.status` / `session.correct` commands, and `report-model.js` (current mode;
captured-v1 untouched). `validateCorrection(fields)` (same file) is shared by the store validator and the command.

- Event: `{id, sessionId, type:'correction', fields:{...}, recordedAt}`. Target must be locked (archived or finalized).
  Correctable fields: date, time, type, duration, amount, clientIds, address, notes, mileage(+manual/calculated/details),
  status (completed/cancelled/no-show only — never back to scheduled), paid, payment, paymentDate (null or date).
- Store validator now checks events STRUCTURALLY only (locked target, stamped, valid payload). Business rules live in the
  commands, because a later event can legitimately change the effective state (e.g. correction un-pays, then Mark paid again
  -> a second payment event is valid). `session.payment` and `session.status` check the EFFECTIVE state via applyEvents.
- New command `session.correct {id, fields}`.
- UI (`sessions.js`, `index.html`, `ui.js`): pencil on a locked row opens the normal edit form (title "Edit Session (original
  kept)", note + "View original" button that opens the read-only evidence modal; "scheduled" option disabled). Save computes
  the diff against what the form showed (defaults for fields older rows omit) and sends only changed fields; nothing changed ->
  "No changes". Client list now includes the session's own clients even if inactive (they were silently dropped before).
- NEW "Paid on" date field (`#session-payment-date`, shown when Payment = Paid) for new AND existing sessions — closes finding
  #3 (payments could not be backdated). Pre-filled with the stored payment date, so an already-paid session keeps its date
  unless MTH changes it. Inline edit-mode inputs and Delete stay blocked on locked rows (toast points to the pencil).
- Detail modal heading now "Later events (status, payment, corrections) — separate from the original record".
Browser-verified on a fresh synthetic activation: archived paid session 1 -> unpaid (owed +$120, original untouched); Mark
paid again (payment event after correction accepted); "Paid on" backdated to 2026-01-15 -> report current paymentDate
2026-01-15, captured-v1 still 2026-01-02; amount/notes correction on session 3 (totals +$10); no-change save; finalized
(non-archived) row -> cancelled via form (row shows —); "View original" opens the evidence modal listing 3 events; inactive
client kept on the session; store reopened after reload at rev 6; a notes-only edit records only `{notes}`; Reports/Tax/Dashboard
render; console clean. Unverified: real data, real device.
Compatibility: same one-way door as status events — older deployed JS rejects a store containing correction events.
