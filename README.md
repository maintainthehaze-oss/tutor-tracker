# Tutoring Tracker Pro

A client-side app for an independent tutor to track clients, sessions, expenses, mileage and Schedule C tax figures. Vanilla HTML/CSS/JS, no framework, no build step, served from GitHub Pages.

**Live:** https://maintainthehaze-oss.github.io/tutor-tracker/ — the root page redirects to `protected/`, which is the app.

## What is in this repo

```
index.html, protected-redirect.js   Root entry: redirects to protected/ (loads no app code)
js/, styles.css, sw.js, manifest.json   The RETIRED original app. Kept as evidence, not loaded by anything.
                                        Root sw.js is a self-destruct kill switch for browsers that still hold the old worker.
vendor/pdfjs, vendor/tesseract      Retired copies; the live app uses protected/vendor/.
protected/                          THE LIVE APP (see below)
tests/                              Node test suite: `node --test` from the repo root (156 tests). Fabricated fixtures only.
docs/handoffs/                      Dated work logs; HANDOFF.md at the root is the short pointer to the latest.
SECURITY-PRIVACY.md                 Where data lives and what can leave the device. Single source of truth.
CLAUDE-INSTRUCTIONS.md              Working rules for AI-assisted sessions.
```

### protected/ (live app)

```
index.html          Single-page shell; same-origin Content Security Policy (scripts self only; connect-src self + api.openrouteservice.org)
styles.css          Dark (default) / light theme via CSS custom properties on html[data-theme]; system font stack
sw.js               Kill switch only. No service worker is registered; nothing is cached. No cache bump on deploy.
icon.svg            Favicon
README.md           Release note for the protected entry
fixtures/synthetic.json, baseline/   Fabricated data and captured report definitions for the local preview
vendor/reporting    Chart.js 4.4.7, jsPDF 4.2.1, jsPDF-AutoTable 5.0.8 (exact npm distributions; see its README)
vendor/tesseract, vendor/pdfjs       On-device receipt OCR and PDF-to-image (lazy-loaded, same-origin)

js/  (loaded with <script defer> in this order)
  upgrade-shim.js     Unregisters any leftover service worker; keeps old TrackerUpgrade calls resolving
  app-core.js         window.App namespace, utils, formatting, settings defaults, migration of legacy record shapes
  backup-status.js    Backup reminder pill/banner (pure state function + two localStorage bookkeeping keys)
  record-policy.js    Which record fields are locked, and how append-only events overlay a locked row
  repository.js       The protected store: IndexedDB, immutable archive of pre-activation records, finalize snapshots,
                      append-only events (status / payment / correction), commands, private recovery + portable backup
  report-model.js     The ONE place realized money is computed from (reports, tax, dashboard all read it)
  sync.js             Local sync rehearsal only. There is no GitHub transport in the protected app.
  dashboard.js        Summary cards, income trend chart, outstanding/owed, top clients
  historical.js       Year-over-year chart from captured historical totals
  clients.js          Client cards, family groups, split history; inactive clients collapsed
  sessions.js         Session table, form, locked-row corrections, mileage (OpenRouteService), day-order mileage
  recurring.js        Pure weekly-slot planner. Inert: nothing calls it yet.
  expenses.js         Expenses, receipt intake (downscale to <=1200px JPEG), PDF receipts via pdf.js
  ocr.js              On-device Tesseract OCR that prefills EMPTY expense fields
  reports.js          Monthly report, Schedule C tax summary, NY-source rollup, PDF/CSV export
  ui.js               Settings, backup/restore, modals, toasts, search, event delegation, init
```

## Architecture in one paragraph

Every module is an IIFE that attaches its public functions to `window.App`. `repository.js` owns the data: records live in IndexedDB (`tutor-tracker-protected-production` on the live site, `tutor-tracker-slice1-preview` locally), every write goes through a named command with a revision check, and anything recorded before activation (or finalized since) is immutable. Changes to a locked row are append-only events that `record-policy.js` overlays on read. `report-model.js` is the only reader allowed to compute realized money; a static test fails if reports, dashboard or historical read session rows directly. Cloud sync is off; the only network call the app makes is OpenRouteService for mileage, and only when the owner asks.

## Tabs

1. **Dashboard** — net/gross revenue cards with month-over-month trend, sessions this month, active clients, average rate, income trend chart, outstanding by family, top clients.
2. **Clients** — cards with rate, split history, family grouping; inactive clients in a collapsed section.
3. **Sessions** — month navigator, filters, sortable table, tap-to-pick clients, duration chips, Mark paid, locked rows edited only through corrections ("View original" shows the evidence), mileage pin button.
4. **Expenses** — categories, drag-and-drop receipts with on-device OCR, PDF receipts.
5. **Reports** — monthly income, stored historical shares, expenses, mileage deduction, net, per-client/family groups.
6. **Tax Summary** — Schedule C lines (cash basis), NY-source rollup, mileage detail, estimated tax payments, PDF/CSV export. The amber "Incomplete inputs" note lists records with a missing field; totals are labelled as known subtotals.

## Key concepts

- **Locked records.** Pre-activation records and completed/cancelled/no-show sessions cannot be edited or deleted. The pencil saves a *correction* event; the trash can offers a cancel correction. Payment and status events are append-only too. Do not roll back deployed JS once any event exists.
- **Money.** New amounts are stored in whole cents. Cash basis: income counts in the year payment was received. Waived sessions are not revenue. Company split is stored on the client (`splitHistory`), sessions snapshot it; new sessions have a zero share, historical shares are reproduced from stored values.
- **IDs.** Client and session ids may be numbers or strings; every comparison goes through `String()` / `P.key`. Never coerce.
- **Backups.** Settings > Backup downloads `tutor-tracker-recovery-YYYY-MM-DD-rNNN.json` (full private snapshot; keep it on the device, it may contain the ORS key). The header pill turns amber after 7 days or 10 saved changes without a backup.

## Development

```bash
# from protected/
python -m http.server 8877 --bind 127.0.0.1
# open http://127.0.0.1:8877/ and click "Initialize fabricated preview" (synthetic data only; real records are never read)

# tests, from the repo root
node --test
```

The browser caches the scripts hard between edits; reload with the cache bypassed (or `fetch(url, {cache: 'reload'})` each script) before judging a change.

## Deploy

`git push origin main`; GitHub Pages serves within about a minute. A pre-push hook blocks pushes to main until the owner authorizes ("Ship it"). After a deploy the owner hard-refreshes once (Ctrl+Shift+R). No service worker, so no cache name to bump.
