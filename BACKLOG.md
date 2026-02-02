# Backlog

> **Last Updated**: 2026-02-01
> **Version**: v3.0.0-beta.63

Single source of truth for all work. Tech debt competes for the same time as features.

**Tags**: 🏗️ `[LIFT]` refactor/debt | ✨ `[FEAT]` feature | 🐛 `[FIX]` bug | 🧹 `[CHORE]` maintenance

---

## Inbox

_New items go here. Triage to appropriate section later._

_(Empty - triage complete)_

---

## High Priority

_Top 3-5 items to pull into CURRENT next._

### 🏗️ Bot-Client Package Split (NEXT)

**Context**: Gemini architectural review flagged bot-client as too heavy (~4.1MB, 424 files). Analysis identified extraction candidates.

**Best Extraction Candidates (in priority order):**

| Package                           | Files | Size    | Confidence                             |
| --------------------------------- | ----- | ------- | -------------------------------------- |
| `@tzurot/discord-dashboard`       | 30    | 336K    | ✅ High - self-contained UI framework  |
| `@tzurot/discord-command-context` | 6     | 56K     | ✅ Medium-High - typed context pattern |
| `@tzurot/message-references`      | 12    | ~4K LOC | ✅ Medium - BFS reference crawling     |

**Phase 1 (Quick Wins):**

- [ ] Extract `@tzurot/discord-dashboard` from `utils/dashboard/` - completely self-contained
- [ ] Extract `@tzurot/message-references` from `handlers/references/` - well-tested, strategy pattern

**Phase 2:**

- [ ] Extract `@tzurot/discord-command-context` from `utils/commandContext/`
- [ ] Consolidate `GatewayClient` into `common-types` (currently duplicated)

**Not recommended for extraction:** services/, processors/, handlers/MessageHandler.ts - too tightly coupled to message pipeline.

**Cognitive Complexity** (medium priority - refactoring):

Functions exceeding 15 cognitive complexity limit:

- ai-worker: `processMessage` (41), `generateResponse` (27), `buildSystemPrompt` (25+)
- common-types: `ConversationHistoryService` functions, `formatElapsedTime` (19)
- Run `pnpm lint 2>&1 | grep sonarjs/cognitive-complexity` for full list

**Copy-Paste Duplication** (lower priority - extract to shared utils):

- Cache invalidation service patterns (multiple files have identical subscribe/publish logic)
- Personality factory patterns (persona.ts, wallet.ts, model-override.ts share 45-line blocks)
- Settings dashboard handler (repeated embed building patterns)
- Run `pnpm cpd:report` for detailed HTML report

**Future tightening**: Once violations are reduced, lower CPD threshold from 5% to 2-3%.

**Tooling Improvements**:

- [ ] Make sonarjs rules `error` instead of `warn` - prevents new violations from accumulating
- [ ] Add CPD HTML report to CI artifacts - makes reviewing duplication easier in PRs
- [ ] Make CPD blocking in CI (remove `continue-on-error: true`)

