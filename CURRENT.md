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
- [ ] Add model capability detection for reasoning support (fixes GLM 400 errors)

**Note**: This phase should resolve the Production Issue "Free Model Error Handling (GLM/Z-AI)" by detecting which models support reasoning and handling responses that return thinking without final content.

---

## Session Notes

**2026-02-05**: Backlog reorganization complete. See `.claude/rules/06-backlog.md` for structure documentation.

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
