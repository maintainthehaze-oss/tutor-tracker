# 2026-10-15 tab-strip clip + recurring dead code (Claude Code, Sonnet 5.5)

Two local commits, NOT pushed.

1. `protected/styles.css` (481-768 px block): `.tab-nav { flex-wrap: wrap; padding: .5rem 1rem }`. Tax Summary drops to a 2nd row instead of clipping. Pin added in `tests/sessions-layout-pins.test.cjs`. Mutation (flex-wrap: nowrap) -> 1 red, restored -> green.
2. `protected/js/recurring.js`: removed `lastReport`, `App.recurringLastReport`, and the report return value of `runRecurringPass` (now returns null). Nothing read them after "This week" left (grep: protected/js, index.html, tests). KEPT: the pure engine's `skipped`/`gaps` outputs (pinned by `tests/recurring-engine.test.cjs`, no test edit needed), the pass, `App.features.recurringPass`, `recurringLastDay`, single-writer rule. Mutation (kill-switch check removed) -> red, restored -> green.

`node --test` 245/245, `node --check` clean. OBSERVED at 640 px on the fabricated preview: six tabs, Tax Summary on row 2 (x 15-142), page scrollWidth 640. NOT observed: 481/768 px edges, light theme, real data.
