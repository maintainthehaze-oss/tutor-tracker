# 2026-10-11 — Slice F: hybrid sessions carry "Minutes in person" (Claude Code, Fable 5.1)

## What
Optional `inPersonMinutes` on a session, stored only when Session Type = Hybrid (null otherwise). The remote
part needs no travel leg: mileage-by-day and the form's pin button skip a hybrid row with 0 minutes in person.
Unset minutes on an existing hybrid row = legacy, still routed (behaviour unchanged). Uneven sibling hours
stay two rows; the form helper text says so instead of modelling per-client duration (plan §3 F).

## Files
- `protected/index.html`: `#session-in-person-group` (hidden by default) with `#session-in-person-minutes`
  under Session Type, plus the helper line.
- `protected/js/sessions.js`: `readInPersonMinutes` (hybrid only; blank = null; whole minutes ≥ 0),
  `syncInPersonGroup` (show for Hybrid), `hybridNoTravel` → `isDriveStop`; written on save and as a
  correction on locked rows; prefilled on edit, cleared on Add, carried by Repeat last / Usual tiles;
  table type note "Hybrid · 90 min in person"; pin button refuses 0 minutes. `App.isDriveStop` and
  `App.syncInPersonGroup` exposed.
- `protected/js/ui.js`: one line in the change delegation (`session-type` → `syncInPersonGroup`).
- `protected/js/record-policy.js`: `inPersonMinutes` correctable; null or non-negative integer.
- NEW `tests/hybrid-minutes.test.cjs` (+6).
- `repository.js` untouched (`session.save` keeps unknown fields; no schema/envelope change). No storage key.
- `SECURITY-PRIVACY.md`: not changed — it does not enumerate session fields (ruled; veto if you want a line).

## Verification
- `node --test` 253/253 (was 247), 0 fail. Static guard 18/18. `node --check protected/js/*.js` clean.
- 4 mutations red then restored byte-identical: hybrid-0 kept as a stop; minutes not rounded; correction
  never records minutes; policy accepts negatives.
- OBSERVED on the fabricated preview (dark, desktop, built-in browser): field hidden on Add, shown on Hybrid
  via the real change handler; Fixture Beta + Hybrid + 90 + $100 → Save → revision 11→12, stored
  `type:'hybrid', inPersonMinutes:90`; Sessions table shows "Hybrid · 90 min in person". Console: no app
  errors (3 pre-existing 404s for non-app resources, UNVERIFIED which).
- NOT observed: light theme, 640 px, mileage-by-day skipping a 0-minute row on a real route (needs ORS),
  real data.

## Next
"Ship it" → MTH pushes → curl index.html / sessions.js / ui.js / record-policy.js. Then 4.4 split (use
`buildRealistic()` from 4.7 for before/after timing).
