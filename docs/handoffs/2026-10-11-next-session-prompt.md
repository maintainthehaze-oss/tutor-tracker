# Next-session prompt (written 2026-10-11 after Slice E shipped and was verified live)

Paste into a fresh session in `production-release/`:

---

Read `HANDOFF.md` (top entry) and `docs/handoffs/2026-10-11-slice-e-recurring-slots.md`. `origin/main` = `3f3376c`; weekly recurring slots (roadmap Slice E) are live and verified via curl. One handoff commit (`01e4332`) is local and unpushed; it rides out with the next "Ship it".

First, ask MTH for two one-line reports (do not block on them; build while waiting):
1. Did adding one real weekly slot create 4 "weekly"-tagged Scheduled rows after a hard refresh? If not, read the kill switch and the modal-fade note in the Slice E handoff before touching anything.
2. "No row" vetoes the new `SECURITY-PRIVACY.md:21` row (client records may hold a weekly schedule). Default: keep it.

Then do the queued small fix: at a 640 px viewport with data loaded and the backup pill showing, the page scrolls sideways (`.header-right` reaches x=865; `#header-center`/`.live-stats`/`#header-backup-pill` reach 655; measured on the fabricated preview). Pre-existing, not from Slice E. Make `.app-header`/`.header-right` wrap or truncate under 768 px in `protected/styles.css` only, add a static CSS pin to the "static: narrow layout pins" test in `tests/this-week.test.cjs`, and verify at 640 px in the built-in browser (`preview_start` name `protected-static`, http://localhost:8877, fetch changed files with `cache:'reload'` before reloading). One commit, mutation-verify the pin, then "Ship it".

Open roadmap after that (`~/.claude/plans/stateless-bouncing-codd.md` §3-4), none needs an MTH ruling: F hybrid `inPersonMinutes` (S), 4.4 split `sessions.js`/`ui.js` (M, zero test edits first), 4.7 realistic-shape fixture generator (S). Rule the order yourself; 4.7 before 4.4 is the safer sequence.

Rules unchanged: `node --test` must stay 244+ / 0 fail; `node --test tests/slice1/static-guard.test.cjs` PASS; `node --check protected/js/*.js` clean; mutation-verify every new pin; update `HANDOFF.md` (one line) and a dated handoff; never push — "Ship it" is the only push authorization and MTH pushes from his own terminal (the fleet gate blocks the session; give him `cd "C:\Users\dev31\Tutoring Tracker Pro_files\production-release"; git push origin main`), then verify live via curl.

Parked: 2027 IRS mileage rate (~late Dec 2026); receipt-image storage split (only if saves feel slow); Schedule C lines for advertising/travel/equipment (needs an MTH ruling).

---
