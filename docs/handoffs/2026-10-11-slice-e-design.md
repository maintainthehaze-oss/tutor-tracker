# Slice E design — weekly recurring slots, wiring the inert planner (2026-10-11, Claude Code Fable 5.1)

Stage 1 of `/process` (design only, no code). Supersedes the line numbers in
`chief-of-staff/audits/2026-09-19/tutoring-tracker-recurring-slots-design.md` (the "spec");
its data model, algorithm and five §6 rulings stand (MTH: "Accept all five", 2026-10-11).
All citations below are to live code in `production-release/` at `20515f5`, traced this session.

## 0. What already exists (spec slices 1–2 are DONE)
- Exception surface: the Sessions-tab week group `protected/js/this-week.js` (chips `:92-101`, Skip = `session.delete` with stored-copy Undo at `ui.js:796-805`, auto-completed notice `:148`, key `tutoring-last-seen` `:30`). The dashboard strip in the spec was removed 2026-09-29.
- Planner: `protected/js/recurring.js` is pure and INERT — `materializeRecurring(clients, sessions, today, horizon=28)` `:93`, returns `{create, removeIds, marks, skipped, gaps}` `:97`; exported `App.recurring` `:167`; 14 tests in `tests/recurring-engine.test.cjs`, the last of which (`:224-232`) ENFORCES that nothing calls it. That test is retired by E1 below and replaced with a stricter guard.
- Multi-row writer precedent: `session.saveMany` `repository.js:598-616` (insert-only, all-or-nothing, one revision).
- Existing data: no client has `slots`; every session carries `recurring: null` (`sessions.js:857`, `signatures.js:185`). No migration or backfill: a client gets slots only when MTH adds one, and the first pass creates rows from `max(today, anchor)` forward (spec §2.4). Nothing in old JS reads `slots` or `recurring`, so a revert to `20515f5` leaves the store openable (extra fields pass `validateNewSession` `repository.js:513-519`; client fields are free-form `:617-621`).

## 1. Blast-radius map
| Surface | File:line | Role |
|---|---|---|
| Writer (NEW case) | `repository.js:651` `default:` — add `case 'recurring.apply'` before it; the `default:` line must stay byte-identical (`tests/slice1/repository.test.cjs:216`, `:228` anchor on it) | the ONLY writer of generated rows and `client.slots.through` |
| Planner | `recurring.js:93` | the ONLY source of create/remove/mark plans |
| Wrapper + triggers | NEW `runRecurringPass()` in `recurring.js`; `ui.js:1073` after `autoCompleteOverdue`; `clients.js:312` after `client.save`; NEW `visibilitychange` listener (none exists today) | when a pass runs |
| Client modal | `index.html:1116` (status) … `:1139` (More fold) — "Weekly schedule" fieldset goes between Usually-pays-by and More; `clients.js:221` `openClientForm`, `:293-312` `saveClient` clientData (+`slots`) | where slots are edited; edited slot → new id + `through:null` |
| Slot defaults | `signatures.js:65` `sessionSignatures`, `:226` `App.weekPlan.usualFor/usualWeekdays` | pre-fill day/time/duration/type/with for a new slot |
| Client card | `clients.js:121-124` details line | "Tue 4:00 PM weekly" |
| Week group | `this-week.js:41-52` rowModel; `:92-101` chips | generated rows need NO change to work (they are ordinary scheduled rows); Slice E4 adds a "weekly" tag + gap/skipped notice + runaway nudge |
| Log-a-week grid | `week-log.js:50` `cellState` → `logged` for any session on that day (`:57` disabled) | generated rows already show as logged/disabled cells = the roadmap's "pre-ticked"; E4 only labels them |
| Auto-complete | `sessions.js:959-982` | unchanged (ruling 1: silent) |
| Lock snapshot | `repository.js:507-512` `finalize` clones the whole clients array | slots ride into every lock snapshot (ruling 3, accepted) |
| Record payment | `ui.js:653-658`, `payments.js` | E4 adds the "N logged automatically" sentence (the spec's Mark-paid confirm no longer exists: `ui.js:768` has no confirm) |
| Backup pill | `backup-status.js:55` revisions since backup | one pass = +1 revision (why one command) |
| Static guard | `tests/slice1/static-guard.cjs:20` mutators, `:27` key allow-list | no new localStorage key in E (gap notice is per-load, not dismissible-persisted) |
| Privacy text | `SECURITY-PRIVACY.md:20-23` | no new key → no new row. The client record gains `slots` (schedule data, on-device) — one sentence for MTH to veto |
| Read overlay | `repository.js:477` `applyEvents`, `record-policy.js:49-57` | unchanged; corrections on locked generated rows work today |

## 2. Chokepoint + bypass guard
**Chokepoint:** `recurring.apply` (writer) fed ONLY by `materializeRecurring` (planner) ONLY from `runRecurringPass` (wrapper). No surface may create a `rec:` id, delete a generated row because of a slot change, or touch `slots[].through` any other way. Slot EDITS go through `client.save` (existing) and never set `through` (always `null` on an edited/new slot).

**Guard test (fails the build if bypassed):** NEW `tests/recurring-writer.test.cjs` static section:
1. `'recurring.apply'` appears exactly once in `protected/js/**` outside `repository.js`, inside `recurring.js`'s `runRecurringPass`, and is invoked via `App.repository.execute(...)` (not `runCommand`, so a second tab's CAS refusal is silent — spec §2 wrapper).
2. `materializeRecurring(` is called exactly once outside its definition, in `runRecurringPass`.
3. No file outside `recurring.js` contains the literal `'rec:'` or writes `through` (`/through\s*[:=]/` only in `recurring.js` and the `through: null` in `clients.js` saveClient).
4. `repository.js` diff rule: the `default:` anchor still appears exactly once; `validateNewSession`, `finalize`, `validateTransition`, `seal` sources byte-identical to a pinned hash captured in the test.
Mutation: adding a second `execute('recurring.apply'` call anywhere → red; calling the planner from `clients.js` → red.

