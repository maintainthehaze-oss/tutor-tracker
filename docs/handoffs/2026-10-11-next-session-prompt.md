# Next-session prompt (written 2026-10-11 after the Sessions simplification was verified live)

Paste into a fresh session in `production-release/`:

---

Read `HANDOFF.md` (top entry) and `docs/handoffs/2026-10-11-sessions-tab-simplified.md` §Live verification. `main` = `origin/main` = `efc692c`; everything through the Sessions simplification is live and verified on real data. Nothing is unpushed.

Two small follow-ups were noticed but not done; do them in one commit, tests first:

1. Sessions table sort: within one date, rows list 16:15 before 18:30 while the Date sort is descending. Make the secondary sort follow the primary direction (newest time first when Date is descending). Find the comparator in `protected/js/sessions.js`; add a pin in `tests/this-week.test.cjs` or the nearest sessions test; mutation-verify it.
2. 640 px on real data was never observed (Chrome refused to resize a maximised window; a popup was blocked). Instead of fighting Chrome, pin the layout statically: assert in a test that `protected/styles.css` keeps the toolbar `flex-wrap` rule and the table wrap `overflow-x: auto` under the narrow media query. Read-only check of the live site in the built-in browser pane at 640 px is acceptable evidence.

Rules unchanged: `node --test` must stay 218+ / 0 fail, static guard PASS, `node --check protected/js/*.js` clean. Update `HANDOFF.md` (one line) and append to the dated handoff. Do not push; "Ship it" is the only push authorization, and MTH pushes from his own terminal.

Parked, not for this session: 2027 IRS mileage rate (add once published, ~late December 2026); receipt-image storage split (only if saves still feel slow); Schedule C lines for advertising/travel/equipment (needs an MTH ruling).

---
