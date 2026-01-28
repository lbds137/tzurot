# Current

> **Session**: 2026-01-28
> **Version**: v3.0.0-beta.54

---

## Session Goal

Fix bugs and improvements: model indicator for errors, extended context DB cap, persona edit error.

---

## Active Task

### Bug Fixes (2026-01-28)

1. **Model indicator for errors** - Display footer (model used, guest mode, etc.) on error responses too
2. **Extended context DB cap** - Use `extended_context_max_messages` setting to limit DB query instead of dynamic context window
3. **Persona edit error** - User reports "Failed to save persona" when editing name/preferred_name (investigate)

---

## Scratchpad

### Issue 3 Root Cause (RESOLVED)

- **Root Cause**: Identity section modal includes ALL 5 fields (name, preferredName, pronouns, description, content)
- When content is empty in modal, `unflattenPersonaData` converted `''` to `null`
- API saw `body.content = null` (not undefined), entered validation block
- `extractString(null)` returns `null`, triggering "Content cannot be empty" error
- **Fix**: Both API and bot-client updated - empty content now omitted from update payload instead of sending null

---

## Recent Highlights

- **beta.55** (pending): Tech Debt Sprint - 31→0 lint warnings, 40+ suppressions audited, PgvectorMemoryAdapter component test
- **beta.54**: Standardize button emoji usage, preserve browseContext in refresh handler
- **beta.53**: Type-safe command option accessors, UX Standardization epic complete (114 files, 25 commits)
- **beta.52**: Shared browse/dashboard utilities, `/persona` and `/settings` commands, customId standardization

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items (replaces ROADMAP + TECH_DEBT)
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