## 3. Invariants (design for N)
- **One revision per pass**, all-or-nothing, insert-only for sessions (same shape as `saveMany`), remove-only for `scheduled && recurring` rows, `slots` replaced wholesale per marked client.
- **Generated rows are ordinary sessions** once written: every existing surface (table, week group, grid, Owed, tax, payments, corrections, mileage-by-day) works with zero changes. A new surface plugs in by reading `s.recurring` (truthy = generated) and nothing else.
- **Idempotent**: id `rec:<slotId>:<date>`; writer refuses an existing id; planner skips existing ids and `D <= through`; store CAS wins once. Three layers, as in the spec.
- **The planner never touches a clock** (keeps `recurring-engine.test.cjs:199-232` minus the inert clause); `today` comes from `App.todayISO()` in the wrapper only.
- **Latency budget**: one pass = one CAS write ≈ 200 ms on the real store (measured for 4.2); must not run while a modal is open (`.modal-overlay:not([hidden])`) or it would make the open form "Stale action" (`repository.js:523`).

## 4. Failure modes + kill switch
| Failure | Effect | Containment |
|---|---|---|
| Pass runs while a form is open | form save fails "Stale action" | wrapper skips when any modal is visible; init runs it before the UI is interactive |
| Two tabs | second CAS loses | `execute` direct, error swallowed, no toast, no write (test) |
| Phantom row (session did not happen) | auto-completes silently, Owed includes it | week group chips (one tap), E4 payment sentence, runaway nudge after 4 unpaid generated rows |
| Away > 28 days | gap, never back-filled (ruling 4) | E4 gap notice in the week group |
| Hand-entered session same client same day | planner reports `skipped`, creates nothing | E4 skipped notice |
| Malformed slot from a buggy modal | `slotProblem` → `skipped`, never planned | modal validation + test |
| Store growth | +4 rows/slot/4 weeks; each lock snapshot carries `slots` | accepted (ruling 3); measured in E3 test at 10 slots |

**Kill switch (real):** `App.features.recurringPass` boolean read by `runRecurringPass` (default true), set in `recurring.js` only. Flip to false = passes stop, existing generated rows stay as ordinary sessions, slots stay on clients inert. Full reversal = `git revert` of E1–E3 commits: the store needs no migration back (fields are ignored by older JS, verified in E1's reopen test). Removing all slots from a client via the modal also drains its pristine future rows on the next pass (spec §1 table).

## 5. Phased slices (each independently shippable; each ships with its tests + mutation checks)
**E1 — writer + guard (Fable, this thread; `repository.js` touched).** `case 'recurring.apply'` per spec §5 slice 3 (composed of `select`, `assertEditableSessions`, `mergeRecord`, `validateNewSession`, `index`). Retire the inert clause at `recurring-engine.test.cjs:224-232`, add `tests/recurring-writer.test.cjs` (writer behaviours: refuse existing id, refuse non-generated/locked remove, all-or-nothing, envelope key set + `schema:2` + event types unchanged, reopen with `activate({stored})` verifies). Acceptance: 221+ tests green; `default:` anchor test still passes; static guard PASS. Mutations: drop exists-throw → red; drop `!s.recurring` guard → red.
**E2 — wrapper + triggers (Sonnet).** `runRecurringPass` + `App.features.recurringPass`; triggers at `ui.js:1073` (after auto-complete, own try/catch), `clients.js:312` (after save), `visibilitychange` (visible, day changed, no modal open → auto-complete then pass). Acceptance: fake-clock harness test — save client with Tuesday slot → +1 revision, +4 rows; again → +0; pause → future pristine rows gone; un-pause → back; CAS conflict → no toast, no write; modal open → no pass. Mutation: route through `runCommand` → silent-conflict test red.
**E3 — client modal + card (Sonnet).** "Weekly schedule" fieldset (Day/Time/duration chips/Type/Every/First session/Also attending tiles from same-family active clients/Remove/+ Add), defaults from `App.weekPlan.usualFor`; `saveClient` adds `slots` (edited → `generateId()` + `through:null`, untouched → byte-identical); paused/inactive note; card line. Acceptance: round-trip through `client.save`; untouched slot keeps id and `through`; mutation: edited slot keeping its id → red (the planner would then never replace rows).
**E4 — polish (Sonnet).** "weekly" tag in the table and week-group rows; sentence in Record payment ("N of these were logged automatically…"); gap + skipped notice in the week group (per-load, no key); runaway nudge pure `staleSlots(clients, sessions, today)` → "Still tutoring? [Pause]" chip; `SECURITY-PRIVACY.md` one sentence on `slots` (MTH veto); HANDOFF.
Order: E1 → E2 → E3 → E4. E1 and E2 both touch `recurring.js` tests → serialize. E3 and E4 touch different files and may run in parallel after E2.

## 6. Open questions before dispatch
None load-bearing: the five rulings are accepted. Two delegated rulings (veto in one word):
- **R1 "Also attending" defaults to the usual sibling set** from `sessionSignatures` when adding a slot (MTH's Tue/Thu trio). Veto "Blank".
- **R2 No new localStorage key in E** — gap/skipped notices are shown on every load until the gap is past; nothing persisted. Veto "Dismiss" (adds a key + privacy row).
