# Security & Privacy — Master File

Tutoring Tracker Pro (the protected app under `protected/`). This file is the single
source of truth for where data lives, what can leave the device, and the status of
every finding. Update it whenever a data flow or finding changes. Published privacy
promises are the owner's decision; this file describes what the code does.

**Last full audit of the original app:** 2026-07-10.
**Rewritten for the protected app:** 2026-09-29 (traced to live code at `main` 0f26803).
The original-app audit (CDN scripts, Gist sync, service worker) is history: that app
is retired and no longer loads (root `index.html` only redirects to `protected/`).

---

## 1. Data inventory (this device only)

| Where | Contents | Sensitivity |
|---|---|---|
| IndexedDB `tutor-tracker-protected-production` | The protected store: working records (clients, sessions, expenses, tax payments, settings), the immutable archive of every pre-activation record incl. historical sessions and the raw legacy snapshot, finalize snapshots (record + clients + report settings at lock time), append-only events, receipts | HIGH (settings include the ORS API key) |
| localStorage `tutoring-clients`, `-sessions`, `-expenses`, `-tax-payments`, `-historical`, `-recurring`, and legacy IndexedDB `tutor-tracker`/`receipts` | The retired app's stores. Read ONCE at activation and archived; never deleted, never read again by the protected app. `tutoring-settings` (which held old secrets) was removed 2026-09-29 | HIGH (same records as the archive) |
| localStorage `tutoring-theme`, `tutoring-show-split` | UI state | none |
| localStorage `tutoring-backup-meta`, `tutoring-backup-snooze` | Backup reminder bookkeeping: record revision number and time of the last backup from this browser; when the reminder was last shown/snoozed. No records, no secrets | none |
| Finalize snapshots locked before 2026-09-29 | May still contain the ORS key copied from settings at lock time. Immutable; cannot be purged | MEDIUM (historical secret) |

Since 2026-09-29 the settings copy inside a finalize snapshot EXCLUDES the ORS key and
any gist/token-shaped field (`repository.js` `withoutSecrets`, pinned by a test).

## 2. Every path data can leave the device

1. **OpenRouteService** (`protected/js/sessions.js`) — only when the owner clicks the
   mileage pin in the session form or Settings > "Calculate mileage by day" (explicit
   confirm with counts). Sends the business address and the client addresses being
   routed, for geocoding and driving directions. The API key travels in the
   `Authorization` header for BOTH calls (never in a URL). Nothing runs in the
   background; hand-entered miles are never overwritten.
2. **Files the owner downloads** — Settings > Backup writes
   `tutor-tracker-recovery-YYYY-MM-DD-rNNN.json`, the full private snapshot including
   settings (so it may contain the ORS key). PDF/CSV exports contain report figures and
   client names. These stay wherever the owner saves them; the app uploads nothing.
3. **GitHub Pages repo (public)** — code and fabricated test fixtures only. `.gitignore`
   blocks `historical_sessions.json`, `tutoring-backup-*.json`, `*recovery*.json`,
   `local-config.js`, `*.bat`. Anything committed is world-readable, including history.

There is **no cloud sync**: `protected/js/sync.js` is a local-only rehearsal with no
network transport, and its controls are hidden on the live site. There are no CDNs
(reporting libraries are local copies in `protected/vendor/reporting`), no web fonts,
no analytics. Receipt OCR (Tesseract) and PDF rendering (pdf.js) run on-device from
same-origin files; a receipt never leaves the browser.

The Content Security Policy in `protected/index.html` enforces this: `script-src 'self'`,
`connect-src 'self' https://api.openrouteservice.org`, `object-src 'none'`.

## 3. Controls in place (traced 2026-09-29)

- Immutable evidence: pre-activation records and finalized sessions cannot be edited or
  deleted; changes are append-only events with timestamps. Deleting a locked row is
  impossible by policy.
- Every write is a named repository command with a revision check (no lost updates).
- Secrets excluded from finalize snapshots; portable export/import refuses any
  credential- or connection-shaped field rather than silently redacting it.
