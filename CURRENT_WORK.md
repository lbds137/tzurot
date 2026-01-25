# Current Work

> Last updated: 2026-01-25

## Status: Public Beta Live

**Version**: v3.0.0-beta.49
**Deployment**: Railway (stable)
**Current Goal**: Prompt XML Cleanup & Chat Log Improvements

---

## In Progress: Prompt XML Cleanup ⬅️ CURRENT

**Branch**: `develop` (direct commits for small fixes)
**Context**: Debug output analysis revealed several prompt formatting issues

### This PR (beta.49)

**Completed:**

- [x] Remove `<current_turn>` XML wrapper from user messages (redundant - LLM API role is sufficient)
- [x] Update memory archive instruction to not reference `<current_turn>`
- [x] Fix voice message transcript sync bug (empty Discord content was overwriting transcripts)
- [x] Add `<roles>` as child element with individual `<role>` tags in participant context
- [x] Add pronouns field to participant context
- [x] DRY quoted message format (use same `<message>` structure as regular messages with `quoted="true"`)
- [x] Quote deduplication (skip quotes already in conversation history)

### Fast-Follow PR (after this release)

**Documented in TECH_DEBT.md:**

- [ ] User auto-creation for bystanders in extended context
- [ ] Resolve `discord:` IDs to proper UUIDs (both human users and other AI personalities)
- [ ] Mark messages from other AI personalities with `source="ai_personality"`

**Related Issues:**

- Multi-AI conversation role attribution (already in TECH_DEBT.md Priority 1)
- Voice transcript recovery script (added to TECH_DEBT.md Priority 1)

---

## Completed: Duplicate Detection & OpenAI Eviction Epic ✅

**Reference**: [`.claude/plans/snug-beaming-quilt.md`](.claude/plans/snug-beaming-quilt.md)

Multi-layer "Swiss Cheese" detection + escalating retry strategy + LTM embedding migration.

**All Phases Complete:**

- [x] **Phase 1-5**: Word Jaccard, local embeddings (bge-small-en-v1.5), semantic layer, escalating retry
- [x] **Phase 6**: LTM Embedding Migration - `@tzurot/embeddings` package, backfill, cleanup migration

**Result**: 50% OpenAI eviction complete (embeddings now local). Voice transcription (Whisper) remains a future epic.

---

## Completed: LLM Diagnostic Flight Recorder ✅

**Reference**: [`.claude/plans/snug-beaming-quilt.md`](.claude/plans/snug-beaming-quilt.md) (diagnostic section)

Full pipeline capture for debugging prompt construction issues:

- [x] `LlmDiagnosticLog` table with 24-hour retention
- [x] `DiagnosticCollector` class captures all pipeline stages
- [x] `/admin debug <message-id|request-id>` command
- [x] Sanitized JSONB payloads (handles NaN/Infinity)
- [x] Message ID lookup for user-friendly debugging

---

## Completed: LLM Config JSONB Consolidation ✅

Migrated individual LLM config columns to `advancedParameters` JSONB:

- [x] Step A: Added JSONB column, migrated data, updated code to read from JSONB
- [x] Step B: Dropped 7 legacy columns (temperature, topP, topK, frequencyPenalty, presencePenalty, repetitionPenalty, maxTokens)

---

## Completed: Quick Wins (Tech Debt & Naming)

Fast cleanup before building new features:

- [x] Drop deprecated `BotSettings` table (replaced by `AdminSettings`) ✅ PR #456
- [x] Rename `/me model` → `/me preset` (fix confusing terminology) ✅ PR #456
  - Renamed command group from `model` to `preset`
  - Updated parameter names (`config` → `preset`)
  - Renamed `set-default` → `default` for consistency with `/me profile default`
  - Updated help text and documentation

---

## Completed: Memory Management Commands (Phase 3 - Incognito Mode) ✅

**Reference**: [docs/proposals/active/MEMORY_MANAGEMENT_COMMANDS.md](docs/proposals/active/MEMORY_MANAGEMENT_COMMANDS.md)

**Phase 1 (STM) - COMPLETE** (shipped in beta.19):

