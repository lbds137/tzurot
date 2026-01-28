# Backlog

> **Last Updated**: 2026-01-28
> **Version**: v3.0.0-beta.54

Single source of truth for all work. Tech debt competes for the same time as features.

**Tags**: 🏗️ `[LIFT]` refactor/debt | ✨ `[FEAT]` feature | 🐛 `[FIX]` bug | 🧹 `[CHORE]` maintenance

---

## Inbox

_New items go here. Triage to appropriate section later._

- ✨ `[FEAT]` **Message Reactions in XML** - Add reaction metadata to extended context messages showing emoji and who reacted (use same user/persona resolution as elsewhere)
- 🏗️ `[LIFT]` **Make ownerId NOT NULL** - `LlmConfig.ownerId` and `Personality.ownerId` are nullable but all records have owners. Migration to make non-nullable + clean up code paths handling null (removes dead "global/unowned" concept)
- 🏗️ `[LIFT]` **Audit and Reduce Re-exports** - Re-exports create spaghetti code and make it harder to understand module dependencies. Audit existing re-exports in `utils/` index files and eliminate non-essential ones. Update CLAUDE.md and/or skills to discourage re-exports except for truly public APIs (e.g., package entry points like `@tzurot/common-types`). Prefer direct imports from source modules.

---

## High Priority

_Top 3-5 items to pull into CURRENT next._

### 1. 🏗️ Slash Command & Dashboard UX Standardization ✅ DONE

Comprehensive standardization of slash commands and dashboard interactions completed across 114 files.

**Completed Work (beta.52-53):**

- [x] Extracted shared browse utilities into `utils/browse/` (buttonBuilder, customIdFactory, constants, truncation, types)
- [x] Extracted shared dashboard utilities into `utils/dashboard/` (closeHandler, refreshHandler, sessionHelpers, constants)
- [x] Migrated all browse commands to use shared factory pattern
- [x] Migrated all dashboards to use shared DASHBOARD_MESSAGES constants
- [x] Added type-safe command option accessors (`scripts/generate-command-types.ts`)
- [x] All 55 command handlers migrated to generated type-safe option accessors
- [x] Fixed `isDashboardInteraction` checks to only match dashboard actions
- [x] Added tests for non-dashboard actions (expand, browse, create) not matching dashboard checks
- [x] Fixed `wallet::` → `settings::apikey::` customId prefix pattern
- [x] Removed `componentPrefixes` hack - commands route naturally via matching prefixes
- [x] Hardened clone name regex to prevent ReDoS
- [x] Updated `tzurot-slash-command-ux` skill with file structure patterns
- [x] Documented autocomplete patterns in skill

**Remaining Polish (moved to Smaller Items):**

- Dashboard refresh race condition - Session-cached `isGlobal` becomes stale if preset visibility changed elsewhere

**Stats**: 29 commits, +6510/-1433 lines (114 files changed)

### 2. 🏗️ Extended Context Pipeline Refactor

The pipeline has two parallel code paths (extended context on/off) that constantly get out of sync. This is blocking reliable feature development.

- [ ] Remove the extended context toggle - always use extended context
- [ ] Remove dead code paths (all "if not extended context" branches)
- [ ] Unify the pipeline - single path from Discord → LLM input
- [ ] Consolidate types - `ConversationHistoryEntry` carries ALL data through pipeline

**Files**: `DiscordChannelFetcher.ts`, `MessageContextBuilder.ts`, `conversationUtils.ts`, pipeline steps

### 3. ✨ LTM Summarization (Shapes.inc Style)

Verbatim conversation storage is redundant with extended context. Replace with LLM-generated summaries.

- [ ] Configurable grouping (5, 10, 50 messages or 1h, 4h, 24h time windows)
- [ ] Separate LLM call for summarization (fast/cheap model)
- [ ] Store summaries as LTM instead of verbatim turns

**Depends on**: Pipeline Refactor

### 4. 🏗️ Memories Table Migration

Two formats coexist (shapes.inc imports vs tzurot-v3 verbatim). Need unified format.

- [ ] Design unified memory format (draw from both sources)
- [ ] One-time migration of existing tzurot-v3 memories
- [ ] Run existing verbatim memories through summarizer

**Depends on**: LTM Summarization

### 5. ✅ Admin Debug Doesn't Work with Failures (DONE)

`/admin debug` now shows diagnostics for failed jobs.

- [x] Record diagnostics on failure path, not just success path
- [x] Capture partial state at failure point
- [x] Add error field to DiagnosticPayload with category, message, referenceId
- [x] Update debug embed to show error information with red color

---

## Epic: User-Requested Features

_Features requested by actual users._

### ✨ User System Prompts

"Sidecar prompt" appended to system message per-user.

- [ ] Add `systemPrompt` field to User or UserPersonalityConfig
- [ ] `/me profile` dashboard upgrade to edit system prompt