**Documentation & Polish** (from PR #558 review):

- [ ] Add comment to `tsconfig.spec.json` files explaining test file inclusion pattern
- [ ] Document which sonarjs rules were considered and rejected in STATIC_ANALYSIS.md
- [ ] Add CPD suppression (`/* jscpd:ignore-start */`) guidance to code review checklist
- [ ] Add link from CLAUDE.md "Code Quality Limits" section to `STATIC_ANALYSIS.md`

**References**: PR #558, `docs/reference/STATIC_ANALYSIS.md`

### 🏗️ LLM Config Single Source of Truth (CRITICAL)

**Root cause of thinking/reasoning breakage in beta.60-62.** Config field definitions are scattered across 5+ files that must stay in sync manually. When `reasoning` was added, it was missed in `PersonalityDefaults.getReasoningConfig()`, causing silent data loss.

**Current duplication**:

- `LlmConfigMapper.advancedParamsToConfigFormat()` - DB JSONB → app format
- `PersonalityDefaults.get*Config()` functions - personality mapping
- `LlmConfigResolver.mergeConfig()` / `extractConfig()` - override merging
- `LLM_CONFIG_OVERRIDE_KEYS` array - list of mergeable keys
- `DiagnosticCollector.recordLlmConfig()` - diagnostic capture

**Solution**: Single source of truth (probably `LLM_CONFIG_OVERRIDE_KEYS`) driving all other code via typed iteration.

- [ ] Define canonical field list with metadata (type, default, category)
- [ ] Generate/derive all config copying from this list
- [ ] Remove manual field enumeration in PersonalityDefaults
- [ ] Add test that verifies all paths handle the same fields
- [ ] Add end-to-end integration test: DB JSONB → mapToPersonality → ModelFactory → OpenRouter API call

**Files**: `LlmConfigMapper.ts`, `PersonalityDefaults.ts`, `LlmConfigResolver.ts`, `DiagnosticCollector.ts`, `ModelFactory.ts`

### 🏗️ ConversationalRAGService Refactor

The main RAG orchestration service is a 890-line monster (limit: 500). It coordinates multiple components but has accumulated complexity that makes debugging nightmares like the thinking bug possible.

- [ ] Extract ThinkingProcessor - all thinking/reasoning extraction
- [ ] Extract PromptAssembler - system prompt + context building
- [ ] Extract MemoryManager - LTM retrieval and storage
- [ ] Extract ResponseProcessor - deduplication, stripping, placeholders
- [ ] Break down `generateResponse` method (currently 180+ lines)
- [ ] After refactor: add integration tests (currently has @audit-ignore)

**Files**: `services/ai-worker/src/services/ConversationalRAGService.ts`

### 🏗️ Large File Audit and Refactor

Multiple files exceed the 500-line limit. Each is a maintenance burden and bug hiding spot.

- [ ] Run `pnpm ops lint:large-files` to identify all violations
- [ ] Prioritize by: frequency of changes × size × complexity
- [ ] Extract helpers, split responsibilities, reduce coupling

### ✨ Multi-Personality Per Channel

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

### ✨ Multi-Character Invocation Per Message

Support tagging multiple characters in one message, each responding in order.

**Example**: `@character1 @character2 hello both` → both respond sequentially
**Example**: Reply to character1 + tag @character2 → character1 responds first, then character2

**Implementation sketch**:

- [ ] Modify mention extraction to return array of all valid mentions
- [ ] Combine reply target + mentions into ordered list (reply first, then mentions L→R)
- [ ] Add max limit (3-4 characters per message) to prevent abuse
- [ ] Sequential execution in processor (order matters for conversation flow)
- [ ] Each response logged separately to conversation history
- [ ] Error handling: continue with remaining characters if one fails

**DM consideration**: Last character becomes sticky session, but extended context still provides continuity.

**Complexity**: Medium (~1-2 days). Main challenge is refactoring processor chain from single-match to multi-match.

### ✨ Emoji Reaction Actions

Allow emoji reactions to trigger personality actions.

- [ ] Define action mapping (❤️ = positive feedback, 👎 = regenerate, etc.)
- [ ] Hook into reaction events (reactionAdd handler)
- [ ] Action dispatch based on emoji → action mapping
- [ ] Per-personality action configuration (optional)

**Note**: Builds on reaction extraction (beta.61)

---

## Epic: Character Portability

_Import and export characters and user data. Users own their data._

### ✨ User Data Export

Unified export of all user-owned data. Currently preset export and character export exist but are separate.

- [ ] `/me export` command - download all user data as JSON/ZIP
- [ ] Include: personas, presets, LLM configs, memories, conversation history
- [ ] Include: user settings, timezone, API keys (masked)
- [ ] Consider: character cards (PNG with embedded metadata) for personalities
- [ ] Privacy: only export data the user owns or has created

**Existing partial implementations**: `/preset export`, `/character export`

### ✨ Character Card Import

Import V2/V3 character cards (PNG with embedded metadata). SillyTavern compatibility.

- [ ] Parse PNG metadata (V2 JSON in tEXt chunk, V3 in separate format)
- [ ] Map character card fields to v3 personality schema
- [ ] `/character import` support for PNG files

### 🏗️ Shapes.inc Import

Migration path from v2. Legacy data migration.

- [ ] Parse shapes.inc backup JSON format
- [ ] Import wizard slash command (`/character import --source shapes`)
- [ ] Map shapes.inc fields to v3 personality schema
- [ ] Handle avatar migration

---

## Epic: v2 Parity

_Eventually kill v2, but not urgent._

### 🧹 Rate Limiting

- [ ] Token bucket rate limiting

### ✨ PluralKit Proxy Support

- [ ] Support PluralKit proxied messages

---

## Epic: Infrastructure & Stability

_Backend health: API hardening, observability, logging. Consolidated for maintenance sprints._

### API & Validation Hardening

#### 🏗️ Inconsistent Request Validation

Mix of manual type checks, Zod schemas, and `as Type` casting.

- [ ] Standardize on Zod schemas for all POST/PUT bodies
- [ ] Create `schemas/` directory, use `safeParse` consistently
- [ ] Audit: `routes/user/*.ts`, `routes/admin/*.ts`, `routes/internal/*.ts`

#### 🐛 API Response Consistency

Same resource returns different fields from GET vs POST vs PUT.

- [ ] Shared response builder functions per resource type

#### 🏗️ Zod Schema/TypeScript Interface Mismatch

Zod strips fields not in schema. When we add fields to TS interfaces but forget Zod, data disappears.

- [ ] Contract tests ensuring Zod schema keys match interface fields
- [ ] Use `.passthrough()` or `.strict()` during development
- [ ] Audit: `schemas.ts`, `jobs.ts`, route schemas

### Observability & Debugging

#### ✨ Stop Sequence Stats Admin Command

Expose stop sequence activation stats via `/admin stats stop-sequences`.

**Current state**: `StopSequenceTracker` in ai-worker tracks activations in-memory and logs to structured JSON (`json.event="stop_sequence_triggered"`). Stats accessible via `getStopSequenceStats()` but not exposed to bot-client.

**Implementation plan**:

- [ ] Store stats in Redis (ai-worker writes on each activation)
- [ ] Add gateway endpoint `GET /admin/stop-sequence-stats`
- [ ] Add `/admin stats` subcommand with `stop-sequences` option
- [ ] Display: total activations, by sequence, by model, uptime

**Files**: `StopSequenceTracker.ts`, `api-gateway/routes/admin/`, `bot-client/commands/admin/`

#### 🏗️ Basic Structured Logging

Add event types: `rate_limit_hit`, `dedup_cache_hit`, `pipeline_step_failed`, `llm_request` with latency/tokens.

#### ✨ Admin Debug Filtering

Add `/admin debug recent` with personality/user/channel filters.

#### 🏗️ Metrics & Monitoring (Prometheus)

Production observability with metrics collection.

- [ ] Add Prometheus metrics endpoint
- [ ] Key metrics: request latency, token usage, error rates, queue depth
- [ ] Grafana dashboards (or Railway's built-in metrics)

### Moderation & Access Control

#### ✨ User Denylist

Block specific Discord users from using the bot entirely.

- [ ] Add `denylisted_users` table (discord_id, reason, denylisted_at, denylisted_by)
- [ ] Early-exit middleware in message handler (before any processing)
- [ ] `/admin denylist user add <user_id> [reason]` command
- [ ] `/admin denylist user remove <user_id>` command
- [ ] `/admin denylist user list` command
- [ ] Consider: silent vs explicit rejection message

#### ✨ Server Denylist

Block the bot from operating in specific Discord servers.

- [ ] Add `denylisted_servers` table (guild_id, reason, denylisted_at, denylisted_by)
- [ ] Early-exit in message handler and interaction handler
- [ ] `/admin denylist server add <guild_id> [reason]` command
- [ ] `/admin denylist server remove <guild_id>` command
- [ ] `/admin denylist server list` command
- [ ] Consider: auto-leave server when denylisted, or just go silent

### Logging Review (Low Priority)

_High effort, low reward. Do opportunistically._

#### 🏗️ Consistent Service Prefix Injection

Currently manually hardcoding `[ServiceName]` in log messages. Should be injected automatically based on where the log originates.

- [ ] Audit current `[Service]` prefix patterns across codebase
- [ ] Design automatic prefix injection via logger factory
- [ ] Migrate existing logs to use consistent pattern
- [ ] Update `createLogger()` to auto-inject service context

**Note**: Large refactor touching most files. Only do when logging becomes a pain point.

#### 🧹 Logging Verbosity Audit

Some operations log at INFO when they should be DEBUG.

- [ ] Duplicate detection: PASSED → DEBUG, keep NEAR-MISS/DUPLICATE at INFO
- [ ] Audit other high-frequency INFO logs
- [ ] Document logging level guidelines

---

## Epic: Memory System Overhaul

_Dependency chain: Pipeline Refactor → LTM Summarization → Table Migration → OpenMemory_

### 1. ✨ LTM Summarization (Shapes.inc Style) ⛔ Blocked by Pipeline Refactor

Verbatim conversation storage is redundant with extended context. Replace with LLM-generated summaries.

- [ ] Configurable grouping (5, 10, 50 messages or 1h, 4h, 24h time windows)
- [ ] Separate LLM call for summarization (fast/cheap model)
- [ ] Store summaries as LTM instead of verbatim turns

**Depends on**: Extended Context Pipeline Refactor (Medium Priority)

### 2. 🏗️ Memories Table Migration ⛔ Blocked by LTM Summarization

Two formats coexist (shapes.inc imports vs tzurot-v3 verbatim). Need unified format.

- [ ] Design unified memory format (draw from both sources)
- [ ] One-time migration of existing tzurot-v3 memories
- [ ] Run existing verbatim memories through summarizer

### 3. 🏗️ OpenMemory Migration

Waypoint graph architecture with multi-sector storage.

- [ ] Design waypoint graph schema
- [ ] Migration path from current flat memories
- [ ] See `docs/proposals/backlog/OPENMEMORY_MIGRATION_PLAN.md`

### 🏗️ Per-User Quotas

No limits on memories per persona. Add `maxMemoriesPerPersona` (default: 10,000).

### 🏗️ Contrastive Retrieval for RAG

Improve memory retrieval quality with contrastive methods.

- [ ] Research contrastive retrieval approaches
- [ ] Prototype with current embedding system
- [ ] Benchmark against current similarity search

---

## Epic: Incognito Mode Improvements

### 🏗️ Parallel API Calls for Session Names

Status command fires up to 100 parallel API calls. Have API return names with sessions.

---

## Epic: Next-Gen AI Capabilities

_Future features: agentic behavior, multi-modality, advanced prompts._

### Advanced Prompt Features

_SillyTavern-inspired prompt engineering._

#### ✨ Lorebooks / Sticky Context

Keyword-triggered lore injection with TTL.

- [ ] Design lorebook schema (keywords, content, activation rules)
- [ ] Keyword detection in conversation context
- [ ] Inject matched lore into system prompt or context
- [ ] TTL/decay for injected content

#### ✨ Author's Note Depth Injection

Insert author's notes at configurable depth in conversation.

- [ ] Add author's note field to personality/preset config
- [ ] Configurable injection depth (N messages from end)
- [ ] Support multiple author's notes with different depths

#### 🏗️ Dynamic Directive Injection (Anti-Sycophancy)

Dynamically inject directives to improve response quality.

- [ ] Research anti-sycophancy prompt techniques
- [ ] Configurable directive templates
- [ ] A/B testing framework for directive effectiveness

### Agentic Features

_Self-directed personality behaviors._

#### 🏗️ Agentic Scaffolding

Think → Act → Observe loop for autonomous behavior.

- [ ] Design agent loop architecture
- [ ] Tool/action definitions for personalities
- [ ] Observation and reflection mechanisms
- [ ] Safety guardrails and intervention points

#### ✨ Dream Sequences

Self-reflection and memory consolidation.

- [ ] Scheduled "dream" processing (off-peak hours)
- [ ] Memory review and consolidation
- [ ] Personality growth/change over time

#### 🏗️ Relationship Graphs

Track relationships between users and personalities.

- [ ] Relationship schema (affinity, history, context)
- [ ] Relationship-aware response generation
- [ ] Visualization for users (`/me relationships`)

### Multi-Modality

_Beyond text: voice and images._

#### ✨ Voice Synthesis

Open-source TTS/STT for voice interactions.

- [ ] Research open-source TTS options (Coqui, Bark, etc.)
- [ ] Voice cloning for personality-specific voices
- [ ] Discord voice channel integration
- [ ] See `docs/research/voice-cloning-2026.md`

#### ✨ Image Generation

AI-generated images from personalities.

- [ ] Integration with image generation APIs
- [ ] Personality-specific art styles
- [ ] `/imagine` command or inline generation triggers

---

## Smaller Items

_Opportunistic work between major features._

### ✨ Discord Emoji/Sticker Image Support

Support custom Discord emoji and stickers in vision context.

- [ ] Extract emoji URLs from message content (custom emoji format: `<:name:id>`)
- [ ] Extract sticker URLs from message stickers
- [ ] Include in vision context alongside attachments
- [ ] Handle animated emoji/stickers (GIF vs static)

### ✨ Bot Presence Setting

Allow setting the bot's status message (like user status).

- [ ] `/admin presence set <type> <message>` - Set bot presence (Playing, Watching, etc.)
- [ ] `/admin presence clear` - Clear custom presence
- [ ] Persist across restarts (store in database or env)

### ✨ Bot Health Status

Admin command showing bot health and diagnostics.

- [ ] `/admin health` - Show uptime, version, connected services
- [ ] Include: Discord connection, Redis, PostgreSQL, BullMQ queue depth
- [ ] Optional: memory usage, active personality count

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

### 🧹 Redis Failure Injection Tests

SessionManager has acknowledged gap in testing Redis failure scenarios. Add failure injection tests for graceful degradation verification.

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

### 🏗️ Split Large Service Files

Several files have grown past the 500-line ESLint limit and use `eslint-disable max-lines`:

- [ ] `MessageContextBuilder.ts` (~800 lines) - Extract attachment/reference extraction to separate file
- [ ] `conversationUtils.ts` (~890 lines) - Split formatting vs retrieval
- [ ] `DiscordChannelFetcher.ts` (~600 lines) - Extract sync logic
- [ ] `GatewayClient.ts` (~560 lines) - Consider splitting cache management vs API calls

**Note**: These files work correctly, just need refactoring for maintainability.

### 🧹 Periodic Complexity/Filesize Audit

Files and functions creep toward ESLint limits over time. Proactive audit prevents emergency extractions.

- [ ] `pnpm ops lint:complexity-report` - Generate report of files/functions near limits
- [ ] Review files >400 lines (limit is 500)
- [ ] Review functions >80 statements (limit is 100) or complexity >12 (limit is 15)
- [ ] Schedule quarterly or after major features

**Trigger**: ConversationalRAGService.ts hit max-statements during beta.59 review feedback

### 🧹 Ops CLI Command Migration

Several commands in `pnpm ops` are stubs pointing to original shell/JS scripts. Migrate to proper TypeScript implementations in `packages/tooling/`.

**Priority order** (per MCP council recommendation):

1. **verify-build** (deployment) - High frequency, low risk. Good test of `execa` patterns
2. **Data scripts** - Reuse db:safe-migrate's Prisma patterns
   - [ ] `data:import` - Merge `import-personality` and `bulk-import` into single command with `--bulk` flag
   - [ ] `data:backup-personalities` - Standardize backup location
3. **Deployment** (last - high risk)
   - [ ] `deploy:dev` - Railway CLI wrapper, needs careful `stdio` handling
   - [ ] `deploy:update-gateway-url` - Rewrite with `fetch` instead of shell curl

**Migration patterns**:

- Shell scripts → Use `execa`, port Bash logic to TypeScript
- Standalone TS → Extract logic to service functions, CLI handles args

**Files**:

- Stubs: `packages/tooling/src/deployment/`, `packages/tooling/src/data/`
- Originals: `scripts/deployment/*.sh`, `scripts/data/`

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

Service integration test coverage is now tracked via `test-coverage-baseline.json` with automated Prisma detection.

**Current status**: 0 service gaps (5/5 services with Prisma have integration tests)

Run `pnpm ops test:audit --category=services` to check coverage.

_Note: Services without direct Prisma calls are auto-excluded from the audit._

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

### 🏗️ File Naming Convention Audit

Inconsistent casing between services across the monorepo:

- **PascalCase** for class-based service files (e.g., `JobTracker.ts`, `VerificationMessageCleanup.ts`)
- **camelCase** for function-based modules/utilities (e.g., `serviceRegistry.ts`)

The distinction isn't consistently applied. Calling both kinds "services" while using different casing is potentially misleading.

- [ ] Audit all services directories across packages
- [ ] Document the intended convention
- [ ] Consider renaming for consistency (or document the semantic distinction)

**Note**: Large refactor touching many files. Low value / high effort.

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