- [x] `/history clear`, `/history undo`, `/history hard-delete`, `/history view`
- [x] Per-persona epoch tracking

**Phase 2 (LTM) - COMPLETE** (PR #462, #471):

- [x] `/memory list` - Paginated memory browser with detail view
- [x] `/memory search` - Semantic search with text fallback, pagination
- [x] `/memory stats` - View memory statistics per personality
- [x] Memory detail view with edit, delete, lock/unlock actions
- [x] Shared pagination utility (`paginationBuilder.ts`)
- [x] Focus Mode toggle (`/memory focus`) - API complete
- [x] `/memory delete` - Batch deletion with filters (PR #471)
- [x] `/memory purge` - Bulk deletion with typed confirmation (PR #471)
- [x] Focus Mode RAG integration (ai-worker skips retrieval when enabled)
- [x] Focus Mode visual indicator in responses (`🔒 Focus Mode • LTM retrieval disabled`)

**Phase 3 (Incognito Mode) - COMPLETE** (PR #479):

Incognito Mode temporarily disables LTM **writing** (new memories not saved). Distinct from Focus Mode which disables **reading**.

- [x] `/memory incognito enable` - Start incognito session (30m/1h/4h/until disable)
- [x] `/memory incognito disable` - End incognito session
- [x] `/memory incognito status` - Check current state and time remaining
- [x] `/memory incognito forget` - Retroactively delete memories from timeframe
- [x] Visual indicator - 👻 in responses when active
- [x] Storage bypass - Skip memory creation when incognito
- [x] Fail-open design - Redis errors don't block normal memory storage
- [x] Dual-key pattern - Per-personality or global "all" sessions
- [x] Comprehensive test coverage (54+ new tests)

**Architecture**:

- **Session storage**: Redis with TTL (ephemeral by design)
- **Key pattern**: `incognito:${userId}:${personalityId}` or `incognito:${userId}:all`
- **Duration options**: 30m, 1h, 4h, or until manual disable

**Phase 4 (Polish) - LATER:**

- [ ] Date range filtering for `/memory search` and `/memory delete`
- [ ] Audit logging for destructive operations
- [ ] `/memory restore` - restore soft-deleted memories
- [ ] `/memory add` - manually add a memory for a personality
- [ ] User-facing guide for memory management commands

**UX Naming Review (MCP Council Recommendations) - DEFERRED:**

| Current                | Proposed        | Rationale                                                                           |
| ---------------------- | --------------- | ----------------------------------------------------------------------------------- |
| `/memory focus`        | `/memory pause` | "Focus" is ambiguous (focus ON memories? or IGNORE them?); "pause" clearly suspends |
| `/memory purge`        | `/memory reset` | "Reset" feels more final than "purge" which overlaps with "delete"                  |
| `/history hard-delete` | `/history wipe` | User-facing term vs technical DB term; shorter to type                              |

_Naming changes deferred - do as part of a "UX consistency pass" after Phase 3._

---

## Paused: Slash Command UX Epic

**Reference**: [docs/proposals/active/SLASH_COMMAND_UX_EPIC.md](docs/proposals/active/SLASH_COMMAND_UX_EPIC.md)
**Branch**: `feature/slash-command-ux-epic`
**Scope**: Full alignment across ALL commands (~5 hours, 2 sessions)
**Status**: Planning complete, implementation ready

Standardize CRUD UX patterns with low-level shared utilities across all commands.

**Phase 1: Fix Free Model Validation Bug** (15 min):

- [ ] Add model validation in `createSetFreeDefaultHandler` (`api-gateway/src/routes/admin/llm-config.ts:307-344`)
- [ ] Reject presets that don't use free models (model ID ending in `:free`)
- [ ] Add test case

**Phase 2: Autocomplete Standardization** (1 hour):

- [ ] Create `formatAutocompleteOption()` utility in `common-types`
- [ ] Define `AUTOCOMPLETE_BADGES` constants (🌐 🌍 🔒 📖 ⭐ 🆓 🔐)
- [ ] Refactor `personalityAutocomplete.ts` to use shared utility
- [ ] Refactor `preset/autocomplete.ts` to use shared utility

**Phase 3: Dashboard Deletion Integration** (1.25 hours):

- [ ] Add Delete button to preset dashboard (only for owned presets)
- [ ] Implement confirmation flow (Cancel / 🗑️ Delete)
- [ ] Remove `/preset delete` command, delete `preset/delete.ts`
- [ ] Add Delete button to character dashboard
- [ ] Remove `/character delete` command, delete `character/delete.ts`

**Phase 4: Browse Command Pattern** (2.5 hours):

Convert ALL list commands to browse pattern:

| Command                                 | Status |
| --------------------------------------- | ------ |
| `/preset list` → `/preset browse`       | [ ]    |
| `/character list` → `/character browse` | [ ]    |
| `/channel list` → `/channel browse`     | [ ]    |
| `/wallet list` → `/wallet browse`       | [ ]    |
| `/memory list` → `/memory browse`       | [ ]    |

Each browse command includes: pagination, optional query, optional filter

---

## Deferred: DRY Message Extraction Refactor

**Plan**: [`.claude/plans/rustling-churning-pike.md`](.claude/plans/rustling-churning-pike.md)
**Tech Debt Tracking**: [`docs/proposals/active/TECH_DEBT.md`](docs/proposals/active/TECH_DEBT.md)

**Problem**: Two parallel message processing paths (main vs extended context) keep diverging.

**Solution**: Intermediate Representation (IR) pattern - single extraction function, both paths consume.

---

## TODO: ESLint Warnings

**Current**: 72 warnings (was 110)

Key areas remaining:

- `MessageContentBuilder.ts` - complexity 37 (deferred: needs IR pattern refactor)
- `SettingsModalFactory.ts` - complexity 26 (parsing logic inherent)

---

## Follow-ups

- [ ] Add ESLint rule to detect `findMany` without `take` limit
- [ ] Consider removing `@default(uuid())` from Prisma schema

---

## Next Up

| #   | Feature                        | Why                                                  |
| --- | ------------------------------ | ---------------------------------------------------- |
| 1   | **Slash Command UX Epic** ⬅️   | Standardize CRUD UX patterns, autocomplete           |
| 2   | **User System Prompts**        | Sidecar prompt appended to system message per-user   |
| 3   | **Channel Allowlist/Denylist** | User-requested - prevents unwanted channel responses |
| 4   | **DM Personality Chat**        | User-requested - chat with personalities in DMs      |
| 5   | **v2 Parity** (deprioritized)  | NSFW verification, Shapes import                     |

See [ROADMAP.md](ROADMAP.md) for full details.

---

## Recent Highlights

- **beta.49** (pending): Prompt XML cleanup - removed `<current_turn>` wrapper, fixed voice transcript sync bug, improved participant context with `<roles>` tags and pronouns, DRY quoted message format with deduplication
- **beta.48**: Avatar cache-busting fix (Discord CDN path-based versioning)
- **beta.47**: LLM Config JSONB cleanup (dropped 7 legacy columns), DB sync excluded tables (info vs warnings)
- **beta.46**: PromptBuilder refactor (complexity reduction, `usage="context_only_do_not_repeat"` for memory_archive), attachment description consolidation
- **beta.45**: LLM Diagnostic Flight Recorder complete - full pipeline capture, `/admin debug` command, message ID lookup
- **Redis Session Storage** (PR #483): DashboardSessionManager migrated to Redis - enables horizontal scaling
- **LTM Embedding Migration**: OpenAI eviction complete - now using local bge-small-en-v1.5 embeddings

Full release history: [GitHub Releases](https://github.com/lbds137/tzurot/releases)

---

## Quick Links

- **[ROADMAP.md](ROADMAP.md)** - Full roadmap with priorities
- [CLAUDE.md](CLAUDE.md) - AI assistant rules and project context
- [docs/proposals/active/TECH_DEBT.md](docs/proposals/active/TECH_DEBT.md) - Tech debt tracking

---

_This file reflects current focus. Updated when switching context._
