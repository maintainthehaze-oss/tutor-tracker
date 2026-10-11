# 2026-10-11 — Slice D: Family payment intake + statement PDF (Claude Code, Fable 5.1)

**State: SHIPPED. `main` 3867466 → c8241cd, pushed by MTH from his own terminal on "Ship it" (the fleet gate refused the push from this session). All 9 changed live files under `protected/` plus root `SECURITY-PRIVACY.md` verified via curl on the second poll, ~40 s after push.**

## 1. What it does

- **Owed panel → "Record payment"** (replaces the one-tap "Mark paid" per family, on the Sessions tab and the Dashboard). The modal shows what the family owes, pre-fills the full amount, today's date and the family's usual method, and allocates the amount **oldest-first across the family's OWN unpaid sessions** (`owedSessionsForGroup(key).own`). Whole sessions only: a partial amount is refused with the two nearest whole amounts ("$123.46 pays 1 session; $246.92 pays 2 sessions"); more than owed is refused too. Save is disabled until the amount is exact.
- **One `session.payment` event per covered session, dated the day the money arrived** (audit 6e: a January payment for December sessions now lands in January's tax year). All events in ONE revision. Stored rows never change.
- **Payment method** rides on the event (`method`, optional, ≤40 chars) and is overlaid on the read view as `paymentMethod`. Events written without a method are byte-identical to pre-Slice-D events (no key at all).
- **Client field `defaultPaymentMethod`** ("Usually pays by": Cash / Check / Venmo / Zelle / PayPal / Card / Other / not set) in the client form; the modal defaults to the first family member's value (active members first).
- **Statement PDF** (Tax Summary tab, next to Export PDF): family + month pickers + "Statement PDF". Rows = the month's completed sessions touching the family (shared sessions show the family's even share in a "This family" column that only appears when needed), month totals = that family's `computeMetrics` rollup, **Balance due (all time) = `computeOwedByFamily`** for that family, so it equals the Owed panel by construction.
- Sessions shared with another family are never touched from the panel; the modal says so and the table still marks them.

## 2. Files

- NEW `protected/js/payments.js` — pure `allocatePayment`, `familyDefaultMethod`, `statementGroups`, `statementModel`, `buildStatementPDF`; UI `openRecordPayment` / `previewRecordPayment` / `saveRecordPayment` / `renderStatementControls` / `exportStatementPDF`. The only write is one `App.runCommand('session.payment', …)`.
- `protected/js/repository.js` — `session.payment` case accepts optional `method` (validated; event-only). No new command, `default:` untouched.
- `protected/js/record-policy.js` — `applyEvents` overlays `paymentMethod` from a payment event.
- `protected/js/dashboard.js` — Owed row button → `record-payment`. `protected/js/ui.js` — `mark-group-paid` case removed; `record-payment`, `save-record-payment`, `export-statement-pdf` cases; live preview on amount input.
- `protected/js/clients.js` — reads/writes `defaultPaymentMethod`. `protected/js/reports.js` — one line: `renderStatementControls()` after the tax summary renders.
- `protected/index.html` — `#modal-record-payment`, `#client-default-payment-method`, `#statement-family` / `#statement-month` / Statement PDF button, `js/payments.js` script tag (after reports.js, before ui.js).
- `protected/styles.css` — `.record-payment-owed`, `.payment-preview(-error)`, `.statement-controls` (8 lines, LF in the index).
- NEW `tests/family-payment.test.cjs` (7 tests); `tests/helpers/ui-app.cjs` boots `payments`.
- `SECURITY-PRIVACY.md` — ⚠️ one new data-inventory row (client `defaultPaymentMethod`, event `method`). **Schema addition**: a client record may now hold `defaultPaymentMethod` ('' when not set, written on every client save). No storage key change.

## 3. Verification

- `node --test`: **213/213** (was 206). `node --check` on every `protected/js/*.js` clean. `node tests/slice1/static-guard.cjs` PASS.
- MUTATION-VERIFIED, 7 of 7 red, each restored byte-identical by SHA-256:
  1. partial amount accepted → 2 red. 2. newest-first allocation → 2 red. 3. event dated today instead of the date received → 1 red (2027 tax year). 4. method dropped from the event → 3 red. 5. statement balance = this month instead of `computeOwedByFamily` → 2 red. 6. shared sessions allocated from the panel → 1 red. 7. read view ignores the event method → 2 red.
- OBSERVED on the fabricated preview (127.0.0.1:8877, store at revision 13 → 15, dark theme, pane width 1186 px; light theme spot-checked via `data-theme`):
  - Owed row shows "Record payment"; modal opens pre-filled ($617.30, today, method none, "Pays 5 sessions, oldest first…").
  - Typed 200 → amber "does not cover whole sessions. $123.46 pays 1 session; $246.92 pays 2 sessions", Save disabled.
  - 246.92 + date 2026-09-30 + Venmo → Save: revision 13 → 14, 2 payment events `{date 2026-09-30, method Venmo}` on the two oldest rows, Owed $1,067.30 → $820.38, header pill updated, toast "Recorded $246.92: 2 sessions paid".
  - Client form "Usually pays by" → Zelle, saved (revision 15); reopening Record payment pre-fills Zelle.
  - Tax tab: Statement row (family select populated, month = current), real jsPDF built a 1-page 14,172-byte statement whose balance line ($1,470.38) equals the Owed panel, paid rows carry "Venmo".
  - Side effect of the observation, not of this slice: saving the fixture client re-canonicalised "fixture family " into "Fixture Family" (existing `canonicalFamily` rule), merging the two fabricated groups.
- NOT observed / UNVERIFIED: 640 px (the pane's viewport emulation did not apply; `innerWidth` stayed 1186 — the modal reuses `.modal.modal-sm`, same as the tax-payment modal); a real PDF download (built in memory instead); real data; whether MTH's legacy rows store the method under `paymentMethod` (the overlay uses that name).

## 4. Rulings made (veto in one word)

1. "Record payment" REPLACES the per-family "Mark paid" button (modal pre-filled = same 2 taps, now with a date and method). Veto: "Both".
2. Over-payment is refused, not stored as credit (keeps the per-session event model; nothing new to store). Veto: "Credit".
3. Method is a free short label validated in the repository (≤40 chars); the UI offers 7 options. Veto: "Strict" (allow-list in the repository).
4. Existing `session.payment` extended with an optional field instead of a new command. Veto: "New command".
5. Statement controls live on the Tax Summary tab next to Export PDF, not in the Owed panel. Veto: "Panel".
6. `defaultPaymentMethod` is written as '' on every client save (so clearing it sticks through the merge). Veto: "Omit".
7. ⚠️ Privacy row added to `SECURITY-PRIVACY.md` §1 (published text). Veto: "No row".

## 5. Next

- MTH: "Ship it" → fast-forward `main`, push from his own terminal, curl-verify the 11 changed live files, hard-refresh once.
- Real-data checks only MTH can make: a lump payment on a real family; whether legacy rows' method shows on a statement.
- Then roadmap §4 refactors 4.1 / 4.3 / 4.5 (4.3 now has `paymentMethod` on the overlay to fold in).
