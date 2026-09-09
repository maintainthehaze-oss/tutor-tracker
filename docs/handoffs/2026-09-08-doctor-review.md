# SESSION 2026-09-08 - Claude Code `/doctor` review - Fable - NO CODE

**State: clean. Zero changes to the app, settings, hooks, or this folder's slices. The Claude Code setup was verified healthy by two passes (the `/doctor` run, then a Fable subagent independent verify + remedy). Nothing to ship.**

The findings are about the global Claude Code setup, so they apply to every project MTH opens.

## What was checked
- Auto mode already default (`permissions.defaultMode=auto`, user scope).
- No unused user extensions: `fleet` / `process` skills in use; `cowork-plugin-management` + `prompt` skill already disabled; no user-scope MCP servers.
- Single install (desktop app), valid settings / agents / skills, lean `~/.claude/CLAUDE.md` (4.7 KB). No checked-in CLAUDE.md here.
- 3 user-scope PreToolUse hooks (fleet-guard, deploy-gate, docs-boundary) - ruled KEEP. Each ~90 ms; self-scoped or deliberately global. They fire in this folder too; deploy-gate's push-to-main guard is what blocks a `git push` until MTH says "Ship it".

## Denials in the window (3.2 days, 50 sessions, all projects)
| Cause | Count |
|---|---|
| hook: push-to-main | 16 |
| hook: ship-it sentinel | 1 |
| hook: fleet-guard mutex | 3 |
| auto-mode classifier | 4 |
| timeout | 1 |

All intentional guardrails. Nothing to pre-approve.

## Open item - RESOLVED on trace
Flagged: `U=$(git remote get-url docs...) && git push "$U" main` denied against the docs-backup allowlist (2 hits in the window).

Traced 2026-09-08: by design, not a bug. The hook (`PROTUTOR AI/tools/fleet/hooks/deploy-gate.mjs` line 209) fails closed on any remote token containing `$` or a backtick; the comments at lines 199-207 and 366-369 give the reason (a remote it cannot read literally cannot be verified; a false allow is a production deploy). Ruling: **keep as is**; spell the remote literally (`git push docs-backup main`). Veto if wrong.

UNVERIFIED: whether those 2 hits were real docs backups (transcripts not re-read).

## Session note
This handoff was first written into the PROTUTOR AI repo, then into the OneDrive TUTORING TRACKER clone, then into the outer Pro_files folder, before landing here in the production-release clone of the same repo (MTH: "there is a git repo though"). All earlier copies removed. One residue: a live ProTutor session had swept the stray pointer line into an unpushed local commit; the working-copy deletion is left in that tree. The production-release clone was fast-forwarded 7cdab16 -> a0343c2 (== origin/main == live site) in this session; it was clean, no tracked changes, no collisions with the 13 untracked Codex notes in protected/.

## Next step
None from this session. The pending items in root `HANDOFF.md` (root launch switch / activation) are unchanged and still MTH's.

## Files touched
- `docs/handoffs/2026-09-08-doctor-review.md` (this file, new)
- `HANDOFF.md` (one pointer line)
