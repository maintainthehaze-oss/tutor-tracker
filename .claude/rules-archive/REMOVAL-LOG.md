# Rules Removal Log — 2026-08-11

Audit criteria: (1) Would I already do this? (2) Is it correcting a weakness I no longer have? (3) Does it conflict with other instructions?

## Removed from CLAUDE.md

### 1. Section 3 "Token efficiency" (30 words)
**Reason:** Fully redundant. System prompt already says to read project rules, and "cheapest tier that holds quality" is default behavior for model selection. No scenario where I'd fail without this.

### 2. Section 5 "Brevity" (30 words)
**Reason:** The system prompt has extensive, specific coverage: "responses should be short and concise", "default to writing no comments", "End-of-turn summary: one or two sentences", "Don't narrate your internal deliberation." This section adds nothing that isn't already enforced.

### 3. "Record every model used, its scope, and whether output was independently verified" (from Section 1)
**Reason:** Unrealistic. No infrastructure exists to maintain a running model log across a session. The important part (routing decisions) is preserved.

### 4. "each repo's CLAUDE.md should be just @AGENTS.md" (from Section 4)
**Reason:** Conflicts with practice. This project has a detailed CLAUDE-INSTRUCTIONS.md that is essential and cannot be replaced with a pointer. The rule doesn't match how the project actually works.

## Removed from CLAUDE-INSTRUCTIONS.md

### 5. Bug #1 "Client ID type mismatch — FIXED" (85 words)
**Reason:** Marked FIXED. The `String(cl.id) === String(id)` pattern is in the code. Documenting a resolved bug that I can see in the source is noise.

### 6. Bug #4 detail "Import validation — IMPROVED" (45 words → trimmed to 0, merged into Known Issues)
**Reason:** The validation logic is in ui.js. Import validation is working code, not an open issue. The migrateData() note was preserved as part of the module pattern description.

### 7. Preference "Client cards are clickable"
**Reason:** Observable from the code. The click handler is in event delegation and the CSS makes it obvious.

### 8. Preference "Monthly Summary on Sessions tab"
**Reason:** Observable from the code and HTML.

### 9. Preference "CSP meta tag"
**Reason:** Observable from index.html. I don't need to be told a CSP exists — I'd see the `<meta>` tag.

### 10. Deploy step 6 "Verify client names appear in Top Clients and Per-Client Statistics"
**Reason:** Was tied to Bug #1, which is fixed. No longer a regression risk that needs a specific deploy-step callout.

## Kept but compressed

Everything else was preserved with reduced verbosity. The module pattern section lost the code example (the pattern is simple enough to describe in prose). Preferences were consolidated into five bullet points instead of eleven. The deploy checklist went from 6 steps to 4.

## Not modified

- **Memory (audit-reports-run-stale.md):** Still relevant and already concise.
- **settings.local.json:** Permission allowlist, not instruction rules. Contains ~15 one-off approved commands that could be cleaned up separately, but that's operational config, not rules.
