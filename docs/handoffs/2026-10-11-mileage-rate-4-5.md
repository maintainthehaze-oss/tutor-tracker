# 2026-10-11 — Roadmap 4.5 close-out: 2026 IRS mileage rate split (Claude Code, Fable 5.1)

## What was left of 4.5
The earlier Opus session (`2026-10-11-refactors-4-1-4-3-4-5.md`) had already removed the unused rate table and the
gist / `lastBackup` defaults from the protected app; Google Maps keys never existed. It left `sync.js` (hidden in
production, backs slice4 tests, touches `repository.js`) and the 2027 rate (unpublished). Rulings today:
- `sync.js` stays. Removal is a feature/safety-surface change for its own slice if MTH ever wants it. Veto: "drop sync".
- No 2027 entry: the IRS has not published it (irs.gov, checked 2026-10-11; December is usual). 2027 keeps using the Settings rate.
- NEW finding, fixed: the IRS split 2026 mid-year (IR-2026-29): 72.5c through 2026-06-30, 76c from 2026-07-01.
  The live table applied 72.5c to all of 2026, under-deducting every second-half leg.

## Change (commits `d320dc9`, `d7e26ef`)
- `protected/js/report-model.js` `rate()`: 2026 keys on the session date (`>= '2026-07-01'` → 0.76); a 2026 row with no
  usable date takes the first-half rate; 2024/2025 unchanged; captured-v1 gets the same 2026 rule (ruling: no 2026
  report has been filed, so there is nothing to preserve; veto if a captured 2026 figure must stay at 72.5c).
- `protected/js/reports.js` `getTaxData`: rates sorted ascending; for 2026 only, a two-rate year is labelled
  "$0.725/mi then $0.760/mi (2026, IRS mid-year change)" on screen and in the PDF; every other mixed/unknown case
  keeps "Per-session captured rates; see data notice".
- `tests/mileage-rate-2026.test.cjs`: rate pins (June 30 / July 1 / Dec 31 / partial / no date / 2025 / 2024 / 2027),
  deduction delta 7.60 for a July leg and 7.25 for a June leg, exact label. Mutations red then restored: July rule
  removed, label fallback forced, sort reversed.
- fleet-reviewer: GO with fixes (label order and the 2026-only guard, both applied).

## Verification
`node --test` 259/259; static guard 18/18; `node --check` clean. OBSERVED on the fabricated preview (localhost,
dark): Tax Summary 2026 shows the two-rate label; adding a 2026-07-15 completed row with 10 mi moved the deduction
from $7.25 to $14.85 (= 10 × 0.725 + 10 × 0.76). NOT observed: PDF export, light, real data.

## Next
"Ship it" → MTH pushes from his terminal; hard-refresh; open Tax Summary 2026 and check the rate line.
