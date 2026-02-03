# Current

> **Session**: 2026-02-02
> **Version**: v3.0.0-beta.66
> **Branch**: `develop`

---

## Released: v3.0.0-beta.66 (Bugfix)

### Pino Logger Bug Fix

**Bug**: `Cannot read properties of undefined (reading 'Symbol(pino.msgPrefix)')` at GenerationStep.

**Root Cause**: In `RetryDecisionHelper.ts`, the pattern `const logFn = logger.warn` extracts a method reference without binding, losing the `this` context.

**Fix**: Call logger methods directly instead of extracting them.

**Test**: `RetryDecisionHelper.int.test.ts` - integration test using real pino (not mocked).

### DB-Sync Singleton Flag Fix

**Bug**: After db-sync, `is_default` or `is_free_default` flag could be lost when dev and prod had different default configs.

**Root Cause**: Singleton resolution cleared the loser's flag but didn't set the winner's flag in the other environment. Since `is_default`/`is_free_default` are in `excludeColumns` (not copied during sync), the winning config arrived without its flag set.

**Fix**: When resolving singleton conflicts:

1. Clear the loser's flag (as before)
2. Set the winner's flag in the other environment (if config exists)
3. Track pending resolutions and finalize after sync (for newly synced configs)

**Files Changed**:

- `llmConfigSingletons.ts` - Added `finalizeLlmConfigSingletonFlags()` and winner flag propagation
- `DatabaseSyncService.ts` - Call finalize after sync loop

### Dependency Updates

Consolidated 6 Dependabot PRs (#567-572):

- @commitlint/cli/config-conventional: 20.3.1 → 20.4.1
- @langchain/core: 1.1.17 → 1.1.18
- @langchain/openai: 1.2.3 → 1.2.4
- @types/node: 25.1.0 → 25.2.0
- globals: 17.2.0 → 17.3.0
- turbo: 2.8.0 → 2.8.1

---

## Plan Status

**Phase 1**: ✅ Complete (PR #573)

**Phase 2**: Configuration Consolidation (NEXT)

- Remove legacy context path (always use extended context)
- Delete `ExtendedContextSettingsResolver` (over-engineered)
- Make `LLM_CONFIG_OVERRIDE_KEYS` single source of truth

**Phase 3**: Schema Cleanup (after Phase 2 stable)

**Phase 4**: Reasoning/Thinking Modernization

**Full plan**: `~/.claude/plans/tender-tinkering-stonebraker.md`

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
