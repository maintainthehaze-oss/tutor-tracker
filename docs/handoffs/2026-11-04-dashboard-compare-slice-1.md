# 2026-11-04 — Dashboard slice 1: day-matched comparison cards, Hours by family, dashed last-year line

Claude Code, Fable 5.1. SHIPPED on MTH's "Ship it": `main` `0c893bc → a3a8147`, pushed by MTH from his own terminal 2026-11-04. Live `protected/index.html`, `styles.css`, `js/dashboard.js`, `js/ui.js` identical to local (CRLF-normalised) via curl on the first poll, ~30 s after the push. Not yet observed on real data in the browser.

## What MTH asked for (2026-11-04)

"This month versus last month" means **October 2026 versus October 2025**: the same month a year earlier. He also
wants time per **family**, not per student, because sibling sessions split per student are unreadable.

## What changed

**The flaw this fixes.** The old trend badges compared this month so far against *all* of last month, so on the 4th
of a month Net Revenue always read as a collapse. Every comparison on the dashboard is now **day-matched**: the
1st–Nth of this month against the 1st–Nth of the comparison month (the day clamps to a shorter month, so Mar 31 vs
Feb compares against the whole of February).

**Compare control** (`data-action="dashboard-compare"`, above the cards): "vs same month last year" (default) or
"vs last month". One control drives the cards and the family bars. In memory only, no storage key, nothing to add
to `SECURITY-PRIVACY.md`. The label beside it states the two windows, e.g. "Nov 1–4 vs Nov 1–4, 2025".

**Four cards, all month to date** (`protected/index.html`):
1. **Net so far** — net, gross line, trend "▼ 14% · $630.00 in Nov 1–4, 2025".
2. **On pace for** — realized so far + every still-scheduled row dated this month (waived $0), against the
   comparison month's *final* figure ("Nov 2025 finished at $1,770.00"). Sub line: "10 sessions still scheduled this month".
3. **Hours so far** — hours, sub "4 sessions · 14h still scheduled", trend vs the comparison window.
4. **Earned per hour** — net ÷ hours actually worked, not the list rate.
Removed: *Sessions This Month*, *Active Clients*, *Avg Rate* cards (count lives in the hours card; the other two barely
move month to month and the list rate is on each client).

**Hours by family** replaces *Top Clients* (`renderFamilyHours`): two bars per family (this window, comparison
window), hours lead, money and session count in the row title, dash when the family had nothing in the comparison
window, busiest first, top 8. Siblings roll up through the existing family group keys (a 1.5 h session shared by two
siblings is 1.5 h for the family, not 0.75 h each).

**Income Trend** gets a dashed "Net, a year earlier" line: each month's twin twelve months back, so Oct 2026 sits over
Oct 2025. Hidden on *All Time* and when every last-year value is zero.

## Files

`protected/index.html` (compare row, four cards, Hours by family card), `protected/js/dashboard.js` (`comparison`,
`familyRows`, `renderFamilyHours`, `scheduledSessions`, `setTrend` suffix, dashed dataset; `renderTopClients` deleted),
`protected/js/ui.js` (+1 change-handler line), `protected/styles.css` (`.dashboard-compare`, `.card-note`,
`.family-hours-*`; `.top-clients-list`, `.card-sessions`, `.card-clients` removed), NEW `tests/dashboard-compare.test.cjs` (5 tests).

Read-guard: the single exempt operational read (`App.state.sessions.filter((s) => s.status === 'scheduled')`) now
lives once in `scheduledSessions()` and feeds both the header Projected pill and the on-pace card; the guard's
exact-once pin still holds. Realized money is `App.reportModel.metrics` with `month` + `dateEnd` filters only.

## Evidence

- `node --test` **248/248** (was 243; +5). `node --check` clean on `dashboard.js`, `ui.js`.
- Mutations, each RED then restored byte-identical (sha256 checked): (M1) comparison window = whole previous month;
  (M2) family bars read the whole comparison month; (M3) on-pace forgets scheduled rows.
- OBSERVED on a fabricated preview (realistic generator + 52 added rows in Oct/Nov 2025, Oct 2026, Nov 1–4 2026;
  temporary file, deleted), dark and light, ~800 px: all four cards with real year-over-year figures, toggle to
  "vs last month" re-labels and re-renders cards and bars, family bars with dash rows, dashed last-year line on
  12 months, Outstanding and Year-over-Year untouched, **zero console errors**.
- NOT observed: real data, *All Time* range (dashed line hidden by design), widths under ~800 px, the 6-month range.

## Rulings (veto-able)

- Compare mode is not persisted; the page opens on "same month last year" every load.
- No "new" tag on families: a family with nothing in the comparison window gets a dash and a title that says so.
  "New" was wrong for a family that simply had no session in that 4-day window a year ago.
- The "Gross:" line on the net card is now month-to-date gross (was whole-month). Same window as everything else.
- Trend arrows now use text (▲/▼) instead of HTML entities; same glyphs on screen.

## ⚠️ For slice 2 (calendar)

`CLAUDE-INSTRUCTIONS.md` says the calendar was "removed on purpose; do not re-add". MTH asked for a monthly calendar
with quick add on 2026-11-04. That instruction line must be changed by MTH's ruling before slice 2 is built.

## Next

"Ship it", then hard-refresh and open Dashboard on real data: check the two labels read sensibly for today's date and
that October 2025 rows exist for the comparison to be non-zero.
