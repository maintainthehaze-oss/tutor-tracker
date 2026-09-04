# Tutoring Tracker Pro

A client-side PWA for independent tutors to track clients, sessions, expenses, mileage, and taxes. No server, no framework, no build step — just vanilla HTML/CSS/JS served from GitHub Pages.

**Live:** https://maintainthehaze-oss.github.io/tutor-tracker/

## Tech Stack

- Vanilla HTML / CSS / JavaScript (no framework, no build tools)
- localStorage for persistence
- Optional GitHub Gist sync for cloud backup
- Chart.js 4.4.7 for dashboard charts
- jsPDF 2.5.2 for tax PDF export
- OpenRouteService API for mileage calculation
- Inter font (Google Fonts)
- Service worker for offline support (cache-first)

## File Structure

```
index.html          — Single-page app shell, all HTML
styles.css          — Dark/light theme via CSS custom properties
manifest.json       — PWA manifest with shortcuts
sw.js               — Service worker
local-config.js     — Private local-only config (gitignored; home address etc.)

js/
  app-core.js       — Namespace (window.App), utils, data, theme, tabs (~476 lines)
  sync.js           — GitHub Gist push/pull/auto-sync (~206 lines)
  dashboard.js      — Dashboard cards, charts, top clients, heatmap (~570 lines)
  clients.js        — Client CRUD, cards, family groups, split history (~349 lines)
  sessions.js       — Session CRUD, filters, sorting, mileage calc (~637 lines)
  expenses.js       — Expense CRUD, receipt upload/compression (~235 lines)
  reports.js        — Monthly reports, per-client stats, tax summary, PDF export (~336 lines)
  ui.js             — Import/export, settings, search, toasts, modals, drag-drop, event delegation, init (~1001 lines)
```

## Architecture

All modules use a shared `window.App` namespace. `app-core.js` creates the namespace and exposes shared state, utilities, and constants. Each subsequent file attaches its public functions to `App` (e.g., `App.renderDashboard`, `App.saveClient`). Cross-module calls go through `App.functionName()` and resolve at runtime after all scripts load.

State lives in `App.state` with getter/setter pairs so modules can read and write shared arrays (clients, sessions, expenses, settings, receipts) without import/export syntax.

Script load order matters — `index.html` loads them via `<script defer>` tags in dependency order: core first, then sync, then feature modules, then ui.js (which contains init and event delegation).

## Tabs

1. **Dashboard** — Revenue cards, income trend chart, sessions/week chart, top clients, busiest days heatmap
2. **Clients** — Card grid with avatars, family grouping, split history with start/stop dates
3. **Sessions** — Sortable/filterable table, inline edit mode, bulk actions, today's schedule
4. **Expenses** — Category-based tracking, drag-and-drop receipt upload with image compression
5. **Reports** — Monthly breakdown with income, company split, expenses, net profit, mileage deductions, per-client stats
6. **Tax Summary** — Annual tax data aggregation with PDF export via jsPDF

## Key Concepts

### Company Split
Stored on the **client** object, not individual sessions. Each client has a `splitHistory` array with `{split, effectiveDate, stopDate, company}` entries. `getEffectiveSplit(client, sessionDate)` finds the applicable split for any given date by checking which entry's date range covers the session date. When a client's split changes, the previous entry's `stopDate` is auto-set. Split can propagate to family members.

### Data Migration
`migrateData()` in `app-core.js` handles old data formats on load:
- `hourlyRate` to `rate` on clients
- `paymentStatus` / `payment` to `paid` (boolean) on sessions
- `splitHistory[].rate` / `.date` to `.split` / `.effectiveDate`
- Single `clientId` to `clientIds` array on sessions
- Recalculates `companyAmount` from client split history if missing

### ID Type Gotcha
Client IDs are numbers (timestamps like `1768767021189`). When aggregating via `Object.entries()`, keys become strings. All `clients.find()` calls from aggregation use `String(c.id) === String(id)` to avoid strict equality mismatch.

### Service Worker
Cache-first strategy with network fallback. Cache name must be bumped (`tutor-tracker-vN`) on every deploy so returning users get fresh files. The `ASSETS` array lists all 8 JS modules. API domains (GitHub, OpenRouteService, Google Fonts gstatic) are excluded from caching.

## Theming

Dark mode is the primary theme. CSS custom properties on `html[data-theme]`:
- Dark: `#0d1117` bg, `#161b22` cards, `#58a6ff` accent, `#f0f6fc` text
- Light: `#ffffff` bg, `#f6f8fa` cards, `#0969da` accent, `#1f2328` text

Toggle via the sun/moon icon in the header. Persisted in localStorage.

## Development

No build step. Edit files directly and refresh.

```bash
# Serve locally (any static server works)
npx serve .

# Deploy
git add -A
git commit -m "description"
git push origin main
# GitHub Pages auto-deploys from main branch
```

After deploying, users should hard-refresh (Ctrl+Shift+R) or clear the service worker cache to pick up new files. Bump `CACHE_NAME` in `sw.js` on each deploy.

## Data Storage

All data is in localStorage under these keys:
- `tutoring-clients` — client array
- `tutoring-sessions` — session array
- `tutoring-expenses` — expense array
- `tutoring-settings` — settings object
- IndexedDB `tutor-tracker` / `receipts` — receipt images (base64), moved out of localStorage to escape its ~5 MB cap
- `tutoring-theme` — `"dark"` or `"light"`

Optional: configure a GitHub Personal Access Token and Gist ID in Settings for cloud backup/sync.
