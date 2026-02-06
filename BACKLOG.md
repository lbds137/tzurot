# Backlog

> **Last Updated**: 2026-02-05
> **Version**: v3.0.0-beta.67

Single source of truth for all work. Tech debt competes for the same time as features.

**Tags**: 🏗️ `[LIFT]` refactor/debt | ✨ `[FEAT]` feature | 🐛 `[FIX]` bug | 🧹 `[CHORE]` maintenance

---

## 🚨 Production Issues

_Active bugs observed in production. Fix before new features._

### 🐛 Free Model Error Handling (GLM/Z-AI) — PARTIALLY FIXED

**Observed**: 2026-02-03 to 2026-02-05
**Debug files**: `debug/400_*.json`, `debug/glm_4.5_air_*.json`

Provider returns 400 error but response may contain usable content. Currently treated as total failure.

**Root causes identified and fixed (on `develop`, pending deploy)**:

- [x] `frequency_penalty` causes 400 on GLM 4.5 Air (restricted param set) — **fixed**: parameter filtering in ModelFactory
- [x] `maxTokens` defaulting to 4096 instead of auto-scaling for reasoning models — **fixed**: made maxTokens optional, removed hardcoded default
- [x] Missing model detection patterns (GPT-OSS, StepFun, Hermes 4, MiMo) — **fixed**: added to reasoningModelUtils
- [x] Stop sequences sent to models that don't support them (R1-0528:free) — **fixed**: added to blocklist

**Remaining**:

- [ ] Check for extractable content before throwing on 400 (model sometimes returns valid output alongside error)
- [ ] GLM 4.5 Air empty reasoning with low `maxTokens` — model skips thinking when budget is tight (may be unavoidable)

### 🐛 Error UX Improvements (Quota + General)

**Observed**: 2026-02-03
**Debug file**: `debug/402_quota_exceeded.json`

Errors show generic messages without enough context for debugging. Users (and admins) need both human-friendly category AND technical details.

**Symptoms**:

- `nousresearch/hermes-3-llama-3.1-405b:free` returns 402 quota exceeded
- User sees generic "something went wrong" instead of "Model quota exceeded - try again later"
- No visibility into actual error code/message for debugging
- No fallback to other free models

**Fix approach - Error Display**:

- [ ] Standardize error response format: `{ category, userMessage, technicalDetails }`
- [ ] Discord embeds show category (bold) + user-friendly message
- [ ] Add collapsible/spoiler section with technical details (error code, provider message, request ID)
- [ ] Admin errors can show full technical context; user errors show sanitized version

**Fix approach - Quota Handling**:

- [ ] Detect 402 quota errors specifically
- [ ] Show user-friendly "model quota exceeded, try again in a few minutes" message
- [ ] Consider automatic fallback to alternative free model
- [ ] Track quota hits per model to avoid repeated failures

---

## 📥 Inbox

_New items go here. Triage to appropriate section weekly._

### ✨ Expose `max_tokens` in Preset Edit/Creation Flow

**Context**: Top-level `max_tokens` (output token limit) is not exposed in the Discord preset dashboard. Users can only set it by manually editing `advanced_parameters` in the DB. This became apparent when GLM 4.5 Air configs had `reasoning.max_tokens` set but no top-level `max_tokens`, causing the model to use a scaled default instead of an explicit value.

**What to add**:

- [ ] Add `max_tokens` field to preset create/edit dashboard (numeric input)
- [ ] Show current effective value (explicit, scaled from reasoning effort, or API default)
- [ ] Sensible range validation (e.g., 256–131072) with model-specific guidance
- [ ] Help text: "Maximum tokens in the response. Leave empty to auto-scale based on reasoning effort."

**Priority**: Medium — power users need this, casual users are fine with auto-scaling.

### ✨ Reasoning Param UX: Effort vs Max Tokens Mutual Exclusivity

