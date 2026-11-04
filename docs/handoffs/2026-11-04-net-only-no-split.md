# 2026-11-04 — Net-only comparisons, split UI removed

Tool: Claude Code, Fable 5.1 (same session as slice 2). MTH's words: "make sure all the comparisons are compared to the NET revenue values and remove the SPLIT." State: **SHIPPED** — MTH said "Ship it" and pushed `814e6d2` from his own terminal; all nine changed live files curled identical to local (CRLF-normalised) on the second poll (~40 s); live `dashboard.js` / `historical.js` carry the "Net only (ruled 2026-11-04)" marker and no file carries `Gross Income`, `Gross Revenue`, `Historical share`, `toggle-split`, `split-info`, `showSplit` or `split-collapsed`.

## What changed (one sentence)

Every Dashboard comparison is now net vs net, charts included (the Income Trend draws Net Revenue against Net a year earlier only; the Year-over-Year bars are net only), and no screen shows a company-split figure any more.

## Rulings (veto-able, all delegated)

| # | Ruling | Why |
|---|---|---|
| R1 | Scope of "remove the SPLIT" = every **on-screen** split figure: the Show split toggle (Sessions More menu and Reports), the Sessions Split column, the Reports Historical Share card and the Historical Share columns of the monthly and family tables, the Dashboard "Gross · Historical share" sub-line, the Gross Income + Historical share chart lines, the Gross Revenue + Historical share YoY bars. | Unqualified request after looking at the Dashboard; the toggle was the only way to reveal any of it, so leaving hidden markup behind would be dead code. |
| R2 | The **data model is untouched**: `companySplit` / `companyAmount` stay on locked records, `App.reportModel` still computes net = gross − split and `hasLegacyShare`. | Locked rows never change; net is only correct if the split is still subtracted. |
| R3 | **CSV exports keep their columns** (sessions "Historical Share", report "Historical Share, Your Cut", clients "Company Split"). | Exports are data evidence, not comparisons; removing columns could break anything MTH feeds them to. |
| R4 | **Locked-record evidence stays visible**: the View original dialog still lists "Company share percent / amount" (now never hidden); the Clients form's "Historical company details" section is unchanged. | Audit evidence of immutable records; it was only ever hidden by the toggle. |
| R5 | Reports labels: "Your Cut (after split)" → **Net Revenue**; "Net Profit (after split, expenses, mileage)" → **Net Profit (after expenses, mileage)**; family table "Your Cut" → **Net**. "Total Income" (gross) and the family "Gross" column stay. | Gross is a distinct figure the tax tab also uses; only the split wording goes. |
| R6 | The Dashboard Net card has no sub-line any more (was "Gross: $x \| Historical share: $y"); the report-model warning notice now anchors on the trend line. | Nothing gross on the Dashboard. |
| R7 | `tutoring-show-split` localStorage key: the app **no longer reads or writes** it; existing values are left in place (never deleted). `SECURITY-PRIVACY.md` now lists the key as retired (no longer read or written, leftover copy inert), edited on MTH's "finish everything here" after the ship. | Privacy text is MTH-only; he authorised this edit. |
| R8 | Income Trend: Net Revenue becomes the filled line (it was the unfilled third line under Gross). Dashed "Net, a year earlier" unchanged. | One series needs the fill to read as the series. |

## Files

- `protected/js/dashboard.js`: card sub-line removed; income chart builds only `netData` (+ `prevYearData`, `countData`); dataset filter keeps only the last-year rule.
- `protected/js/historical.js`: YoY = one `Net Revenue` dataset; gross/share arrays, colours and the `App.showSplit()` filter gone.
- `protected/js/app-core.js`: `SPLIT_PREF_KEY`, `showSplit`, `applySplitPref`, `toggleSplit` and their exports removed (comment left in place).
- `protected/js/ui.js`: `toggle-split` case removed; CSV comment updated.
- `protected/js/session-table.js`: `splitDisplay` / `splitAmount` and both `<td class="split-info">` cells gone; empty row `colspan="8"`.
- `protected/js/reports.js`: Historical Share `<td>`s, the two `set(...-split)` lines and the share-card hide logic gone; colspans 8 / 6.
- `protected/js/sessions.js`: evidence `<dt>/<dd>` no longer carry `split-info`.
- `protected/index.html`: both toggle buttons, Split `<th>` + tfoot `<td>`, `dash-gross-split`, Historical Share card, both Historical Share `<th>` + foot `<td>`s removed; labels per R5; `client-legacy-details` loses the class.
- `protected/styles.css`: `.split-collapsed .split-info` rule removed.
- NEW `tests/net-only-compare.test.cjs` (4 tests).

## Tests

- `node --test`: **257 / 257** (was 253; +4). `node --check protected/js/*.js`: clean.
- Mutation-verified (each red, file restored, SHA-256 byte-identical):
  - M1 income chart fed `metrics.gross` instead of `yourCut`: 3 pass / 1 fail (Feb 341.875 net vs 361.875 gross).
  - M2 a Gross Income dataset back on the trend: 2 / 2.
  - M3 a Gross Revenue dataset back on the YoY bars: 3 / 1.
  - M4 a Show split toggle back in Reports: 3 / 1.
  - M5 a split cell back in a Sessions row: 3 / 1.
- Pre-existing pins untouched: money-pins (gross/split/yourCut arithmetic), read-guard, static-guard (`tutoring-show-split` remains on its allow-list; harmless).

## Observed in the built-in browser (fabricated preview, dark, ~800 px, after a cache-bypass refetch of all 27 page files)

- Dashboard: Income Trend (All Time) legend = **Net Revenue** only (no last-year line because nothing fabricated a year earlier); Year-over-Year legend = **Net Revenue** only; no "Gross:" sub-line under Net so far; `body` no longer carries `split-collapsed`; `App.toggleSplit` / `App.showSplit` undefined.
- Sessions (Feb 2026): headers Date · Time · Client(s) · Duration · Amount · Mileage · Payment · Status · Actions (8 visible + hidden check), rows have 8 cells, totals row aligned; More menu = Edit Mode · CSV · Mileage.
- Reports: cards Total Income · Net Revenue · Total Expenses · Net Profit (after expenses, mileage) · Total Sessions · Total Miles; monthly table 8 headers / 8 cells; family table 6 / 6.
- Console: no messages.
- Before the cache bypass the pane ran stale `historical.js` / `app-core.js` / `reports.js` and still showed Gross bars: the hard-cache warning in `CLAUDE-INSTRUCTIONS.md` is real; MTH must hard-refresh after the push.

## UNVERIFIED

- Real data (a real legacy share would have shown in the removed places; the net figures themselves are unchanged).
- Light theme for this change (CSS change is one deleted rule; nothing theme-specific).
- Print stylesheet with the narrower tables.

## Next

1. MTH: "Ship it" → push from his terminal (this commit + the slice-2 handoff commit 527d443), hard-refresh, check Dashboard charts and the Sessions table width.
2. Done 2026-11-04: `SECURITY-PRIVACY.md` row for `tutoring-show-split` marked retired (commit after 8f37ada).