### ✨ Channel Allowlist/Denylist

Prevents bot from spamming unwanted channels, reduces server kicks.

- [ ] Add `mode` (allowlist/denylist) and `channels` array to ChannelSettings
- [ ] `/channel restrict` command for server admins
- [ ] Middleware check in message handler
- [ ] Consider "Ghost Mode" - bot listens but only replies when pinged

### ✨ DM Personality Chat

Chat with personalities in DMs.

- [ ] Detect DM context in message handler
- [ ] Use conversation history to identify which personality user was chatting with
- [ ] Allow personality selection in DMs (`/character chat` in DMs)
- [ ] Handle first-time DM (no history yet)

---

## Epic: v2 Parity

_Eventually kill v2, but not urgent._

### ✨ NSFW Verification

User-level verification. User verifies once via Discord's native age-gating, unlocked everywhere after.

- [ ] Track `nsfwVerified` boolean on User record
- [ ] "Handshake" verification: interact with bot in a Discord age-gated channel

### ✨ Shapes.inc Import

Migration path from v2.

- [ ] Parse shapes.inc backup JSON format
- [ ] Import wizard slash command (`/character import`)
- [ ] Map shapes.inc fields to v3 personality schema
- [ ] Handle avatar migration

### 🧹 Rate Limiting

- [ ] Token bucket rate limiting

### ✨ PluralKit Proxy Support

- [ ] Support PluralKit proxied messages

---

## Epic: API & Validation Hardening

### 🏗️ Inconsistent Request Validation

Mix of manual type checks, Zod schemas, and `as Type` casting.

- [ ] Standardize on Zod schemas for all POST/PUT bodies
- [ ] Create `schemas/` directory, use `safeParse` consistently
- [ ] Audit: `routes/user/*.ts`, `routes/admin/*.ts`, `routes/internal/*.ts`

### 🐛 API Response Consistency

Same resource returns different fields from GET vs POST vs PUT.

- [ ] Shared response builder functions per resource type

### 🐛 Date String Validation for Memory Search

`dateFrom`/`dateTo` accepted without validation - invalid dates cause PostgreSQL errors.

### 🏗️ Zod Schema/TypeScript Interface Mismatch

Zod strips fields not in schema. When we add fields to TS interfaces but forget Zod, data disappears.

- [ ] Contract tests ensuring Zod schema keys match interface fields
- [ ] Use `.passthrough()` or `.strict()` during development
- [ ] Audit: `schemas.ts`, `jobs.ts`, route schemas

---

## Epic: Observability & Debugging

### 🏗️ Basic Structured Logging

Add event types: `rate_limit_hit`, `dedup_cache_hit`, `pipeline_step_failed`, `llm_request` with latency/tokens.

### ✨ Admin Debug Filtering

Add `/admin debug recent` with personality/user/channel filters.

### 🧹 DLQ Viewing Script

Create `scripts/debug/view-failed-jobs.ts` to inspect failed BullMQ jobs.

---

## Epic: Duplicate Detection Hardening

### 🐛 Temperature Strategy

Cache-busting temp 1.1 rejected by some providers. Need random jitter 0.95-1.0.

### 🏗️ Unbounded History Scanning

Scans entire history looking for 5 assistant messages. Add `MAX_SCAN_DEPTH = 100`.

### 🧹 Logging Verbosity

INFO log for EVERY response. Downgrade PASSED to DEBUG, keep NEAR-MISS/DUPLICATE at INFO.

---

## Epic: Memory System

### 🏗️ Per-User Quotas

No limits on memories per persona. Add `maxMemoriesPerPersona` (default: 10,000).

### 🐛 Redundant Referenced Messages

Reply to message in context stores it twice (context + `[Referenced content:]`).

---

## Epic: Incognito Mode Improvements

### 🐛 String Matching for Status

`data.message.includes('already')` is brittle. Add explicit `wasAlreadyActive` boolean.

### 🏗️ Parallel API Calls for Session Names

Status command fires up to 100 parallel API calls. Have API return names with sessions.

---

## Smaller Items

_Opportunistic work between major features._

### 🏗️ Type-Safe Command Options Hardening

From beta.54 code review observations:

