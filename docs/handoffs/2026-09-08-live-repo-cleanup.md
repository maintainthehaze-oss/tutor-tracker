# 2026-09-08 - Live repo cleanup (Claude Code, Fable)

Repo: C:\Users\dev31\OneDrive\Documents\Claude\Projects\TUTORING TRACKER (main a0343c2). No tracked file changed, nothing committed or pushed.

## Done
- Pruned 2 stale worktree registrations (.claude/worktrees/* folders were already gone; .git/worktrees metadata was read-only, cleared and removed).
- Deleted 2 local branches, both fully merged into main at e1c9684: claude/audit-claude-rules-81b27a, claude/box-grid-slice-1-d3dc66.
- Sent to Recycle Bin (reversible): temp_clone/ (empty aborted clone from 2026-05-24, only a .git with a config.lock), PURGE-ADDRESS-FROM-HISTORY.bat (obsolete: git log -S confirms the home address was never committed), push-to-github.bat (obsolete: hard-coded SW v32 commit message and line counts; git add -A + push, risky).
- git gc: 289 loose objects -> one 5.84 MiB pack.

## Kept on purpose
- historical_sessions.json, local-config.js (private data, gitignored).
- CODEX-AUDIT-PROMPT.md (audit tooling, gitignored).
- .claude/rules-archive/ (tracked), protected/ and vendor/ (deployed content).

## Verified
- Working tree clean, only branch main, tracking origin/main.
- Live site https://maintainthehaze-oss.github.io/tutor-tracker/ loads; all js/*.js 200; sw.js CACHE_NAME tutor-tracker-v41 = local HEAD. Only 404 is local-config.js, expected (gitignored private file).

## Unverified
- Nothing. Cleanup did not touch deployable files.
