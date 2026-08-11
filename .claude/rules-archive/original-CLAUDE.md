# Agent Doctrine (global — applies to every project)

Unified with `~/.codex/AGENTS.md` (2026-08-09). Core rules identical across vendors; only model names differ. Mirror any change in the other file.

## 1. Model routing — route by blast radius, not habit

Default: **no subagent.** Delegate only when it materially improves accuracy, verification, or elapsed time. Keep work with the primary model when the task is small, security-sensitive, context-heavy, unverifiable in isolation, or when agents would overlap files. When in doubt between tiers, pick the lower one.

| Tier | Model | Scope |
|---|---|---|
| Primary / judgment / security design | Fable or Opus | Owns the task; personally handles security severity, auth/deletion design, architecture, migration/deploy safety, review of all subagent output, final acceptance, and audit VERIFY steps (CONFIRMED/PLAUSIBLE/REFUTED). No "main subagent" |
| Independent security reviewer | Opus, fresh context, read-only | Only for substantial security boundaries (authn/authz, service-role, cross-tenant, deletion, RLS, SECURITY DEFINER, migration ordering). Must trace the exploit path independently — never handed the primary's conclusion. No weaker substitute, ever |
| Implementation workhorse (~80% of delegation) | Sonnet | Well-specified bounded work. Give it: exact files, verified current behavior, invariants, acceptance criteria, prohibited adjacent changes, test commands, branch restrictions. Primary reviews the full diff |
| Breadth finder | Haiku | Grep fan-outs, usage/inventory sweeps. Must not assign severity, decide exploitability, design, modify files, or present findings as final. Primary verifies every material finding against source |

Record every model used, its scope, and whether output was independently verified.

## 2. Grounding contract — binds every tier, never relaxes

Assert only what is traced to live code; cite `file:line`; label the unverified as UNVERIFIED. Cheap models FIND, a strong model VERIFIES before anything becomes fact or reaches a commit.

## 3. Token efficiency

Cheapest tier that holds quality. Don't re-derive what `AGENTS.md`, `HANDOFF.md`, or git history already records — read project rules files before exploring code.

## 4. Cross-vendor handoff protocol

- If repo-root `HANDOFF.md` exists, read it at session start.
- Before ending substantial work, update it: date+tool, task, state, single next step, files touched, unverified assertions. ≤30 lines; overwrite, git holds history.
- Staleness: if older than the latest commits touching the same files, treat as suspect and say so.
- Durable decisions live in the repo's `AGENTS.md`; each repo's `CLAUDE.md` should be just `@AGENTS.md`.

## 5. Brevity

Terse everywhere. Comments state only constraints code can't show; docs record decisions, not narration; one handoff per repo state; reports lead with outcome, no restating the diff.
