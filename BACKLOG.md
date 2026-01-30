# Backlog

> **Last Updated**: 2026-01-30
> **Version**: v3.0.0-beta.59

Single source of truth for all work. Tech debt competes for the same time as features.

**Tags**: 🏗️ `[LIFT]` refactor/debt | ✨ `[FEAT]` feature | 🐛 `[FIX]` bug | 🧹 `[CHORE]` maintenance

---

## Inbox

_New items go here. Triage to appropriate section later._

_(Empty - triage complete)_

---

## High Priority

_Top 3-5 items to pull into CURRENT next._

### 1. ✨ DM Personality Chat

Chat with personalities in DMs.

- [ ] Detect DM context in message handler
- [ ] Use conversation history to identify which personality user was chatting with
- [ ] Allow personality selection in DMs (`/character chat` in DMs)
- [ ] Handle first-time DM (no history yet)

### 2. ✨ NSFW Verification

User-level verification. User verifies once via Discord's native age-gating, unlocked everywhere after.

- [ ] Track `nsfwVerified` boolean on User record
- [ ] "Handshake" verification: interact with bot in a Discord age-gated channel

### 3. ✨ Multi-Personality Per Channel

Allow multiple personalities active in a single channel.

- [ ] Track multiple active personalities per channel
- [ ] Natural order speaker selection (who responds next)
- [ ] Handle @mentions when multiple personalities present
- [ ] `/channel add-personality` and `/channel remove-personality` commands

---

## Medium Priority

_Significant refactors that can wait._

### 🏗️ Extended Context Pipeline Refactor

The pipeline has two parallel code paths (extended context on/off) that constantly get out of sync. This is blocking reliable feature development.

- [ ] Remove the extended context toggle - always use extended context
- [ ] Remove dead code paths (all "if not extended context" branches)
- [ ] Unify the pipeline - single path from Discord → LLM input
- [ ] Consolidate types - `ConversationHistoryEntry` carries ALL data through pipeline

**Files**: `DiscordChannelFetcher.ts`, `MessageContextBuilder.ts`, `conversationUtils.ts`, pipeline steps

### ✨ LTM Summarization (Shapes.inc Style)

Verbatim conversation storage is redundant with extended context. Replace with LLM-generated summaries.

- [ ] Configurable grouping (5, 10, 50 messages or 1h, 4h, 24h time windows)
- [ ] Separate LLM call for summarization (fast/cheap model)
- [ ] Store summaries as LTM instead of verbatim turns

**Depends on**: Pipeline Refactor

### 🏗️ Memories Table Migration

Two formats coexist (shapes.inc imports vs tzurot-v3 verbatim). Need unified format.

- [ ] Design unified memory format (draw from both sources)
- [ ] One-time migration of existing tzurot-v3 memories
- [ ] Run existing verbatim memories through summarizer

**Depends on**: LTM Summarization

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

### ✨ Message Reactions in XML

Add reaction metadata to extended context messages showing emoji and who reacted.

- [ ] Extract reactions from Discord messages
- [ ] Format as XML metadata (use same user/persona resolution as elsewhere)
- [ ] Include in extended context output

---

## Epic: v2 Parity

_Eventually kill v2, but not urgent._

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

### ✨ Character Card Import

Import V2/V3 character cards (PNG with embedded metadata). SillyTavern compatibility.

- [ ] Parse PNG metadata (V2 JSON in tEXt chunk, V3 in separate format)
- [ ] Map character card fields to v3 personality schema
- [ ] `/character import` support for PNG files

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

### 🏗️ Metrics & Monitoring (Prometheus)

Production observability with metrics collection.

