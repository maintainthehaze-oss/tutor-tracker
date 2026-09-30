# Tutoring Tracker Pro — working rules for AI sessions

Client-side tutoring tracker. Vanilla HTML/CSS/JS, no framework, no build step. GitHub Pages from `maintainthehaze-oss/tutor-tracker`. The live app is `protected/`; the root page only redirects there. Read `HANDOFF.md` first, then `README.md` for the file map.

## Where the code lives

- Working copy: `C:\Users\dev31\Tutoring Tracker Pro_files\production-release` (moved out of OneDrive 2026-09-19; the old OneDrive clones no longer exist).
- Live app: `protected/` — `protected/index.html`, `protected/js/*.js`, `protected/styles.css`.
- Root `js/`, `styles.css`, `sw.js`, `manifest.json`: the retired original app. Never edit, never load. Root `sw.js` and `protected/sw.js` are kill switches, not workers.
- Tests: `node --test` from the repo root (fabricated fixtures only; this repo is public).

## Module pattern

Every file is an IIFE. `app-core.js` creates `window.App`; each module exposes its public functions at the bottom (`App.fn = fn`). `protected/index.html` loads `<script defer>` in this order: upgrade-shim, app-core, backup-status, record-policy, repository, report-model, sync, dashboard, historical, clients, sessions, recurring, expenses, ocr, reports, ui. `ui.js` runs last and contains `init()` and the `data-action` click delegation.

## Invariants (tests pin these; do not work around them)

- **Every write is a repository command** (`App.runCommand(name, payload, revision)`). No direct writes to `App.state`.
- **Locked rows never change.** Pre-activation records and finalized sessions are immutable; edits are append-only `correction` / `status` / `payment` events overlaid by `record-policy.js`. Never roll back deployed JS once an event type exists in real data.
- **Realized money comes only from `App.reportModel`.** `reports.js`, `dashboard.js`, `historical.js` must not read `App.state.sessions` for totals (read-guard test). The header "Projected" pill is the one exempt operational read.
- **Secrets stay out of evidence.** Finalize snapshots drop the ORS key and gist/token fields; portable export refuses any credential-shaped field.
- **`escapeHtml()` on every user value** before `innerHTML`, including values used as class names.
- **IDs are not coerced.** Compare with `String()` / `P.key`; a session id may be `1` or `"001"`.
- **Cents.** New unlocked amounts are stored in whole cents; stored/locked amounts are never re-rounded.
- **No new network hosts** without updating the CSP in `protected/index.html` AND `SECURITY-PRIVACY.md`. Cloud sync is off by owner ruling.

## Owner (MTH) rules

- "Ship it" is the ONLY push/deploy authorization. A user-scope pre-push hook blocks `git push origin main` until MTH creates the session's ship-it file from his own terminal (the hook prints the exact command). Spell remotes literally.
- Reserved for MTH: legal/compliance, published privacy text (`SECURITY-PRIVACY.md` promises), security posture, spending, deploys. Everything else: decide, state the ruling, move on.
- Never commit data files (`historical_sessions.json`, `tutoring-backup-*.json`, `*recovery*.json`, `local-config.js`, `*.bat`). Never put real client names, addresses or the home address in code, tests, docs or commit messages.
- Dark theme is primary. No build tools, no framework migration. Heatmap, calendar and the Dashboard "This week" strip were removed on purpose; do not re-add.

## Handoffs

- `docs/handoffs/YYYY-MM-DD-slug.md` for detail; a short pointer at the top of `HANDOFF.md` (<= 30 lines of pointers).
- State test counts exactly, name what was browser-observed vs. only code-traced, and list UNVERIFIED items.
- Fabricated preview: from `protected/` run `python -m http.server 8877 --bind 127.0.0.1`, open it, click "Initialize fabricated preview". Real records are never read there. The browser caches scripts hard; refetch with `cache: 'reload'` before judging an edit.

## Deploy checklist

1. `node --test` green; `node --check protected/js/*.js`.
2. Handoff updated and committed.
3. MTH says "Ship it" and creates the hook file; `git push origin main`.
4. About 60 s later, curl each changed live file and grep for a marker of the change; MTH hard-refreshes once. No cache name to bump (no service worker).
