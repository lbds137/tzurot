# Current

> **Session**: 2026-02-03
> **Version**: v3.0.0-beta.66
> **Branch**: `develop`

---

## Phase 2: Configuration Consolidation (In Progress)

Two PRs open for review:

### PR #577: LLM_CONFIG_FIELDS Metadata (Part B)

**New file**: `packages/common-types/src/schemas/llmConfigFields.ts`

Single source of truth for all 22 LLM config fields with:

- Zod schema validation
- Default values
- Category grouping (sampling, output, memory, reasoning)
- Snake_case ↔ camelCase mappings

**Changes**:

- `llmAdvancedParams.ts` now re-exports from `llmConfigFields.ts`
- `DiagnosticCollector.ts` imports `ConvertedReasoningConfig` from common-types
- 30 new tests in `llmConfigFields.test.ts`

### PR #578: Always Use Channel History (Part A)

**Key change**: `MessageContextBuilder.fetchDbHistory()` always uses `getChannelHistory()`.

- Removed conditional `useChannelHistory` toggle
- Deprecated `getRecentHistory()` method (kept for backward compat)
- **Kept** `ExtendedContextSettingsResolver` - still needed for admin/personality overrides

**Why keep ExtendedContextSettingsResolver**: It provides cascading resolution for Discord fetch toggle and token limits. Only the DB fetch toggle was removed (now always-on).

---

## Plan Status

**Phase 1**: ✅ Complete (PR #573 merged)

**Phase 2**: 🔄 PRs Open (#577, #578)

- ✅ LLM_CONFIG_FIELDS metadata schema
- ✅ Re-export from llmAdvancedParams.ts
- ✅ Align DiagnosticCollector types
- ✅ Hard-switch to getChannelHistory
- ✅ Deprecate getRecentHistory
- ⏭️ Skipped: Delete ExtendedContextSettingsResolver (still useful)
- ⏭️ Deferred: PersonalityDefaults refactor (not worth complexity)

**Phase 3**: Schema Cleanup (after Phase 2 stable)

**Phase 4**: Reasoning/Thinking Modernization

**Full plan**: `~/.claude/plans/tender-tinkering-stonebraker.md`

---

## Previous: v3.0.0-beta.66

### Pino Logger Bug Fix

**Bug**: `Cannot read properties of undefined (reading 'Symbol(pino.msgPrefix)')` at GenerationStep.

**Fix**: Call logger methods directly instead of extracting method references.

### DB-Sync Singleton Flag Fix

**Bug**: After db-sync, `is_default` or `is_free_default` flag could be lost.

**Fix**: Propagate winner's flag to other environment after singleton resolution.

### Dependency Updates

Consolidated 6 Dependabot PRs (#567-572)

---

## Previous Session (2026-01-31)

### Message Reactions in XML

- Reaction extraction from Discord messages (last 5 messages)
- Reactor personas in participant context
- XML formatting with `<reactions>` sections
- Stop sequence activation tracking

### Other Fixes

- db-sync exclusions for user preferences
- `/admin debug` AI error message ID support
- DeepSeek R1 error handling improvements

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
