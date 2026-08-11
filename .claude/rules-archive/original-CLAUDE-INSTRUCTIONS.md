# CLAUDE-INSTRUCTIONS.md — Tutoring Tracker Pro

Read this before writing any code.

## What This Is

Client-side PWA for tracking tutoring clients, sessions, expenses, mileage, and taxes. Vanilla HTML/CSS/JS, no framework, no build step. Hosted on GitHub Pages from `maintainthehaze-oss/tutor-tracker`. Data lives in localStorage with optional GitHub Gist sync.

## File Map

```
index.html              Single-page shell, all markup
styles.css              Dark/light theme via CSS custom properties
sw.js                   Service worker, cache-first (bump CACHE_NAME on deploy)
manifest.json           PWA manifest
app.js                  OLD monolith — reference only, NOT loaded

js/app-core.js          Namespace (window.App), utils, state, data, theme, tabs
js/sync.js              GitHub Gist push/pull/auto-sync
js/dashboard.js         Dashboard charts, top clients, NET revenue card
js/clients.js           Client CRUD, cards, family groups, split history
js/sessions.js          Session CRUD, filters, sorting, mileage
js/expenses.js          Expense CRUD, receipt drag-drop
js/reports.js           Monthly reports, per-client stats, tax summary, PDF export
js/ui.js                Import/export, settings, search, toasts, modals, events, init
```

## Module Pattern

Every file is an IIFE. `app-core.js` creates `window.App = {}` and exposes state via `App.state` (getter/setter pairs). Other modules pull what they need at the top:

```js
const App = window.App;
const $ = App.$;
const clients = App.state.clients;
```

Public functions are exposed at the bottom: `App.renderDashboard = renderDashboard;`

Cross-module calls use `App.functionName()`. These resolve at runtime — the function doesn't need to exist when the calling file loads, only when the function is actually invoked.

**Script load order matters.** `index.html` loads them via `<script defer>` in dependency order: core → sync → dashboard → clients → sessions → expenses → reports → ui. `ui.js` contains `init()` and event delegation, so it runs last.

## Known Bugs — Fix These

### 1. Client ID type mismatch — FIXED

Client IDs are **numbers** (timestamps like `1768767021189`). DOM attributes, `<select>` values, and `Object.entries()` keys are always **strings**. All comparison sites now use `String(cl.id) === String(id)` or `.some((cid) => String(cid) === String(val))` to handle mixed types safely. Session form selects coerce to `Number()` at extraction. This bug is fully resolved across all modules.

### 2. Service worker caching hides deploys

Cache-first strategy means returning users see stale files until the new service worker activates. This requires the user to close all tabs and reopen — a hard refresh alone isn't always enough. Bumping `CACHE_NAME` in `sw.js` triggers cache invalidation on the next visit but there's still a race.

### 3. localStorage has no size guard

Receipt images are stored as base64 in localStorage. A few large receipts can blow the ~5MB limit. `saveData()` catches the error and shows a toast, but doesn't prevent data loss from the failed write.

### 4. Import validation — IMPROVED

`restoreData()` in `ui.js` now validates imported data: checks top-level types, verifies arrays are arrays, filters out malformed entries (must have `id` field). `migrateData()` still runs after import for legacy format handling.

### 5. Gist token stored in localStorage

The GitHub PAT for Gist sync is stored in `tutoring-settings` in localStorage, visible to any script on the page. This is a known tradeoff for a client-only app, but worth noting.

## Patterns to Preserve

- **`escapeHtml()` everywhere** — all user data rendered to DOM goes through `escapeHtml()`. Don't bypass this with `innerHTML` on raw data.
- **`data-action` event delegation** — no `onclick` attributes. All click handling goes through `setupEventDelegation()` in `ui.js`. New actions get a `data-action="action-name"` attribute and a `case` in the switch.
- **Company split lives on the CLIENT, not the session** — `getEffectiveSplit(client, sessionDate)` calculates the applicable split for any date from the client's `splitHistory` array. Sessions store a snapshot in `s.companySplit` / `s.companyAmount` for display, calculated at creation or migration time.
- **`saveAndRender()`** — the standard pattern after any data mutation. Saves to localStorage, re-renders the active tab, updates header stats, and triggers sync.
- **Split history auto-close** — when a client's split changes, `saveClient()` auto-sets `stopDate` on the previous split history entry. Don't break this chain.

## Preferences

- **Dark mode primary** — dark theme is the default. Light mode exists but dark is what gets tested.
- **No build tools** — no webpack, no vite, no npm scripts. Edit files, refresh browser, push to GitHub.
- **No framework migration** — keep it vanilla JS. Don't introduce React, Vue, or anything that needs compilation.
- **Bigger fonts** — base size is 15px. Previous iterations were too small. Don't shrink things.
- **Company split always visible** — show split amounts in dashboard cards, session rows, report breakdowns, and monthly views. This was missing before and caused confusion.
- **NET revenue is primary** — dashboard card shows NET (revenue minus company split) with green glow styling. Gross and split shown as subtitle. Header stats also show NET.
- **Heatmap removed** — Busiest Days & Times heatmap was deleted from dashboard HTML, JS, and CSS. User found it unnecessary.
- **Client cards are clickable** — entire card opens the edit form. Minimal clicks.
- **Monthly Summary on Sessions tab** — replaced Today's Schedule with a summary of current month stats (sessions, hours, revenue, split, mileage, unpaid count).
- **CSP meta tag** — Content Security Policy restricts scripts/styles/connections to known origins only.
- **Calendar code removed** — dead calendar rendering code (~150 lines) and ~130 lines of calendar CSS have been fully removed.

## Before You Deploy

1. Bump `CACHE_NAME` in `sw.js` (currently `tutor-tracker-v9`, increment on each deploy).
2. Run `node --check js/*.js` to validate syntax on all 8 files.
3. Push to main — GitHub Pages auto-deploys.
4. On the live site: unregister the service worker or clear caches, then hard refresh.
5. Click through Dashboard, Clients, Sessions, Reports. Check console for errors.
6. Verify client names appear in Top Clients and Per-Client Statistics (these broke before from the ID type bug).

## Data Keys

```
tutoring-clients     — client array
tutoring-sessions    — session array
tutoring-expenses    — expense array
tutoring-settings    — settings object (includes Gist token)
tutoring-receipts    — receipt images (base64)
tutoring-theme       — "dark" or "light"
```
