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

## Follow-up (same day): "Fill missing mileage" + delete question

MTH: "how can we fix other sessions where it hasn't been calculated" and "now I can't delete a session".

**Delete**: not a regression. The trash icon is disabled (title "Read-only record") on every locked
row: pre-activation archived sessions and any session finalized as completed/cancelled/no-show
(repository `finalize()` runs on save when status != scheduled). Unlocked (scheduled) rows delete
normally; verified on localhost (Sep 20 scheduled row deleted, confirm text correct, locked row's
button disabled). Ruling: keep the lock (MTH's own append-only evidence policy from earlier today);
the way to void a wrong locked session is pencil -> Status = cancelled, which drops it from revenue,
hours and miles.

**Fill missing mileage** (Settings > Mileage Calculation):
- `protected/js/sessions.js` `fillMissingMileage()`: candidates = sessions with 0 miles, type not
  online, status completed or scheduled, first client has an address. Grouped by address; confirm
  dialog states sessions/addresses/skipped counts and that N+1 addresses go to ORS. One geocode +
  one route per distinct address (geocode results cached per page load). Unlocked rows ->
  `session.update` per address group; locked rows -> one `session.correctMany` (append-only
  correction events, originals untouched). Key/network/home-address errors abort; "address not
  found" skips that group. Paced 250 ms (1.6 s when > 30 addresses) for the free ORS tier.
- `protected/js/repository.js`: new `session.correctMany` (same validation as `session.correct`,
  all-or-nothing, one revision). Also removed a duplicated, unreachable `case 'session.correct'`.
- `protected/js/ui.js` action `fill-missing-mileage`; `protected/index.html` button + hint.

Verified on localhost with mocked ORS: 2 candidates at 1 address (one locked completed, one unlocked
scheduled), 2 skipped (client without address); ORS calls = 2 geocodes + 1 route; locked row got a
correction (mileage 74.6, mileageManual false, details string), unlocked row updated in place; rows
with existing miles (10/4/6) unchanged; online row untouched; second run says "Nothing to fill".
UNVERIFIED: real ORS key; runs > 30 addresses (pacing untested against the live rate limit).
SHIPPED 2026-09-15 (commit 053730e); live files verified via curl.

## Follow-up 2 (same day): day-sequential legs (MTH caught the double count)

MTH: "the Ventorinos have different mileage when they're the only session that day. Please check that
multiple sessions in one day are mapped sequentially." Correct: the fill gave EVERY session a full
home-and-back round trip, so two sessions on one day double-counted the home legs. The retired root
app (`js/sessions.js` computeDayMileage) routed each day home -> s1 -> ... -> sn -> home, credited each
stop the leg that arrived at it, added the return leg to the last stop, never overwrote manual
values, and never wrote a guess. Ported those exact rules into `protected/js/sessions.js`:

- `sessionAddress(s)`: stored session address, else the first of its clients with an address
  (family sessions = one stop, one address).
- `dayStops(date)`: in-person (not online), completed or scheduled, sorted by time (blank first).
- `planDay(stops)`: legs via `routeMiles(from,to)` (real ORS route only; geocode + route caches per
  page load; same-address consecutive stops = 0). Details string "Leg i of n [+ return home]
  (driving route, day order)". The haversine estimate and the round-trip helper are gone.
- Writable = `isAutoMileage(s)`: mileageManual !== true AND (0 mi OR details from THIS tool:
  "Driving route, round trip:", "Straight-line estimate", or the new "Leg ... (driving route, day
  order)"). Root-app "Leg n of m (real route)" values and hand-entered values are never written,
  but they still shape the day's route. Unchanged values (< 0.05 mi) are not rewritten.
- Settings button renamed "Calculate mileage by day" (action `calc-mileage-by-day`,
  `App.calculateMileageByDay`): candidates = days with any writable in-person session, all years;
  confirm states days/sessions/addresses; fatal ORS errors abort, a day with a missing address or no
  route is skipped (console lists them); unlocked -> `session.update` per row, locked -> one
  `session.correctMany`.
- Pin button is day-aware: inserts the form's session (date/time/first client address) into that
  day's stops, fills its leg, and warns when other auto sessions that day would change (run the
  Settings tool after saving). No background writes (policy).

Verified on localhost, mocked ORS with deterministic pair distances, expected values computed
independently from the mock: lone Springfield day 52.1 (x2 sessions on different days), lone
New Haven day 88.5 (x2, including the two 74.6 round-trip values from the earlier fill, both
corrected), two-stop day: leg 1 = 26.1, leg 2 + return = 114.5. 5 days routed with 3 geocodes and
5 route calls (pair cache). Rows with 10/4/6 mi untouched. Pin on a new 08:00 stop that day: 44.2
(Leg 1 of 3) and "1 other session that day will change". Re-run: "0 sessions ... 6 already correct",
revision unchanged. UNVERIFIED: real ORS key; MTH's 35 real sessions (his fill values will be
rewritten as day legs on the next run of the Settings tool).
SHIPPED 2026-09-15 (commit 2c38893); live files verified via curl.

## Follow-up 3 (same day): trash can on locked rows

MTH (after "Mileage set on 35 sessions across 20 days" on live data with a real key): "When I hit
the red trash can, it's still not deleting the sessions." Root cause is a UX trap, not a bug in
delete: the session form defaults Status to Completed, so every new session locks on save, and the
trash button was rendered `disabled` with no disabled styling, so it looked red and clickable but
the click never reached the handler (no toast, nothing).

Fix (`protected/js/sessions.js`, `protected/styles.css`):
- Trash on a locked row is now clickable (title "Locked: kept on file. Click to cancel it instead")
  and calls `voidLockedSession(s)`: already cancelled/no-show -> info toast; paid -> warning ("un-pay
  it first" via the pencil); otherwise a confirm that explains deletion is impossible and offers to
  mark it cancelled via a `session.correct` {status:'cancelled'} event (original kept; drops out of
  revenue, hours, miles). Unlocked rows delete as before.
- New CSS `.btn:disabled, .btn[disabled] { opacity: .45; cursor: not-allowed }` so any remaining
  disabled buttons (pin while routing, read-only view) look disabled.
- Ruling: true deletion of locked rows stays off (MTH's append-only evidence policy, one-way door).

Verified on localhost: locked unpaid completed row -> confirm text -> row shows cancelled, still
locked, correction recorded; locked paid row -> warning, status unchanged; already-cancelled locked
row -> info toast; unlocked rows unaffected; disabled opacity 0.45 after reload. Note: styles.css is
not cache-busted, so a hard refresh is needed to see the dimming.