- [ ] Add Prometheus metrics endpoint
- [ ] Key metrics: request latency, token usage, error rates, queue depth
- [ ] Grafana dashboards (or Railway's built-in metrics)

---

## Epic: Logging Review (Low Priority)

_High effort, low reward. Do opportunistically._

### 🏗️ Consistent Service Prefix Injection

Currently manually hardcoding `[ServiceName]` in log messages. Should be injected automatically based on where the log originates.

- [ ] Audit current `[Service]` prefix patterns across codebase
- [ ] Design automatic prefix injection via logger factory
- [ ] Migrate existing logs to use consistent pattern
- [ ] Update `createLogger()` to auto-inject service context

**Note**: Large refactor touching most files. Only do when logging becomes a pain point.

### 🧹 Logging Verbosity Audit

Some operations log at INFO when they should be DEBUG.

- [ ] Duplicate detection: PASSED → DEBUG, keep NEAR-MISS/DUPLICATE at INFO
- [ ] Audit other high-frequency INFO logs
- [ ] Document logging level guidelines

---

## Epic: Memory System

### 🏗️ Per-User Quotas

No limits on memories per persona. Add `maxMemoriesPerPersona` (default: 10,000).

### 🐛 Redundant Referenced Messages

Reply to message in context stores it twice (context + `[Referenced content:]`).

### 🏗️ OpenMemory Migration

Waypoint graph architecture with multi-sector storage.

- [ ] Design waypoint graph schema
- [ ] Migration path from current flat memories
- [ ] See `docs/proposals/backlog/OPENMEMORY_MIGRATION_PLAN.md`

### 🏗️ Contrastive Retrieval for RAG

Improve memory retrieval quality with contrastive methods.

- [ ] Research contrastive retrieval approaches
- [ ] Prototype with current embedding system
- [ ] Benchmark against current similarity search

---

## Epic: Incognito Mode Improvements

### 🐛 String Matching for Status

`data.message.includes('already')` is brittle. Add explicit `wasAlreadyActive` boolean.

### 🏗️ Parallel API Calls for Session Names

Status command fires up to 100 parallel API calls. Have API return names with sessions.

---

## Epic: Advanced Prompt Features

_SillyTavern-inspired prompt engineering features._

### ✨ Lorebooks / Sticky Context

Keyword-triggered lore injection with TTL.

- [ ] Design lorebook schema (keywords, content, activation rules)
- [ ] Keyword detection in conversation context
- [ ] Inject matched lore into system prompt or context
- [ ] TTL/decay for injected content

### ✨ Author's Note Depth Injection

Insert author's notes at configurable depth in conversation.

- [ ] Add author's note field to personality/preset config
- [ ] Configurable injection depth (N messages from end)
- [ ] Support multiple author's notes with different depths

### 🏗️ Dynamic Directive Injection (Anti-Sycophancy)

Dynamically inject directives to improve response quality.

- [ ] Research anti-sycophancy prompt techniques
- [ ] Configurable directive templates
- [ ] A/B testing framework for directive effectiveness

---

## Epic: Agentic Features

_Self-directed personality behaviors._

### 🏗️ Agentic Scaffolding

Think → Act → Observe loop for autonomous behavior.

- [ ] Design agent loop architecture
- [ ] Tool/action definitions for personalities
- [ ] Observation and reflection mechanisms
- [ ] Safety guardrails and intervention points

### ✨ Dream Sequences

Self-reflection and memory consolidation.

- [ ] Scheduled "dream" processing (off-peak hours)
- [ ] Memory review and consolidation
- [ ] Personality growth/change over time

### 🏗️ Relationship Graphs

Track relationships between users and personalities.

- [ ] Relationship schema (affinity, history, context)
- [ ] Relationship-aware response generation
- [ ] Visualization for users (`/me relationships`)

---

## Epic: Multi-Modality

_Beyond text: voice and images._

### ✨ Voice Synthesis

Open-source TTS/STT for voice interactions.

- [ ] Research open-source TTS options (Coqui, Bark, etc.)
- [ ] Voice cloning for personality-specific voices
- [ ] Discord voice channel integration
- [ ] See `docs/research/voice-cloning-2026.md`

### ✨ Image Generation

AI-generated images from personalities.

- [ ] Integration with image generation APIs
- [ ] Personality-specific art styles
- [ ] `/imagine` command or inline generation triggers

---

## Smaller Items

_Opportunistic work between major features._

### ✨ Dynamic Model Selection for Presets

Preset creation via slash command should use OpenRouter's model list dynamically instead of hardcoded options.

- [ ] Fetch and cache OpenRouter model list (see `~/Projects/council-mcp` for reference implementation)
- [ ] Model slug dropdown populated from cached models (autocomplete)
- [ ] Vision model selection restricted to models with `image` modality
- [ ] Context window tokens auto-calculated as half of model's advertised context
- [ ] Free users restricted to free models only (both main model and vision model)
- [ ] Cache TTL strategy (models don't change often, ~24h reasonable)

**Reference**: OpenRouter `/api/v1/models` endpoint, council-mcp's model caching pattern

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

### 🏗️ Database-Configurable Model Capabilities

Currently, model capability detection (stop sequence support, reasoning model detection) is hardcoded in `LLMInvoker.ts` and `reasoningModelUtils.ts`. When OpenRouter adds/changes models, we need code deployments.

- [ ] Add `model_capabilities` table (model pattern → capabilities JSON)
- [ ] Migrate hardcoded patterns to database
- [ ] Admin command to update capabilities without deployment
- [ ] Cache capabilities with TTL to avoid DB hits on every request

**Reference**: `MODELS_WITHOUT_STOP_SUPPORT` in `LLMInvoker.ts`, `REASONING_MODEL_PATTERNS` in `reasoningModelUtils.ts`

### 🏗️ Audit and Reduce Re-exports

Re-exports create spaghetti code and obscure module dependencies.

- [ ] Audit existing re-exports in `utils/` index files
- [ ] Eliminate non-essential re-exports
- [ ] Exception: Package entry points (e.g., `@tzurot/common-types`)

### 🏗️ N+1 Query Pattern in UserReferenceResolver

Sequential DB queries in a loop for user references. Use batch extraction pattern.

### 🏗️ Split Large Fetcher/Formatter Files

`DiscordChannelFetcher.ts` (~600 lines) and `conversationUtils.ts` (~720 lines) need splitting.

### 🧹 Periodic Complexity/Filesize Audit

Files and functions creep toward ESLint limits over time. Proactive audit prevents emergency extractions.

- [ ] `pnpm ops lint:complexity-report` - Generate report of files/functions near limits
- [ ] Review files >400 lines (limit is 500)
- [ ] Review functions >80 statements (limit is 100) or complexity >12 (limit is 15)
- [ ] Schedule quarterly or after major features

**Trigger**: ConversationalRAGService.ts hit max-statements during beta.59 review feedback

### 🏗️ Job Idempotency Check

Add Redis-based `processed:${discordMessageId}` check in `AIJobProcessor` to prevent duplicate replies.

### 🏗️ Verify Vector Index Usage

Run `EXPLAIN ANALYZE` on production memory queries to confirm index is used.

### 🧹 Consolidate import-personality Scripts

`scripts/data/import-personality/` workspace needs cleanup.

### 🧹 Railway Ops CLI Enhancements

Low priority quality-of-life improvements leveraging Railway's `--json` output:

- [ ] `pnpm ops railway:status` - Parse `railway status --json` for nicer formatted output
- [ ] `pnpm ops railway:vars` - View variables with secret hiding and service grouping

### 🏗️ Streaming Responses

Stream LLM responses to Discord for better UX on long generations.

- [ ] Research Discord message editing rate limits
- [ ] Implement streaming from LangChain
- [ ] Chunked updates to Discord (debounced edits)

### 🧹 Free-Tier Model Strategy

Sustainable free tier for users without API keys.

- [ ] Define free-tier model allowlist
- [ ] Usage quotas for free tier
- [ ] Graceful upgrade prompts

### 🧹 Release Notifications

Notify users of new releases.

- [ ] `/changelog` command showing recent releases
- [ ] Optional announcement channel integration
- [ ] GitHub releases webhook

### Testing Debt

Service integration test gaps (use `pnpm ops test:audit --category=services`):

**ai-worker** (4 gaps):

- `ConversationalRAGService.ts` - Uses Prisma indirectly via UserReferenceResolver; comprehensive unit tests exist
- `LongTermMemoryService.ts` - Direct pendingMemory CRUD; partially covered by PgvectorMemoryAdapter.int.test.ts
- `KeyValidationService.ts` - API key validation with DB
- `RedisService.ts` - Redis operations

**api-gateway** (2 gaps):

- `AttachmentStorageService.ts` - File storage operations
- `DatabaseSyncService.ts` - Personality sync from JSON files

**bot-client** (3 gaps):

- `ReferenceEnrichmentService.ts` - Discord reference resolution
- `ReplyResolutionService.ts` - Reply chain resolution
- `VoiceTranscriptionService.ts` - Audio transcription

**common-types** (1 gap):

- `ConversationRetentionService.ts` - Conversation cleanup

_Note: PersonalityService and UserService now have .int.test.ts files (beta.59)_

### 🧹 Audit Existing Tests for Type Violations

Review all `*.test.ts` files to ensure they match their naming convention:

- [ ] Unit tests (`.test.ts`) should be fully mocked (no PGLite)
- [ ] Integration tests (`.int.test.ts`) should use PGLite
- [ ] Schema tests (`.schema.test.ts`) should only test Zod schemas
- [ ] E2E tests (`.e2e.test.ts`) should use real services
- [ ] Rename any misnamed test files to match their actual test type

---

## Icebox

_Ideas for later. Resist the shiny object._

_(Empty - all items triaged to appropriate epics)_

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