- [ ] **CI Validation** - Add check to verify generated `commandOptions.ts` matches source command definitions (detect schema-handler drift)
- [ ] **AST-Based Parsing** - Current regex parsing could fail on template literals, dynamic `setRequired()`, unusual whitespace. Consider `@babel/parser` for production-grade robustness
- [ ] **Channel Type Refinement** - `typedOptions.ts:73` returns overly broad `Channel` type. Discord.js returns union of channel types; handlers may need runtime narrowing
- [ ] **Document Query Truncation** - `customIdFactory.ts` truncates query to 50 chars but limit not documented (only mentions Discord's 100-char customId limit)

### 🧹 Redis Failure Injection Tests

SessionManager has acknowledged gap in testing Redis failure scenarios. Add failure injection tests for graceful degradation verification.

### 🐛 Dashboard Refresh Race Condition

Session-cached `isGlobal` becomes stale if preset visibility changed elsewhere. Low priority - edge case.

### 🐛 Thinking Tag Leaking

`<thinking>` tags from reasoning models occasionally appear in output.

**Location**: `reasoningModelUtils.ts:stripThinkingTags()` or upstream.

### 🏗️ N+1 Query Pattern in UserReferenceResolver

Sequential DB queries in a loop for user references. Use batch extraction pattern.

### 🏗️ Split Large Fetcher/Formatter Files

`DiscordChannelFetcher.ts` (~600 lines) and `conversationUtils.ts` (~720 lines) need splitting.

### 🏗️ Job Idempotency Check

Add Redis-based `processed:${discordMessageId}` check in `AIJobProcessor` to prevent duplicate replies.

### 🏗️ Verify Vector Index Usage

Run `EXPLAIN ANALYZE` on production memory queries to confirm index is used.

### 🧹 Lint Warnings ✅ DONE

~~37 warnings~~ → **0 warnings** (beta.55 Tech Debt Sprint)

- Refactored 8 route handlers to extract helper functions
- Added documented suppressions where appropriate (40+ audited)
- All suppressions now have inline justifications

### 🧹 Consolidate import-personality Scripts

`scripts/data/import-personality/` workspace needs cleanup.

### 🧹 Railway CLI Non-Interactive Mode & Docs Consolidation

Railway shipped non-interactive CLI options (January 2026) - "AI friendly" calls for all methods.

**Current State** (scattered docs):

- `docs/reference/RAILWAY_CLI_REFERENCE.md` - Top level, 23KB
- `docs/reference/deployment/RAILWAY_DEPLOYMENT.md`
- `docs/reference/deployment/RAILWAY_VOLUME_SETUP.md`
- `docs/reference/deployment/RAILWAY_SHARED_VARIABLES.md`
- `tzurot-deployment` skill - Primary skill reference

**Tasks**:

- [ ] Research Railway's new non-interactive CLI options
- [ ] Update `RAILWAY_CLI_REFERENCE.md` with non-interactive examples
- [ ] Consolidate scattered deployment docs (consider merging into single reference)
- [ ] Update `tzurot-deployment` skill to reference consolidated docs
- [ ] Update `pnpm ops` commands if any can leverage non-interactive mode

### Testing Debt

Component test gaps (use `pnpm ops test:audit-services`):

- ~~`LongTermMemoryService.ts`~~ → Covered by `PgvectorMemoryAdapter.component.test.ts` (beta.55)
- `ConversationalRAGService.ts`, `PersonalityService.ts` (high)
- `ShortTermMemoryService.ts`, `SystemPromptService.ts`, `UserService.ts` (medium)

---

## Icebox

_Ideas for later. Resist the shiny object._

### Character & Prompt Features

- Character Card Import (V2/V3 PNG metadata)
- Lorebooks / Sticky Context - Keyword-triggered lore injection with TTL
- Author's Note Depth Injection

### Multi-Entity Features

- Multi-personality per channel
- Natural Order speaker selection
- Dream sequences (self-reflection)
- Relationship graphs

### Agentic Features

- Agentic Scaffolding (think → act → observe loop)
- OpenMemory Migration (waypoint graph, multi-sector storage)
- Contrastive Retrieval for RAG
- Dynamic Directive Injection (anti-sycophancy)

### Infrastructure

- Streaming responses
- Voice Synthesis (open-source TTS/STT)
- Image Generation
- Free-Tier Model Strategy
- Metrics & monitoring (Prometheus)
- Release Notifications

---

## Deferred

_Decided not to do yet._

| Item                              | Why                                           |
| --------------------------------- | --------------------------------------------- |
| Schema versioning for BullMQ jobs | No breaking changes yet                       |
| Contract tests for HTTP API       | Single consumer, integration tests sufficient |
| Redis pipelining                  | Fast enough at current traffic                |
| BYOK `lastUsedAt` tracking        | Nice-to-have, not breaking                    |
| Dependency Cruiser                | ESLint catches most issues                    |
| Handler factory generator         | Add when creating many new routes             |
| Scaling preparation (timers)      | Single-instance sufficient for now            |

---

## References

- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full release history
- [docs/proposals/backlog/OPENMEMORY_MIGRATION_PLAN.md](docs/proposals/backlog/OPENMEMORY_MIGRATION_PLAN.md)
- [docs/proposals/active/V2_FEATURE_TRACKING.md](docs/proposals/active/V2_FEATURE_TRACKING.md)
- [docs/research/sillytavern-features.md](docs/research/sillytavern-features.md)
- [docs/research/voice-cloning-2026.md](docs/research/voice-cloning-2026.md)
