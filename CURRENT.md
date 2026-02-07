# Current

> **Session**: 2026-02-06
> **Version**: v3.0.0-beta.67
> **Branch**: `develop`

---

## Recently Completed

### Error Handling, Content Recovery & Diagnostics (PR #587)

- **DeepSeek R1 crash fix**: Clone response before consuming body — prevents crash when reasoning interception fails
- **400 content recovery**: Extract valid content from error responses (free-tier models returning content alongside 400)
- **ApiErrorInfo → Zod unification**: Deleted manual interface, derived type from Zod schema (`technicalMessage` field added)
- **Technical message in Discord spoilers**: Error spoilers now show category + technical details + ref ID

### Negative Caching for Vision Failures (PR #586)

Two-tier negative cache prevents re-hammering failed vision API calls:

- Transient failures → L1 Redis cooldown (10 min)
- Permanent failures → L1 Redis (1h) + L2 PostgreSQL
- User-friendly fallback labels (`[Image unavailable: API key issue]`)
- New `failureCategory` column on `ImageDescriptionCache`

### Incremental Refactoring (PRs #580–#584)

- Phase 0: Claude Code config → rules files
- Phase 1: LlmConfigService consolidation
- Phase 1.5: Personality service consolidation
- Phase 3: Reasoning modernization (fetch wrapper retained — LangChain upstream limitation)

**Remaining**: Schema cleanup (remove legacy `extendedContext*` columns) — moved to BACKLOG Quick Wins, pending production verification.

---

## Session Notes

**2026-02-06**: Error handling PR #587 merged. Preparing release to production.
**2026-02-06**: Negative caching merged. Plan files cleaned up — remaining schema cleanup moved to BACKLOG.
**2026-02-05**: Backlog reorganization complete. See `.claude/rules/06-backlog.md` for structure documentation.

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
