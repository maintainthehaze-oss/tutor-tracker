# 2026-09-08 - Remediation + implementation plan (cross-session) - FINAL

Status: FINAL (agreed by both sessions 2026-09-08). Drafted by session "tutoring-tracker-pro-files-6c" (Fable); reviewed by session "Desktop app health check review" (Fable), which reviewed and initially accepted R2 and R3; MTH then ruled that the 6c session handles every remaining item. See "Coordination log".

## Why this exists
Two sessions worked the same repo tonight from two different clones and three different handoff locations. Nothing broke (both clones are at a0343c2 == origin/main, same tree hash ffe0214, no tracked changes in either; B carries only untracked/doc edits), but the trail was noisy and one memory note was wrong. This plan fixes the structure so the next session starts in the right place, and sequences the still-pending production activation without re-deriving it.

## Facts (traced 2026-09-08)
- Live site: https://maintainthehaze-oss.github.io/tutor-tracker/ serves sw.js CACHE_NAME tutor-tracker-v41, all js/*.js 200. Only 404 is local-config.js (gitignored private file, expected).
- Clone A: `C:\Users\dev31\OneDrive\Documents\Claude\Projects\TUTORING TRACKER`. Cleaned tonight (2 dead worktrees pruned, 2 merged branches deleted, temp_clone + 2 obsolete .bat recycled, gc). Home address never in history (`git log --all -S`).
- Clone B: `Pro_files\production-release` (this repo). Uncommitted: HANDOFF.md (2 pointer lines), docs/handoffs/ (doctor review, cleanup, this plan), 13 untracked Codex notes in protected/ (Codex's, leave).
- Clone C: `C:\Users\dev31\Claude\Projects\TUTORING TRACKER`, stale, last commit 2026-07-19.
- Byte diffs A vs B are CRLF only (both core.autocrlf=true; B checked out by the sandbox user).
- Git in B needs `-c safe.directory=*` (sandbox-owned folder).

## Remediation items
| # | Item | Owner | Gate | State |
|---|---|---|---|---|
| R1 | Move tonight's cleanup handoff from outer Pro_files docs/handoffs into B; pointer in B HANDOFF.md; outer pointer removed | 6c session | none | DONE |
| R2 | Commit the docs-only handoffs in B (HANDOFF.md, docs/handoffs/*). No push. | 6c session (MTH ruled one session handles all) | MTH says "commit" (doctrine: commit only when asked) | OPEN |
| R3 | Add a "Clones" section to tracked CLAUDE-INSTRUCTIONS.md: which clone each launch folder uses; `git pull --ff-only` at session start and before any push; never push from a clone that is behind. Also state that the user-scope deploy-gate hook fires in both clones, so a push to main stays blocked until MTH says "Ship it". Also: spell git remotes literally; deploy-gate fails closed on $/backtick in a remote. One tracked edit covers both clones. | 6c session (MTH ruled one session handles all) | ships with next "Ship it" deploy | DRAFTED in working tree by health-check session before stand-down (+14/-1, reviewed and kept by 6c); commits with R2 |
| R4 | safe.directory for B: keep the per-command `-c safe.directory=*` override; do not add a global exception | MTH (security posture) | MTH ruling | RECOMMENDED keep-as-is |
| R5 | Fix memory note tutor-tracker-repo-location.md (said "not a git repo, handoffs go here") | 6c session | none | DONE |
| R6 | Clone C: verify no uncommitted/unpushed work (health-check session saw none earlier tonight; re-check at execution), then Recycle Bin (reversible) | 6c session | MTH "go" | OPEN |

## Implementation plan (pending production activation)
Unchanged from HANDOFF.md 2026-09-06 and docs/PRODUCTION_ACTIVATION_CONTRACT.md; restated only as sequence and gates.
| Step | Who | Gate |
|---|---|---|
| I1 Owner saves edits and opens /protected/ in the same Chrome tab (id 613211344) | MTH | live tab |
| I2 Save and reopen private recovery; verify capture completeness | MTH + session with Chrome control | private data never uploaded |
| I3 Publish root files from Pro_files deployment/ (root-index.html, root-sw.js, protected-redirect.js) into B, bump CACHE_NAME, node --check, commit | session launched from Pro_files | MTH "Ship it" (push) |
| I4 Activate, verify reload on desktop + mobile, record receipt evidence | MTH + session | contract invariants |
| I5 Closeout handoff in B docs/handoffs; update IMPLEMENTATION_PLAN.md status line in outer Pro_files | session | none |

## Risks MTH cannot see
- Two live clones will drift the first time someone pushes from one without pulling in the other. R3 is the only structural fix short of retiring a clone; retiring Clone A would break the launch.json preview config and the OneDrive-folder sessions.
- Docs-only commits in B, if left uncommitted, get swept into the next feature commit by whoever runs `git add -A`. R2 prevents that.
- Clone C is 7 weeks stale; a session opened there by mistake would work on old code.

## Coordination log
- 2026-09-08 ~00:15 6c -> health-check: draft sent via send_message, asked for refutations + R2/R3 ownership + any /doctor findings to add.
- 2026-09-08 health-check -> 6c: one wording corrected (the send_message said both clones "clean"; B had the uncommitted doctor handoff, as the Facts section already states). Accepted R2 and R3, both gated on MTH "commit". Added: deploy-gate hook fires in both clones (folded into R3). Noted its own memory rewrite; the 6c rewrite of tutor-tracker-repo-location.md is the later one and agrees with handoffs-stay-in-this-repo.
- 2026-09-08 6c -> health-check: plan marked FINAL; shared files (this doc, HANDOFF.md) released to the health-check session for R2/R3.
- 2026-09-08 MTH -> 6c: "Which session should handle everything?" Ruled: 6c session owns R2, R3, R6. Health-check session told to stand down.
- 2026-09-08 health-check -> 6c: stood down; disclosed an uncommitted R3 draft in CLAUDE-INSTRUCTIONS.md. 6c reviewed the diff: covers all R3 points, kept as is.
