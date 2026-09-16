# 2026-09-15 — Mileage auto-calculator restored (Fable)

## Ask
MTH: "I want the autocalculator back." Since the protected app shipped, the pin button
next to Mileage in the session form only showed an "unavailable" toast, and the Settings
"Recalculate 2026 Mileage" button opened a confirm dialog and then also just warned.

## What changed
- `protected/js/sessions.js`: MILEAGE CALCULATION block rewritten. `calculateMileage(address)`
  resolves `{miles, method}` (round trip; `route` = ORS driving directions, `estimate` =
  straight-line x1.3 when ORS returns no route) or rejects with a user-facing message.
  No API key -> refuses (never guesses a figure that would feed the tax deduction; the old
  3/8-mile city fallback is gone). New `calcFormMileage()` (App.calcFormMileage): reads the
  first selected client's address, refuses for Online sessions, disables the button while
  running, fills `#session-mileage`, and stores provenance in `dataset.details`. Typing in
  the field clears it. Save paths (new, edit, correction) write `mileageDetails` from it and
  set `mileageManual = false` for auto-filled values. `recalc2026Mileage`/`autoCalcDayMileage`
  stubs deleted.
- `protected/js/ui.js`: `calc-mileage` -> `App.calcFormMileage()`; `recalc-2026-mileage` case
  removed; `saveSettings` now persists `orsApiKey` (it was loaded into the field but never saved).
- `protected/index.html`: CSP `connect-src` adds `https://api.openrouteservice.org` (it was
  `'self'` only, so the fetch would have been blocked even with a key); Settings bulk-recalc
  button replaced by a hint describing the per-session button.
- `protected/SECURITY-PRIVACY.md` item 2 updated (key in header for both calls, stored locally,
  excluded from sync).

## Verified (localhost, synthetic fixture, 2026-09-15)
- CSP: OPTIONS preflight to ORS returns 204 from the page; jsdelivr/example.com still blocked.
- Settings save persists businessAddress + orsApiKey.
- Pin with no client -> "Select a client first". Online type -> refuses with hint.
- Real request with a fake key -> "Could not reach OpenRouteService. Check the API key in
  Settings, or your connection." (curl confirmed ORS returns 401/403 WITHOUT CORS headers, so
  the browser cannot distinguish bad key from offline; the message covers both.)
- Mocked ORS (60,000 m one way) -> field 74.6, toast, Authorization header on all 3 calls,
  addresses URL-encoded in geocode text param. Typing "10" clears provenance; re-running
  restores it. Saved record: mileage 74.6, mileageDetails "Driving route, round trip: ...",
  mileageManual false, mileageCalculated true.

## UNVERIFIED
- A real OpenRouteService key end to end (none available in-session). Preflight + header
  contract match ORS docs and the pre-protected code that ran in production.
- Real device / real data.

## Next
- MTH: enter Business Address + ORS key in Settings on the live site after deploy, then try the
  pin on a new in-person session.
- SHIPPED 2026-09-15 (commit bfe7a7f, pushed after MTH created the deploy-gate file); live files verified via curl.
