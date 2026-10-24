# 2026-10-24 — Dashboard / toolbar / chrome polish (Fable 5.1 primary, Sonnet implementer)

Three small UI changes MTH approved in the 2026-10-24 review. Built as one commit, NOT pushed (rides with the next "Ship it").

## What changed
1. **Income Trend audit text behind an info toggle.** The "Current v2: stored historical shares…" paragraph (`#income-report-notice`) is hidden until the round "i" button in the card header (`#income-audit-toggle`, `data-action="toggle-income-audit"`) is pressed. The button only appears when there are warnings. The "Show the N records" link stays visible. `dashboard.js` (`incomeAuditOpen`, `App.toggleIncomeAudit`), `ui.js` (one click case), `index.html`, `styles.css`.
2. **Mileage folded into More.** Sessions toolbar is now Filters / More / Add Session / Week; "Mileage" is the last item under More. `index.html` only; the handler and the menu auto-close already covered it.
3. **Chrome polish.** The header sync string ("Local sync rehearsal · manual only" on the preview, "Cloud sync off · records stay on this device" live) moved out of the header into the top of the Settings modal body (same `#sync-indicator` id, so `sync.js`/`ui.js` strings are untouched; the dead header SVG and hidden gist link went with it). Footer `Ctrl+K / Ctrl+N / Esc` hints are now a "?" popover (`<details class="footer-help">`) that opens upward and closes on an outside click (`ui.js` selector extended).

## Rulings (veto-able)
- Only the Income Trend notice went behind the toggle, as approved. The same audit paragraph still shows in full on the Top Clients and Year-over-Year cards; hiding those too is a 5-line follow-up if MTH wants consistency.
- Sync string is MOVED, not duplicated: it is visible only while Settings is open. Production text unchanged.
- "Mileage" sits last in More (rarest tool).
- No privacy/security wording changed. No mobile/narrow work (desktop-only ruling).

## Evidence
- `node --test` 253/253 (was 249; +2 in `tests/sessions-layout-pins.test.cjs`, +2 in NEW `tests/dashboard-polish.test.cjs`).
- MUTATION-VERIFIED: moving the Mileage button back to the toolbar top level turned the new toolbar pin red (1 fail), restored → green.
- OBSERVED on the fabricated preview (127.0.0.1:8877, dark, 800×600 pane, scripts refetched with `cache:'reload'`, after "Initialize fabricated preview"): header has no sync string; toolbar reads Filters / More ▾ / Add Session / Week with More listing Show split / Edit Mode / CSV / Mileage; Income Trend shows the "i" button + "Show the 3 records" with the paragraph hidden, pressing "i" reveals it and pressing again hides it; footer "?" opens the three-shortcut popover upward and an outside click closes it; Settings opens with "Local sync rehearsal · manual only" as its first line. Zero console errors.
- NOT observed: light theme, real data, the production "Cloud sync off" string in place (text path unchanged, structure only).

## Next
"Ship it" → push the two local commits (3afb2e0 handoff + this one), hard-refresh, open Dashboard and the Sessions tab.