**Context**: OpenRouter only accepts ONE of `reasoning.effort` OR `reasoning.max_tokens`, not both. Our `buildReasoningParams()` silently drops `max_tokens` when `effort` is set, but the UI doesn't communicate this. Users set both and wonder why `max_tokens` has no effect.

**What to add**:

- [ ] When `reasoning.effort` is set, disable/hide `reasoning.max_tokens` field
- [ ] Tooltip or inline help: "Effort level and token budget are mutually exclusive. Effort is recommended for most use cases."
- [ ] If both exist in saved config, show a warning badge on the reasoning section
- [ ] Consider: validation in `configValidation.ts` that warns about this conflict

**Priority**: Medium — prevents confusion for anyone configuring reasoning models.

### 🧹 Add maxAge=0 Edge Case Test

**Context**: PR #584 review noted missing test coverage for `maxAge = 0` validation.

**Current behavior is correct** (rejects 0, requires null for no limit), just needs explicit test:

```typescript
it('should reject maxAge = 0 (use null for no limit)', () => {
  const input = { name: 'Test', model: 'test-model', maxAge: 0 };
  expect(LlmConfigCreateSchema.safeParse(input).success).toBe(false);
});
```

**File**: `packages/common-types/src/types/llm-config.schema.test.ts`

### 🧹 Review structure.test.ts Exclusions

**Context**: Added meta-test to enforce test file coverage (`packages/common-types/src/structure.test.ts`). To get the test passing with existing codebase, added many exclusion patterns. Need to review whether these exclusions are appropriate or just masking untested code.

**Exclusions to audit**:

- `/factories/` - Should factory files be tested?
- `/schemas/` - Zod schemas benefit from type-level testing
- `/routes/` - Are integration tests sufficient?
- `/jobs/utils/` - Contains formatters that SHOULD have unit tests
- `Service.ts$`, `Cache.ts$` - Infrastructure singletons
- `Context.ts$` - Builder patterns
- `Base*.ts` - Base classes
- `/channelFetcher/` - Includes ReactionProcessor, SyncValidator

**Action**: Review each category and either:

1. Add dedicated unit tests for files that should have them
2. Document why the exclusion is appropriate (e.g., "tested via integration")
3. Remove exclusions for critical logic that needs direct coverage

---

## 🎯 Current Focus

_This week's active work. Max 3 items._

### 🏗️ Zod Schema Hardening - Phase 1 (CAUSES PRODUCTION BUGS)

**Recent bug**: `isForwarded` field missing from `apiConversationMessageSchema` caused forwarded messages to lose their `forwarded="true"` attribute in prompts. Data silently disappeared.

**Immediate fixes (DONE)**:

- [x] Regression test for `isForwarded` in `schemas.test.ts`
- [x] Field preservation test for `apiConversationMessageSchema`

**This week - Consolidate remaining endpoint schemas**:

- [ ] Consolidate Persona endpoint schemas (admin + user)
- [ ] Consolidate Model override endpoint schemas
- [ ] Pattern: Shared Zod schemas in common-types, scope-aware service layer

---

## ⚡️ Quick Wins

_Small tasks that can be done between major features. Good for momentum._

### ✨ Bot Health Status

Admin command showing bot health and diagnostics.

- [ ] `/admin health` - Show uptime, version, connected services
- [ ] Include: Discord connection, Redis, PostgreSQL, BullMQ queue depth
- [ ] Optional: memory usage, active personality count

### ✨ Bot Presence Setting

Allow setting the bot's status message (like user status).

- [ ] `/admin presence set <type> <message>` - Set bot presence (Playing, Watching, etc.)
- [ ] `/admin presence clear` - Clear custom presence
- [ ] Persist across restarts (store in database or env)

### ✨ Discord Emoji/Sticker Image Support

Support custom Discord emoji and stickers in vision context.

