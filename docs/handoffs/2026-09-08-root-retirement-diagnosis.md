# Root retirement: "did not answer" diagnosis (2026-09-08, Fable, Claude Code, NO CODE CHANGED)

## Finding
"Root retirement worker did not answer" is the expected fail-safe. Live root `sw.js` is still the
legacy v41 cache worker (`CACHE_NAME = 'tutor-tracker-v41'`, verified via curl). Its message handler
only answers `SKIP_WAITING`; `RETIRE_LEGACY` is ignored, so `protected/js/sw-register.js:79` times out
after 10 s. `verifyProductionRecovery` (protected/js/ui.js:951) calls `retireLegacyRoot()` BEFORE
`commitLegacyActivation`, so storage was never touched. Root `index.html` (1470 lines) is still the
full legacy app. Root redirect is NOT published. Repo `main` == `origin/main` at 86d25a4.

## Staged files (outer Pro_files `deployment/`, dated 2026-09-06, `node --check` passes)
- `root-sw.js` -> repo `sw.js`: answers RETIRE_LEGACY / VERIFY_ROOT_RETIREMENT with
  `revision 'root-retirement-2026-09-06-v1'` (matches sw-register.js:61), requires exactly ONE
  window on the origin (`own.length !== 1` -> refuses), 302s `/tutor-tracker/` navigations to protected/.
  No cache, no clients.claim(). Plan item I3 says "bump CACHE_NAME": N/A, this worker has none.
- `root-index.html` -> repo `index.html`: 11-line shell, CSP self-only, loads `protected-redirect.js`.
- `protected-redirect.js` -> repo `protected-redirect.js`: `location.replace('protected/' + hash)`.

## Blocked
Copying the three files over the live root `index.html`/`sw.js` was denied by the Claude Code
permission classifier (overwrite of production entry files). Needs MTH to run the copy, or to run the
session with that permission allowed. Nothing was written to the repo except this doc.

## Next (in order)
1. MTH (or permitted session): copy the 3 files into repo root, `node --check sw.js protected-redirect.js`,
   commit. Push only on "Ship it". Wait for Pages; confirm live `/tutor-tracker/sw.js` contains
   `root-retirement-2026-09-06-v1`.
2. ONE tab only on the site (root worker refuses otherwise). Reload `/protected/` normally.
3. Review device upgrade; counts must be 11 clients / 121 sessions / 21 expenses / 0 taxPayments /
   1652 historical / 21 receipt entries, else STOP.
4. Reopen `C:\Users\dev31\Downloads\tutor-tracker-recovery\tutor-tracker-before-upgrade-private.json`
   and activate. Any error: stop, report verbatim.
5. Then I4/I5 of docs/handoffs/2026-09-08-remediation-plan.md.

## Outcome (2026-09-09, Cowork session, reported by owner)
ACTIVATED. Root retirement completed via a NEW recovery save (counts at activation: 122 sessions,
not 121; one session was added on 9/9 before activation). The earlier 121-session file
(13,930,117 bytes) no longer exists in Downloads/tutor-tracker-recovery. Two NEW saves are there
(13,932,511 bytes each, NOT identical, differ at line 8 = likely save timestamp):
`tutor-tracker-before-upgrade-private.json` 19:49 and `... (1).json` 20:46. The 20:46 file is
presumably the one used for activation (UNVERIFIED which one the owner picked). Keep both until
confirmed; copy to USB. Success toast text NOT captured (UNVERIFIED). Live root redirect and
post-activation dashboard state not independently verified by Claude Code.

Lessons:
- The very first "did not answer" was the tab lock (more than one window on the origin), not code.
- Chrome refuses file dialogs from automated clicks: Save / Reopen must be owner clicks.
- A "worker is installing, reload" step appeared once and cleared with a normal reload. Expected.

Remaining: I4 mobile reload verification + receipt evidence; owner to copy the newest recovery
file to USB (only copy). Plan: docs/handoffs/2026-09-08-remediation-plan.md.
