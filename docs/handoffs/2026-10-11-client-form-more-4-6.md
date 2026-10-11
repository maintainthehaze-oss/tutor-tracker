# 2026-10-11 — Roadmap §4.6: Subjects / Learning Goals folded under "More" (Claude Code, Fable 5.1)

**Ruling (delegated):** next task after the leftovers = §4.6, the smallest open roadmap item that needs no MTH ruling. Slice E waits on the five recurring-slot rulings; F / 4.4 / 4.7 are larger.

## What changed
- `protected/index.html`: the Subjects input and Learning Goals textarea moved into `<details class="form-group-full form-more" id="client-more">` at the end of the client form, closed by default. Ids unchanged, so `saveClient` reads them exactly as before; nothing in storage changes.
- `protected/js/clients.js` `openClientForm`: the fold is closed for Add and for Edit, and opened only when the edited client already has a `subjects` or `goals` value.
- `protected/styles.css`: `.form-more` block (border-top, caret via `\25B8` / `\25BE`, muted hint). First attempt wrote a control byte instead of the CSS escape (Python octal `\25`); caught in the preview (tofu glyph), fixed.
- `tests/family-payment.test.cjs`: +1 test pins markup (both fields inside the fold, closed in markup, last in the form), the open/closed rule across Add → Edit(empty) → save "Algebra" → Edit(filled) → Add, and that the stored value is unchanged.

## Verification
- `node --test` 221/221 (was 220); static guard 18/18; `node --check protected/js/*.js` clean.
- Mutations (each red, then restored byte-identical): always-open on edit; open rule removed; `open` attribute in markup.
- OBSERVED on the fabricated preview (dark, desktop): Edit client → fold closed, summary "▸ More  Subjects, learning goals"; tap → "▾", Subjects and Learning Goals visible. NOT observed: light theme, 640 px, real data, a client with existing subjects (the fixture has none; covered by the test only).

Shipped 2026-10-11 on "Ship it": `main` `9bf9206 → 20515f5`, pushed by MTH; all 3 live files byte-identical via curl (3rd poll, ~40 s). Real-data look at the fold still NOT observed (MTH: hard-refresh once, open any client).
