# 2026-10-11 — Roadmap 4.2 pass 2 + the one-way store split, measured and designed (Claude Code, Fable 5.1)

## Where 4.2 stands
The Opus 5.5 pass (`2026-10-11-store-speed-4-2.md`) cached the frozen archive's canonical text and stopped re-cloning it
(shipped). This session measured in a real browser for the first time, landed a second two-way-door pass, and wrote the
design for the remaining one-way door (receipts and archive out of the per-save record). The one-way door is NOT built.

## Measured (fabricated realistic fixture, receipts padded to 3.5 MB; envelope 11.6 MB, same shape as the real 12.6 MB)
Browser (built-in pane, Chrome, tab reported `visibilityState: hidden`, so throttled and noisy):
| | before pass 2 | after pass 2 |
|---|---|---|
| `repository.execute` settings save | 264–450 ms (CAS get+put 11 MB: 90–150 ms) | 320–370 ms (hidden tab) |
| `App.runCommand` incl. view refresh + re-render | 650–935 ms (hidden); ~200 ms in one run | 350–430 ms (hidden) |
| reopen (open + verify) after reload | 416 ms adapter open; page ready ≈ 1.7 s | ready, revision kept |
Node (CPU floor, memory adapter): 210 → ~150 ms per save. Micro-costs of the full 11.3 MB text: canonical 81 ms,
SHA-256 104 ms, JSON clone 130 ms (19 ms without the archive), IDB put 48–100 ms; working WITHOUT receipts is 0.21 MB
and puts in 3 ms. Per-save view refresh is cheap (read 21 ms → now shares receipts; dashboard render 164 ms is the chart).
Browser numbers are unreliable to ±2× while the pane is hidden; treat the Node floor and the IDB costs as the facts.

## Pass 2 (shipped in this commit set, `repository.js` only, stored bytes unchanged)
- `validateArchive`: the 4 MB raw-snapshot parse and per-collection equality run once per deep-frozen archive object.
- `cloneEnvelope`: shares the frozen `working.historical` (no command writes it) and copies `working.receipts`
  shallowly (receipt values are replaced whole or deleted, never edited in place).
- `read()`: the view shares the frozen receipts map instead of cloning 3.5 MB per read.
Proof: the same 12 commands through old and new code on the realistic fixture give byte-identical stored envelopes and
integrity at every step (scratch script, not a test). `node --test` 261/261 (+2 pins; the read-view pin is
mutation-verified; the "memo never skips an unfrozen archive" pin is NOT load-bearing from the public API: defence in
depth only). OBSERVED in the browser: new code served, receipt save/delete through the shallow copy, reopen at the same
revision with integrity verified, no console errors. Independent Opus fleet-reviewer (read-only): GO, no exploit path; it confirmed no in-place write to shared frozen data, prototype-safe spread, sound memo keying, unchanged bytes.

## The one-way door (schema 3): design, not built — needs its own contract and MTH's "Ship it"
Goal: a save writes ≈0.2–1.4 MB instead of 11–13 MB, so a click costs ≈30–60 ms.
- IndexedDB `tutor-tracker-protected-production` version 2 adds two object stores next to `repository`:
  `archive` (one write-once record keyed by `archive.id`: rawSnapshot, rawHash, originals, manifest, reportSources,
  activatedAt, timeZone, sourceCommit) and `receipts` (key = expense key, value = `{hash, body}`).
- Envelope schema 3 keeps `archiveId` + `archiveHash` (SHA-256 of the archive record's canonical text) and
  `working.receipts` becomes a manifest `{key: sha256(body)}`; `integrity` covers the envelope as today, so the archive
  and every receipt body stay tamper-evident through their hashes. `open()` verifies the archive record against
  `archiveHash` and each receipt body against its manifest hash before publishing.
- Migration in `open()`: a schema-2 record is split inside ONE readwrite transaction over the three stores
  (archive put, receipts put ×N, envelope put); any failure aborts and leaves schema 2 intact. Forward-only: an older
  build refuses a schema-3 store with "Invalid protected store" (same as schema 1 → 2 did).
- Files: private recovery v2 = `{format:'tutor-tracker-private-recovery-v2', snapshot, archive, receipts}`; portable v2
  likewise; both v1 readers kept for import. `guardFreshImport` reads the raw snapshot from the archive record.
- `read()` keeps its synchronous shape: receipt bodies are loaded once at `open()` into memory (3.5 MB, as now).
- Blast radius: `repository.js` (adapter, validateEnvelope/validateArchive, seal/verify, open, exports, imports,
  activation), the Node memory adapter in `tests/helpers/harness.cjs` (three "stores"), tests in `tests/slice1`,
  `tests/slice4` (portable, sync, transfer-guard), `tests/production/activation.test.cjs`, `tests/events.test.cjs`;
  `SECURITY-PRIVACY.md:19` store table (published text: MTH's veto); README store description. UI files unchanged.
- Rehearsal before the real device: migrate the fabricated 11.6 MB store in the preview; MTH migrates a copy of his
  newest private recovery in a LOCAL preview (private, never shared) and checks exports and counts.
- Rollback: none in place after migration (one-way). The pre-migration private recovery file is the rollback.

## Ruling (veto if wrong)
Not built now. At ≈150–250 ms per save after pass 2, the split buys ≈150 ms per click for a one-way storage migration
of real tax evidence. Build it only when MTH says saves feel slow on his device (signal: the "Revision n" footer lags
a click by more than about half a second) — then follow this design as its own slice via `/process design`.