- [ ] Extract emoji URLs from message content (custom emoji format: `<:name:id>`)
- [ ] Extract sticker URLs from message stickers
- [ ] Include in vision context alongside attachments
- [ ] Handle animated emoji/stickers (GIF vs static)

### 🧹 Redis Failure Injection Tests

SessionManager has acknowledged gap in testing Redis failure scenarios. Add failure injection tests for graceful degradation verification.

### 🧹 Release Notifications

Notify users of new releases.

- [ ] `/changelog` command showing recent releases
- [ ] Optional announcement channel integration
- [ ] GitHub releases webhook

---

## 🏗 Active Epic: Zod Schema Hardening

_Focus: Prevent silent data loss from schema/interface mismatch._

**Problem areas** (consolidated from multiple backlog items):

1. **Schema/Interface Mismatch** - Zod strips fields not in schema. When we add fields to TS interfaces but forget Zod, data silently disappears.
2. **Inconsistent Validation** - Mix of manual type checks, Zod schemas, and `as Type` casting across routes.
3. **Response Inconsistency** - Same resource returns different fields from GET vs POST vs PUT.
4. **Admin/User Duplication** - Persona and Model override endpoints still have duplicate schemas (LlmConfig and Personality already consolidated in PRs #582, #583).

### Phase 1: Consolidate Remaining Endpoints (IN CURRENT FOCUS)

Pattern: Shared Zod schemas in common-types, scope-aware service layer.

### Phase 2: Compile-Time Enforcement (Option B - Pragmatic)

- [ ] Create `ZodShape<T>` utility type that maps interface keys to Zod types
- [ ] Use `satisfies ZodShape<ApiInterface>` on schemas to get compile errors for missing fields
- [ ] Challenge: Internal types (Date) differ from API types (string), need separate API interfaces

### Phase 3: Schema-First Architecture (Option A - Ideal, Longer-Term)

- [ ] Make Zod schemas the single source of truth for API types
- [ ] Derive TypeScript types using `z.infer<typeof schema>`
- [ ] Internal types with Date remain separate, conversion at boundaries
- [ ] New types should be schema-first from the start

### Phase 4: Standardize Validation (Cleanup)

- [ ] Audit: `routes/user/*.ts`, `routes/admin/*.ts`, `routes/internal/*.ts`
- [ ] Use `safeParse` consistently everywhere
- [ ] Shared response builder functions per resource type

**Reference**: MCP council recommendation (2026-02-04) - Option A is ideal, Option B is pragmatic

---

## 📅 Next Epic: Bot-Client Package Split

_Ready to start after Zod hardening. Analysis complete._

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

**References**: PR #558, `docs/reference/STATIC_ANALYSIS.md`

---

## 📦 Future Themes

_Epics ordered by dependency. Pick the next one when current epic completes._

### Theme: Memory System Overhaul

_Dependency chain: Configuration Consolidation → LTM Summarization → Table Migration → OpenMemory_

#### 1. ✨ LTM Summarization (Shapes.inc Style)

Verbatim conversation storage is redundant with extended context. Replace with LLM-generated summaries.

- [ ] Configurable grouping (5, 10, 50 messages or 1h, 4h, 24h time windows)
- [ ] Separate LLM call for summarization (fast/cheap model)
- [ ] Store summaries as LTM instead of verbatim turns

#### 2. 🏗️ Memories Table Migration

Two formats coexist (shapes.inc imports vs tzurot-v3 verbatim). Need unified format.

- [ ] Design unified memory format (draw from both sources)
- [ ] One-time migration of existing tzurot-v3 memories
- [ ] Run existing verbatim memories through summarizer

#### 3. 🏗️ OpenMemory Migration

Waypoint graph architecture with multi-sector storage.

- [ ] Design waypoint graph schema
- [ ] Migration path from current flat memories
- [ ] See `docs/proposals/backlog/OPENMEMORY_MIGRATION_PLAN.md`

#### 🏗️ Per-User Quotas

No limits on memories per persona. Add `maxMemoriesPerPersona` (default: 10,000).

#### 🏗️ Contrastive Retrieval for RAG

Improve memory retrieval quality with contrastive methods.

---

### Theme: Character Portability

_Import and export characters and user data. Users own their data._

#### ✨ User Data Export

Unified export of all user-owned data. Currently preset export and character export exist but are separate.

- [ ] `/me export` command - download all user data as JSON/ZIP
- [ ] Include: personas, presets, LLM configs, memories, conversation history
- [ ] Include: user settings, timezone, API keys (masked)
- [ ] Consider: character cards (PNG with embedded metadata) for personalities
- [ ] Privacy: only export data the user owns or has created

**Existing partial implementations**: `/preset export`, `/character export`

#### ✨ Character Card Import

Import V2/V3 character cards (PNG with embedded metadata). SillyTavern compatibility.

- [ ] Parse PNG metadata (V2 JSON in tEXt chunk, V3 in separate format)
- [ ] Map character card fields to v3 personality schema
- [ ] `/character import` support for PNG files

#### 🏗️ Shapes.inc Import

Migration path from v2. Legacy data migration.

- [ ] Parse shapes.inc backup JSON format
- [ ] Import wizard slash command (`/character import --source shapes`)
- [ ] Map shapes.inc fields to v3 personality schema
- [ ] Handle avatar migration

---

### Theme: User-Requested Features

_Features requested by actual users. High value._

#### ✨ Multi-Personality Per Channel

Allow multiple personalities active in a single channel.

- [ ] Track multiple active personalities per channel
- [ ] Natural order speaker selection (who responds next)
- [ ] Handle @mentions when multiple personalities present
- [ ] `/channel add-personality` and `/channel remove-personality` commands

#### ✨ User System Prompts

"Sidecar prompt" appended to system message per-user.

- [ ] Add `systemPrompt` field to User or UserPersonalityConfig
- [ ] `/me profile` dashboard upgrade to edit system prompt

#### ✨ Channel Allowlist/Denylist

Prevents bot from spamming unwanted channels, reduces server kicks.

- [ ] Add `mode` (allowlist/denylist) and `channels` array to ChannelSettings
- [ ] `/channel restrict` command for server admins
- [ ] Middleware check in message handler
- [ ] Consider "Ghost Mode" - bot listens but only replies when pinged

#### ✨ Multi-Character Invocation Per Message

Support tagging multiple characters in one message, each responding in order.

**Example**: `@character1 @character2 hello both` → both respond sequentially

- [ ] Modify mention extraction to return array of all valid mentions
- [ ] Combine reply target + mentions into ordered list (reply first, then mentions L→R)
- [ ] Add max limit (3-4 characters per message) to prevent abuse

#### ✨ Emoji Reaction Actions

Allow emoji reactions to trigger personality actions.

- [ ] Define action mapping (❤️ = positive feedback, 👎 = regenerate, etc.)
- [ ] Hook into reaction events (reactionAdd handler)
- [ ] Action dispatch based on emoji → action mapping

---

### Theme: Next-Gen AI Capabilities

_Future features: agentic behavior, multi-modality, advanced prompts._

#### Advanced Prompt Features

_SillyTavern-inspired prompt engineering._

- **Lorebooks / Sticky Context** - Keyword-triggered lore injection with TTL
- **Author's Note Depth Injection** - Insert notes at configurable depth in conversation
- **Dynamic Directive Injection** - Anti-sycophancy prompt techniques

#### Agentic Features

_Self-directed personality behaviors._

- **Agentic Scaffolding** - Think → Act → Observe loop
- **Dream Sequences** - Self-reflection and memory consolidation
- **Relationship Graphs** - Track relationships between users and personalities

#### Multi-Modality

_Beyond text: voice and images._

- **Voice Synthesis** - Open-source TTS/STT for voice interactions
- **Image Generation** - AI-generated images from personalities

---

### Theme: Observability & Tooling

_Backend health: monitoring, debugging, developer experience._

#### ✨ Stop Sequence Stats Admin Command

Expose stop sequence activation stats via `/admin stats stop-sequences`.

- [ ] Store stats in Redis (ai-worker writes on each activation)
- [ ] Add gateway endpoint `GET /admin/stop-sequence-stats`
- [ ] Add `/admin stats` subcommand with `stop-sequences` option

#### 🏗️ Metrics & Monitoring (Prometheus)

Production observability with metrics collection.

- [ ] Add Prometheus metrics endpoint
- [ ] Key metrics: request latency, token usage, error rates, queue depth

#### ✨ Admin Debug Filtering

Add `/admin debug recent` with personality/user/channel filters.

#### 🏗️ Database-Configurable Model Capabilities

Move hardcoded model patterns to database for admin updates without deployment.

#### 🧹 Ops CLI Command Migration

Migrate stub commands to proper TypeScript implementations.

---

### Theme: Moderation & Access Control

#### ✨ User Denylist

Block specific Discord users from using the bot entirely.

- [ ] Add `denylisted_users` table (discord_id, reason, denylisted_at, denylisted_by)
- [ ] Early-exit middleware in message handler

#### ✨ Server Denylist

Block the bot from operating in specific Discord servers.

- [ ] Add `denylisted_servers` table
- [ ] Auto-leave option when denylisted

---

## 🧊 Icebox

_Ideas for later. Resist the shiny object._

### v2 Parity (Low Priority)

_Eventually kill v2, but these are rarely used features._

- **Rate Limiting** - Token bucket rate limiting
- **PluralKit Proxy Support** - Support PluralKit proxied messages

### Infrastructure Debt (Do Opportunistically)

#### 🏗️ Reasoning/Thinking Modernization

Custom fetch wrapper, XML tag injection, multiple extraction paths. Needs stable foundation.

**Full details**: `~/.claude/plans/tender-tinkering-stonebraker.md` (Phase 4)

#### 🏗️ Streaming Responses

Stream LLM responses to Discord for better UX on long generations.

#### 🏗️ Consistent Service Prefix Injection

Auto-inject `[ServiceName]` prefix in logs instead of hardcoding.

#### 🧹 Logging Verbosity Audit

Some operations log at INFO when they should be DEBUG.

#### 🏗️ File Naming Convention Audit

Inconsistent casing between services. Low value / high effort.

#### 🏗️ Incognito Mode - Parallel API Calls

Status command fires up to 100 parallel API calls. Have API return names with sessions.

### Code Quality (Quarterly Review)

#### 🧹 Periodic Complexity/Filesize Audit

Files and functions creep toward ESLint limits. Proactive audit prevents emergency extractions.

- [ ] `pnpm ops lint:complexity-report` - Generate report of files/functions near limits
- [ ] Review files >400 lines, functions >80 statements or complexity >12

#### 🧹 Audit Existing Tests for Type Violations

Review all `*.test.ts` files to ensure they match their naming convention.

#### 🏗️ Audit and Reduce Re-exports

Re-exports create spaghetti code and obscure module dependencies.

### Tooling Polish

#### 🏗️ Type-Safe Command Options Hardening

- [ ] CI validation for `commandOptions.ts` schema-handler drift
- [ ] AST-based parsing for robustness
- [ ] Channel type refinement

#### 🧹 Consolidate import-personality Scripts

`scripts/data/import-personality/` workspace needs cleanup.

#### 🧹 Railway Ops CLI Enhancements

Low priority quality-of-life improvements.

#### ✨ Dynamic Model Selection for Presets

Fetch OpenRouter model list dynamically instead of hardcoded options.

#### 🧹 Free-Tier Model Strategy

Define free-tier model allowlist, usage quotas, upgrade prompts.

---

## ⏸️ Deferred

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
