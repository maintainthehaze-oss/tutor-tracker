# Tutoring Tracker Pro

Client-side PWA for tutoring clients, sessions, expenses, mileage, and taxes. Vanilla HTML/CSS/JS, no framework, no build step. GitHub Pages from `maintainthehaze-oss/tutor-tracker`. Data in localStorage with optional Gist sync.

## File Map

```
index.html              Single-page shell
styles.css              Dark/light theme via CSS custom properties
sw.js                   Service worker, cache-first (bump CACHE_NAME on deploy)
manifest.json           PWA manifest
app.js                  OLD monolith — NOT loaded, reference only
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

Every file is an IIFE. `app-core.js` creates `window.App = {}`. Other modules read from it and expose public functions at the bottom (`App.fnName = fnName;`). Cross-module calls via `App.fnName()` resolve at runtime.

**Load order matters.** `index.html` loads `<script defer>` in dependency order: core → sync → dashboard → clients → sessions → expenses → reports → ui. `ui.js` runs last (contains `init()`).

## Known Issues

- **SW caching hides deploys** — cache-first means stale files until new SW activates. Bump `CACHE_NAME` each deploy.
- **localStorage ~5MB limit** — receipt base64 can exceed it. `saveData()` catches the error but can't prevent data loss.
- **Gist token in localStorage** — known tradeoff for a client-only app.

## Patterns to Preserve

- **`escapeHtml()` on all user data** before DOM insertion. No raw `innerHTML`.
- **`data-action` delegation** — no `onclick`. All clicks through `setupEventDelegation()` in ui.js.
- **Company split lives on the CLIENT** — `getEffectiveSplit(client, sessionDate)` reads `splitHistory` array. Sessions snapshot at creation.
- **`saveAndRender()`** after every data mutation.
- **Split history auto-close** — `saveClient()` auto-sets `stopDate` on the previous entry when split changes.

## Preferences

- Dark mode is default and primary test target
- No build tools, no framework migration — edit, refresh, push
- Base font size ≥15px
- NET revenue primary (green glow), company split always visible
- Heatmap and calendar features were deliberately removed — don't re-add

## Deploy Checklist

1. Bump `CACHE_NAME` in sw.js
2. `node --check js/*.js`
3. Push to main (GitHub Pages auto-deploys)
4. On live site: unregister SW, hard refresh, check all tabs + console

## Data Keys

`tutoring-clients`, `tutoring-sessions`, `tutoring-expenses`, `tutoring-settings` (includes Gist token), `tutoring-receipts` (base64), `tutoring-theme`
