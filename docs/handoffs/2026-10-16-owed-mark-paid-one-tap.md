# Owed panel: Record payment modal → one-tap Mark paid (2026-10-16, Claude Code, Fable 5.1)

MTH asked: "get rid of the dialog box and just mark it paid."

## What changed
- `protected/js/dashboard.js` `renderOutstanding`: the per-family button is now `data-action="mark-group-paid"`, label "Mark paid".
- `protected/js/ui.js`: `mark-group-paid` case calls `App.markGroupPaid(key, label)`; the `record-payment` / `save-record-payment` cases and the `record-payment-amount` input listener are gone.
- `protected/js/payments.js`: `openRecordPayment` / `previewRecordPayment` / `saveRecordPayment` and `paymentRevision` replaced by `markGroupPaid`: reads the revision at the tap, pays every OWN unpaid session for the group (via `allocatePayment(own, MAX)` so the order and total are the same pure model), one `session.payment` command, `date = todayISO()`, `method = familyDefaultMethod(key)` when set. Shared sessions untouched (toast explains when nothing own is left). Toast carries the auto-logged sentence (E4) and the shared-sessions note. `allocatePayment`, `familyDefaultMethod`, `autoLoggedCount` kept and still exported.
- `protected/index.html`: `#modal-record-payment` markup deleted. `protected/styles.css`: `.record-payment-owed` / `.payment-preview*` rules deleted.
- Tests: `tests/family-payment.test.cjs` modal test rewritten as two tests (one-tap writes 4 dated events with the method, Owed/statement agree, stored originals untouched, shared-only group refuses; no-method case stores no method, stale revision refused); source guards flipped (modal absent, `mark-group-paid` present). `tests/recurring-polish.test.cjs` sentence test now reads the toast.

## Rulings (veto if wrong)
1. Partial payments can no longer be entered from the Owed panel; it is all-or-nothing per family. The table still marks single sessions. Reason: MTH asked for one tap; the modal existed only for amount/date/method.
2. Payment date = the day of the tap (cash basis, audit 6e unchanged). Recording a past date now means editing the session row.
3. Method = the family's "Usually pays by" when set, else none. The client-form field stays.

## Evidence
- `node --test` 246/246 (was 245: +2 tests, −1). Static guard inside the suite PASS. `node --check` clean on payments.js / ui.js.
- Mutation: dropping `payload.method = method` → family-payment 1 fail, restored byte-identical.
- OBSERVED on the fabricated preview (protected-static, localhost:8877, dark, 800 px): Sessions → Owed open → "Mark paid" → no modal, toast "Marked paid: 1 session, $100.00 for Fixture Family", payment event `{sessionId 3, date 2026-10-16}`, revision 0 → 1, Owed $0.00 "All caught up", header pill $0.00. Console errors: favicon 404 only.
- NOT observed: light theme, 640 px, real data, a family with a usual method set (unit-tested only).

Next: "Ship it".
