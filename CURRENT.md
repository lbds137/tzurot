# Current

> **Session**: 2026-02-05
> **Version**: v3.0.0-beta.67
> **Branch**: `develop`

---

## Just Released: v3.0.0-beta.67

### Service Layer Consolidation

- **LlmConfigService** - Unified service with scope-based access (GLOBAL/USER)
- **Shared schemas** - `LlmConfigCreateSchema`, `LlmConfigUpdateSchema` in common-types
- **Context settings** - `maxMessages`, `maxAge`, `maxImages` with cascade behavior
- **Feature parity** - User routes now support all memory settings

**PRs merged**: #582, #583, #584

---

## Remaining Plan Items

**Full plan**: `~/.claude/plans/tender-tinkering-stonebraker.md`

### Phase 2: Schema Cleanup (DEFERRED)

Waiting for production verification of new context columns before removing legacy `extendedContext*` columns.

- [ ] Remove `extendedContext*` columns from AdminSettings/ChannelSettings/Personality
- [ ] Delete `getRecentHistory()` method
- [ ] Clean up Prisma schema

### Phase 3: Reasoning/Thinking Modernization (FUTURE)

- [ ] Switch to unified `reasoning` parameter
- [ ] Simplify extraction to use `additional_kwargs`
- [ ] Verify reasoning not stored in conversation history

---

## Backlog Triage Needed

Items to reorganize in next session:

1. **Zod schema issues** - Multiple mentions scattered across backlog, consolidate to High Priority
2. **Production bugs** - Added to new "Production Issues" section (GLM 400 errors, quota handling)
3. **Full reorganization** - Consider MCP council review of backlog structure

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