- The ORS key field is `type="password"`; the key is stored in settings only.
- `escapeHtml()` on every user value inserted into the page, including values used as
  class names. No inline scripts or `on*` handlers (CSP would block them anyway).
- Backup reminder: header pill turns amber after 7 days or 10 saved changes without a
  backup; banner at most once a day. Persistent storage is requested from the browser
  (grant UNVERIFIED on the owner's device).
- Service workers: none registered; `upgrade-shim.js` unregisters leftovers and
  `sw.js` files are kill switches that clear only `tutor-*` caches.

## 4. Findings log

| # | Finding | Severity | Status |
|---|---|---|---|
| F1–F2 | Original app: PAT stranded in plaintext localStorage; old gist revisions held PAT, ORS key, home address | High | **Closed 2026-07-10** (cleanup on load; gist deleted, PAT revoked). Moot since Gist sync no longer exists |
| F3 / F3a | Client family surname + first names in a public code comment / in repo history | Medium / Low-Med | Comment fixed and deployed 2026-07; history retention **accepted** by owner (names only) |
| F4, F5, F8, F9 | Original app: settings denylist, missing SRI, unsaved-field trap, broken jsPDF CDN URL | Medium–High | **Closed**: deployed 2026-07, then made moot by the protected app (no sync, no CDNs) |
| F6 | ORS geocode key in URL query string | Info | **Closed 2026-09-15** — both ORS calls use the Authorization header |
| F7 | 30 s tab freezes | Info | **Closed** — tooling artifact |
| F10 | ORS key copied into every finalize snapshot and every recovery file, immutably | Medium | **Fixed 2026-09-29** for new snapshots (owner ruling); earlier snapshots keep it (see §1) |
| F11 | No-edit Save on a locked paid session with no payment date wrote a false `paymentDate` correction (moved income across tax years) | Medium | **Fixed 2026-09-29** |
| F12 | Legacy `tutoring-settings` in localStorage still held an old ORS key, gist token and Google Maps key from the retired app | Low | **Closed 2026-09-29** — key removed from the owner's browser at his request; app reloaded with all 144 sessions / 12 clients intact. Other legacy `tutoring-*` keys left in place |
| F13 | Fresh-restore guard (`repository.js` `guardFreshImport`) compares EVERY `tutoring-*` localStorage key against the activation snapshot, including UI/bookkeeping keys added since (`tutoring-backup-meta`, `-snooze`, `-theme`) and now the removed settings key. A recovery restore into an EMPTY protected store on this same browser would be refused with "does not match this device's existing legacy records" until those keys are cleared | Low (only on disaster recovery) | **Open** — fix: compare record keys only, or ignore keys absent from the snapshot. Workaround: clear all `tutoring-*` keys and the legacy `tutor-tracker` database before restoring |

## 5. Standing rules

- Data files and recovery files are never committed, pushed, or quoted in commits/docs.
- No real client names, addresses, emails, phone numbers or the home address anywhere
  in code, tests, comments, docs or commit messages — this repo is public. Tests use
  fabricated fixtures only.
- Secrets live only in the protected store's working settings on-device. Never in
  source, never in a finalize snapshot, never in a URL.
- Any new external endpoint must be added to this file AND the CSP before use. Cloud
  sync stays off unless the owner rules otherwise.
- Do not roll back deployed JS once real data holds an event type the older code
  cannot read.

## 6. Re-audit checklist

- `git grep` full history (`git rev-list --all`) for address fragments, ZIP,
  `ghp_`/`github_pat_`, ORS key prefix, client names.
- Confirm `connect-src` in `protected/index.html` is still self + api.openrouteservice.org
  and `script-src` is `'self'` only.
- Confirm `.gitignore` still covers data, recovery and private config files.
- `node --test`: the secret-strip, read-guard, transfer-guard and portable tests pass.
- On the live device: DevTools > Application shows only the databases and keys in §1.
