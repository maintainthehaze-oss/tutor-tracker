# Security & Privacy — Master File

Tutoring Tracker Pro. This file is the single source of truth for where data
lives, what leaves the device, and the current status of every security
finding. Update it whenever a data flow or finding changes.

**Last full audit:** 2026-07-10 (code + full git history + live-app state)
**Last updated:** 2026-07-10 (round 2: F4/F5/F8/F9 fixes)

---

## 1. Data inventory (localStorage — this device only)

| Key | Contents | Sensitivity |
|---|---|---|
| `tutoring-clients` | Client names, contact info, addresses, rates, split history | HIGH |
| `tutoring-sessions` | Session dates, clients, amounts, mileage | HIGH |
| `tutoring-expenses` | Business expenses | MEDIUM |
| `tutoring-receipts` | Receipt images (~3.4 MB, base64) | MEDIUM |
| `tutoring-tax-payments` | Estimated tax payment log | MEDIUM |
| `tutoring-settings` | Business address, ORS API key, gist PAT/ID, invoice contact info | HIGH (secrets) |
| `tutoring-historical` | 1,652 sessions 2019–2025 | HIGH — **never leaves device** |
| `tutoring-theme`, `backup-banner-dismissed`, `tutoring-last-backup` | UI state | none |
| `tutor-gist-pat`, `tutor-gist-id` | LEGACY plaintext PAT — dead keys, deleted on app load since SW v25 | HIGH (historical) |

`sessionStorage: gist-token` — mirror of the PAT for the current tab session only.

## 2. Every path data can leave the device

1. **GitHub Gist sync** (`js/sync.js`, manual or auto push) → private gist,
   authed with the user's PAT. Payload: clients, sessions, expenses, receipts,
   taxPayments, and an **allowlisted** settings subset: businessName,
   mileageRate, defaultDuration, autoSync, autoBackupDays, lastBackup,
   darkMode, invoiceBusinessName, invoiceNotes. Everything else — secrets,
   home address, invoiceEmail/invoicePhone, legacy/unknown keys — never
   enters the payload, and a pull never overwrites the local copies of them.
   **Historical data is never included** (verified in code and live state).
2. **OpenRouteService** (`js/sessions.js`, mileage auto-calc) → sends the home
   base address and client addresses for geocoding/routing, plus the ORS key.
   Geocode key travels in the URL query (ORS's documented pattern; HTTPS, but
   may appear in ORS server logs). Directions key travels in a header.
3. **CDNs (inbound only)** — chart.js, jsPDF, jspdf-autotable, all from
   cdn.jsdelivr.net with SRI integrity hashes; Google Fonts. No app data is
   sent; scripts/fonts are fetched.
4. **GitHub Pages repo (public!)** — code only. `.gitignore` blocks
   `historical_sessions.json`, `tutoring-backup-*.json`, `local-config.js`,
   `*.bat`. Anything committed here is world-readable, including history.

There are no analytics, trackers, or other endpoints. The CSP `connect-src`
allowlist (self, api.github.com, api.openrouteservice.org, cdn.jsdelivr.net)
blocks any script from sending data anywhere else.

## 3. Controls in place (verified 2026-07-10)

- CSP meta tag restricts scripts (jsdelivr only), styles, fonts, and outbound
  connections to the known hosts. cdnjs removed from script-src.
- SRI integrity hashes (sha384) pin all three CDN scripts to exact bytes.
- Service worker never caches API responses (github/ORS/gstatic skipped).
- `sanitizedSettings()` is an explicit allowlist; pull restores device-local
  values (secrets + invoice contact info) over gist values.
- Sync push/pull warn on unsaved token/gist-ID fields instead of silently
  using stale saved values.
- `local-config.js` pattern keeps the home address default out of source.
- Historical module has no network code at all (by design, header comment).
- Settings fields for keys are masked in the UI.
- Legacy plaintext PAT keys deleted on app load.

## 4. Findings log

| # | Finding | Severity | Status |
|---|---|---|---|
| F1 | PAT stranded in legacy plaintext localStorage keys; sync silently dead | High | **Closed 2026-07-10** — cleanup on load, deployed (SW v25) |
| F2 | Old gist revisions contained PAT, ORS key, home address | High | **Closed 2026-07-10** — old gist deleted, old PAT revoked, new gist-scope PAT in use |
| F3 | Client family surname + three client first names in a public code comment (groupKeyForClient) | Medium | **Fixed in code 2026-07-10 round 2** — comment reworded; deploy pending |
| F3a | F3 names persist in public repo history (6 of 10 commits) | Low-Med | **Accepted risk** (user decision 2026-07-10): names only, no other data attached; revisit if repo gains visibility |
| F4 | `sanitizedSettings()` was a denylist; invoiceEmail/invoicePhone/invoiceNotes and any legacy key (e.g. googleMapsApiKey) rode into the gist | Medium | **Fixed round 2** — allowlist; invoiceEmail/invoicePhone excluded and pull-protected; deploy pending |
| F5 | CDN scripts had no SRI integrity hashes | Low | **Fixed round 2** — sha384 pins on all three, hashes computed from live CDN bytes; deploy pending |
| F6 | ORS geocode API key in URL query string | Info | Accepted — ORS's documented auth for geocoding; HTTPS in transit |
| F7 | ~30 s tab freezes seen during 2026-07-10 testing | Info | **Closed** — profiled live: slowest app op 167 ms; browser-tooling artifact, not app code |
| F8 | Push/Pull buttons read saved settings, silently ignoring unsaved field edits ("No GitHub token configured" trap) | UX/Low | **Fixed round 2** — `syncFieldsDirty()` guard warns "Unsaved settings — click Save Settings first"; deploy pending |
| F9 | jsPDF cdnjs URL (jspdf 2.5.2) returns 404 — tax PDF export silently broken on live site (`window.jspdf` undefined) | High (functional) | **Fixed round 2** — both jsPDF scripts moved to cdn.jsdelivr.net (verified 200 + hashed); deploy pending |

## 5. Standing rules

- Data files (`historical_sessions.json`, `tutoring-backup-*.json`) are never
  committed, never pushed, never quoted in commits or docs.
- No real client names, addresses, emails, or phone numbers anywhere in code,
  comments, docs, or commit messages — this repo is public.
- Secrets (PAT, ORS key) live only in `tutoring-settings` on-device; never in
  source, never in the gist payload, never in URLs except ORS geocode (F6).
- New settings keys are local-only by default — syncing one requires adding it
  to `GIST_SETTINGS_ALLOWLIST` in `js/sync.js` deliberately.
- Any new external endpoint must be added to this file AND the CSP before use.
- CDN version bumps require recomputing the SRI hash (fetch the new file,
  sha384, update `integrity` attribute) or the script will refuse to load.

## 6. Re-audit checklist

- `git grep` full history (`git rev-list --all`) for: address fragments, ZIP,
  `ghp_`/`github_pat_`, `AIza`, ORS key prefix, client names.
- Confirm gist payload key list in `sync.js` still matches §2.1 allowlist.
- Confirm `.gitignore` still covers data files, local-config.js, *.bat.
- In live app: verify `tutoring-historical` absent from push payload; check
  `tutoring-settings` for new stray keys; `typeof window.jspdf` !== 'undefined'.
- Verify CSP `connect-src` unchanged in index.html; SRI attributes present on
  all three CDN script tags.
