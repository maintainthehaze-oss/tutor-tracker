# Protected tracker (the live app)

This folder is the deployed application at https://maintainthehaze-oss.github.io/tutor-tracker/protected/ (the root page redirects here). Activated on the owner's device in September 2026: every record that existed before activation is archived and immutable; new records live in the protected IndexedDB store; changes to locked rows are append-only events.

- Cloud sync is off. The only outbound request is OpenRouteService for mileage, on the owner's click.
- Backups: Settings > Backup downloads a private recovery file (full snapshot; may contain the ORS key). Keep it on the device; never commit it.
- No service worker: `sw.js` here is a kill switch that unregisters any old worker and clears this app's caches.
- Local preview: serve this folder (`python -m http.server 8877 --bind 127.0.0.1`) and click "Initialize fabricated preview". It uses `fixtures/synthetic.json` and never reads real records.

Validation as of 2026-09-29: `node --test` from the repo root, 156 tests pass. Data-flow inventory and controls: `../SECURITY-PRIVACY.md`. Work log: `../HANDOFF.md`.
