# 2026-10-11 — Roadmap 4.7: realistic-shape fixture generator (Claude Code, Fable 5.1)

## What
`tests/helpers/realistic-fixture.cjs` — a seeded, deterministic generator that reproduces the real store's
SHAPE (plan §1 measurements, 2026-10-11) from fabricated names, so scale-sensitive work (save latency,
table rendering, §4.4 split) can be tested at realistic size. Nothing real is in it; the repo is public.

Exports: `SHAPE`, `generate({seed, today, receiptBytes})` → raw fixture for `activateSynthetic`;
`seedEvents(repo, data)` → 107 events through the repository's own commands; `buildRealistic(options)` →
activated App + seeded events (same return shape as `money-fixture.build`, plus `data` and `seeded`).

Shape produced (all pinned in `tests/realistic-fixture.test.cjs`):
- 12 clients, 3 families (A = c2/c7/c8 trio, B = c5/c6, C = c9/c12), 1 inactive, 1 paused.
- 144 sessions 2026-01-02 → today+14: 14 trio rows (2 h/$300), 12 duo rows (1.5 h/$150), c10 38 rows at
  1–2 day gaps (1 h/$250), weekly Tue/Thu/Mon/Wed/Fri slots, a hybrid note ("120 min in person, 30 min
  remote"), an uneven-sibling note, a "no charge" row, the 0-duration cancelled row, 10 scheduled rows
  entered ahead, 78 rows `updatedAt` on 2026-06-04 (batch entry), the rest lagging 100+ days.
- 1,652 historical rows (2023–2025, string amounts like the archive).
- 107 events: 10 payments on 2026-09-17 (the lump), the rest in batches, about half without a method;
  8 status events on the scheduled rows; the remainder one `session.correctMany` batch.
- Envelope ≈ 720 KB with receipts off. `receiptBytes` pads fabricated base64 receipts (real ≈ 3.7 MB).

## Verification
- `node --test` 247/247 (was 244), 0 fail. Static guard 18/18. `node --check protected/js/*.js` clean.
- The 3 new tests run in ~1 s total (seeding uses batched commands; the first draft at one command per
  event took 10.7 s, which is itself a data point for §4.2: ~200 ms per write at this scale).
- Mutations, each red then restored byte-identical: trio 14→13 (+1 elsewhere, so only the pin catches
  it) → "the family trio signature…" fails; lump day 09-17→09-18 → "the lump payment day" fails;
  seed ignored → "another seed, different data" fails.
- NOT done: wiring the generator into "Initialize fabricated preview" (it fetches the fixed 3 KB
  `protected/fixtures/synthetic.json`); the real archive row's full field list was not available to
  compare (historical.js reads only date and status). No app file changed.

## Next
"Ship it" (tests only; nothing live changes). Then Slice F `inPersonMinutes`, then 4.4 split — the split can
now use `buildRealistic()` for a before/after timing check.
