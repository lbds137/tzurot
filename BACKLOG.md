# Backlog

> **Last Updated**: 2026-02-19
> **Version**: v3.0.0-beta.80

Single source of truth for all work. Tech debt competes for the same time as features.

**Tags**: 🏗️ `[LIFT]` refactor/debt | ✨ `[FEAT]` feature | 🐛 `[FIX]` bug | 🧹 `[CHORE]` maintenance

---

## 🚨 Production Issues

_Active bugs observed in production. Fix before new features._

_None currently._

---

## 📥 Inbox

_New items go here. Triage to appropriate section weekly._

### 🏗️ [LIFT] Investigate Safe Auto-Migration on Railway

Prisma migrations are currently manual post-deploy (`pnpm ops db:migrate --env dev/prod`). This caused a P2002 bug when a migration was deployed as code but never applied. Investigate options:

- Dev-only auto-migration in the Railway start command
- Pre-deploy hook with `prisma migrate deploy`
- Dry-run check in prod with approval gate
- CI step that validates migration state matches schema

### 🐛 [FIX] `memory_only` Import Ownership Gap (Strategy 2)

Partially fixed in beta.80 — `ShapesImportResolver` now tries raw slug (strategy 2) and shapesId UUID (strategy 3) as fallbacks. However, strategy 2 matches any personality with that slug regardless of owner. A non-bot-owner could theoretically import memories into another non-bot-owner's personality if slugs collide. Add an ownership check to strategy 2 (same guard as `resolveForFullImport`).

### 🐛 GLM 4.5 Air Unclosed `<think>` Tag

GLM 4.5 Air (`z-ai/glm-4.5-air:free`) uses `<think>` as creative roleplay formatting without a closing tag. The `UNCLOSED_TAG_PATTERN` in `thinkingExtraction.ts` captures all content as thinking, leaving `visibleContent` empty. Combined with provider 400 errors, responses fail completely.

**Debug file**: `debug/debug-compact-cc13fc44-0eeb-43e2-a881-a78e8cdafda0.json`

**Fix options**:

- Allowlist models that support thinking (only extract from known reasoning models)
- Require both open AND close tags for extraction (stricter pattern)
- Fallback: if thinking extraction leaves visible content empty, use thinking as content

---

## 🎯 Current Focus

_This week's active work. Max 3 items._

_Empty — both items completed. Pull next from Quick Wins or Active Epic._

**Recently completed:**

- ~~✨ Admin Commands Bundle~~ (`/admin stop-sequences`, `/admin health`, `/admin presence`, depcruise graduation)
- ~~✨ Incognito `/character chat` Poke~~ (weigh-in mode, PRs #633+)
- ~~✨ Reply-to Context in Prompting~~ (PRs #636, #637)
- ~~🏗️ Quick Wins Cleanup~~ (Config Cascade drop column, Denylist hardening + `/deny view`, Redis failure tests)

---

## ⚡️ Quick Wins

_Small tasks that can be done between major features. Good for momentum._

### ✨ Discord Emoji/Sticker Image Support

Support custom Discord emoji and stickers in vision context.

- [ ] Extract emoji URLs from message content (custom emoji format: `<:name:id>`)
- [ ] Extract sticker URLs from message stickers
- [ ] Include in vision context alongside attachments
- [ ] Handle animated emoji/stickers (GIF vs static)

### ✨ Free Model Quota Resilience

Automatic fallback to alternative free model on 402 quota errors. Track quota hits per model to avoid repeated failures. Foundation shipped in PR #587.

### 🏗️ Slash Command UX Audit

Full audit of all slash command UI patterns. Review shared utilities usage, identify gaps/inconsistencies, standardize patterns.

- [ ] Audit browse/pagination: which commands use shared `utils/browse/` vs rolling their own?
- [ ] Audit dashboard pattern: which commands use `utils/dashboard/` vs custom embeds?
- [ ] Audit response patterns: ephemeral vs public consistency, error message formatting
- [ ] Audit empty-state handling: how does each command handle zero results?
- [ ] Audit button/select menu patterns: consistent ordering, emoji usage, customId prefixes
- [ ] Identify commands that could benefit from richer UI (e.g., `/admin presence` → dashboard)
- [ ] Document findings and create standardization tasks

---

## 🏗 Active Epic: Package Extraction

_Focus: Reduce common-types export bloat and split bot-client, the largest package._

**Codebase snapshot (2026-02-12)**: 108K hand-written production LOC + 45K Prisma-generated.

| Package      | Files | LOC | Exports | Status                                                                              |
| ------------ | ----- | --- | ------- | ----------------------------------------------------------------------------------- |
| bot-client   | 254   | 46K | 767     | **Outlier** — nearly half the codebase, primary extraction target                   |
| ai-worker    | 105   | 19K | —       | Healthy                                                                             |
| api-gateway  | 104   | 17K | —       | Healthy                                                                             |
| common-types | 99    | 16K | 607     | LOC is fine (45K "bloat" was Prisma-generated); **607 exports** is the real problem |
| tooling      | 61    | 9K  | —       | Fine                                                                                |

**Key insight**: common-types LOC is reasonable at 16K — the 61K number includes 45K of Prisma-generated code. The problem is the 607 exports (12x the 50-export threshold), not the size.

### Phase 1: Assessment

- [ ] Reassess common-types export count — categorize exports by domain to identify extraction boundaries
- [ ] Profile bot-client's 46K lines — which subdirectories are self-contained?
- [ ] Reference: PR #558 analysis

### Phase 2: Extraction

- [ ] Candidates: `@tzurot/discord-dashboard` (30 files, self-contained), `@tzurot/message-references` (12 files), `@tzurot/discord-command-context` (6 files)
- [ ] Re-evaluate whether common-types needs splitting or just export pruning

**Previous work**: Architecture Health epic (PRs #593–#597) completed dead code purge, oversized file splits, 400-line max-lines limit, and circular dependency resolution (54→25, all remaining are generated Prisma code).

---

## 📅 Next Epic: _TBD — select from Future Themes when Package Extraction completes_

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

- [ ] `/persona export` command - download all user data as JSON/ZIP
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

#### ✨ Shapes.inc Import (Implemented)

Full automated import from shapes.inc via `/shapes` command group. Shipped on develop.

- [x] Phase 1: Schema (UserCredential, ImportJob tables + `type` column on memories) + `/shapes auth|logout`
- [x] Phase 2: Data fetcher service (TypeScript, split cookie handling, username lookup, memory pagination)
- [x] Phase 3: Import pipeline (BullMQ job → personality + system prompt + LLM config + pgvector memories)
- [x] Phase 4: `/shapes browse|import|export|status` slash commands (UX overhaul: detail view, autocomplete, retry logic — PR #662)
- [ ] Phase 5 (backlogged): Sidecar prompt injection — data preserved in customFields, proper system-prompt injection is "User System Prompts" feature
- [ ] Phase 6 (backlogged): Voice/image field import — shapes.inc has `voice_model`, `voice_id`, `voice_stability`, `image_jailbreak`, `image_size` etc. Currently set `voiceEnabled: false`, `imageEnabled: false`. Import when Tzurot adds voice/image support.
- [ ] Phase 7 (backlogged): Training data import — shapes.inc has training pairs (see `debug/shapes/lilith-training.json`). Tzurot has no training data schema yet. Needs: define training data schema → import from shapes.inc.

---

### Theme: User-Requested Features

_Features requested by actual users. High value._

#### ✨ Multi-Personality Per Channel

Allow multiple personalities active in a single channel.

- [ ] Track multiple active personalities per channel
- [ ] Natural order speaker selection (who responds next)
- [ ] Handle @mentions when multiple personalities present
- [ ] `/channel add-personality` and `/channel remove-personality` commands

#### ✨ User System Prompts (Sidecar Prompts)

Per-user text injected into the system message, shaping how characters interact with that specific user. Shapes.inc calls this "user personalization" — a freeform backstory (~3KB) the user writes about themselves per character. During shapes.inc import, this data is preserved in `customFields.sidecarPrompt` JSONB.

- [ ] Add `sidecarPrompt` field to `UserPersonalityConfig` (per-user-per-character) or `User` (global)
- [ ] Prompt assembly: inject sidecar text into system message (after character profile, before conversation)
- [ ] `/persona` dashboard upgrade to edit sidecar prompt
- [ ] Migration: move shapes.inc imported `customFields.sidecarPrompt` to proper field

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

### Theme: CPD Clone Reduction

_Focus: Reduce 149 code clones to <100. Extract shared patterns into reusable utilities._

High-value extractions done (PR #599). Remaining 149 clones (~1.93%) are structural duplication across service boundaries.

#### Phase 1: Shared Utilities

- [ ] Factory files: 5+ clones of `DeepPartial`/`deepMerge` — extract shared helper to common-types
- [ ] `dateFormatting.ts`: 4 clones of similar date formatting logic — consolidate
- [ ] Redis setup: IORedis config duplication across services — extract factory

#### Phase 2: Bot-Client Patterns

- [ ] Subcommand routers: 3 near-identical implementations — unify or extract base
- [ ] Pagination/browse builders: duplicated page calculation, sort toggle, button construction
- [ ] Error handling: repeated replied/deferred check + followUp/reply pattern in CommandHandler
- [ ] Custom ID parsing: duplicated page/sort extraction logic

#### Phase 3: API Gateway / AI Worker

- [ ] Personality routes: duplicate Prisma select objects, permission checks — extract route helpers
- [ ] Dashboard handlers: session/ownership boilerplate — may already have shared utils
- [ ] Avatar operations: duplicated file deletion and glob-based cleanup

**Target**: <100 clones or <1.5%. Currently 149 clones, ~1.93%.

---

### Theme: Logging & Error Observability

_Comprehensive audit of logging quality, error serialization, and log hygiene across the stack._

#### 🐛 Error Serialization Audit

During the GLM-5 empty response investigation, `err` serialized as `{_nonErrorObject: true, raw: "{}"}` despite being a real `Error`. Makes logs nearly useless for debugging provider issues.

- [ ] Audit LangChain throwing non-Error objects that look like Errors
- [ ] Audit Node `undici` fetch errors — `TypeError` from `fetch()` serializes as `raw: "{}"` in Pino (non-enumerable properties). Seen in `GatewayClient.submitJob()` and `PersonalityMessageHandler` on Railway dev (2026-02-15)
- [ ] Review `normalizeErrorForLogging()` in `retry.ts` wrapping behavior
- [ ] Review `determineErrorType()` in `logger.ts` checking `constructor.name`
- [ ] Codebase-wide scan for `{ err: ... }` patterns that produce useless output
- [ ] Goal: every `{ err: ... }` log shows message + stack, never `raw: "{}"`

#### 🧹 Logging Verbosity Audit

Some operations log at INFO when they should be DEBUG. Noisy logs obscure real issues in production.

- [ ] Audit all `logger.info()` calls — demote routine operations to DEBUG
- [ ] Ensure ERROR/WARN are reserved for actionable items
- [ ] Review hot paths (message processing, cache lookups) for excessive logging

#### 🏗️ Consistent Service Prefix Injection

Auto-inject `[ServiceName]` prefix in logs instead of hardcoding in every log call.

- [ ] Extend Pino logger factory to auto-add service name prefix
- [ ] Remove manual `[ServiceName]` prefixes from log messages
- [ ] Consider structured `service` field instead of string prefix

#### ✨ Admin/User Error Context Differentiation

Admin errors should show full technical context; user errors show sanitized version. Partially done in PR #587 (error display framework shipped), this is the remaining differentiation.

- [ ] Admin error responses include stack traces and internal context
- [ ] User-facing errors show friendly messages without internals

---

### Theme: Observability & Tooling

_Backend health: monitoring, debugging, developer experience._

#### 🏗️ Metrics & Monitoring (Prometheus)

Production observability with metrics collection.

- [ ] Add Prometheus metrics endpoint
- [ ] Key metrics: request latency, token usage, error rates, queue depth

#### 🏗️ Database-Configurable Model Capabilities

Move hardcoded model patterns to database for admin updates without deployment.

#### 🏗️ Graduate Warnings to Errors (CI Strictness Ratchet)

Pre-push hook runs CPD and depcruise in warning-only mode (non-blocking). ESLint has warnings for complexity/statements that don't block CI. As we hit targets, tighten the ratchet:

- [x] **depcruise**: Already blocking in pre-push hook (`.husky/pre-push` line 129-135). Done.
- [ ] **CPD**: Currently non-blocking in pre-push. Once under target (<100 clones), add threshold check that blocks push
- [ ] **ESLint warnings**: `max-statements`, `complexity`, `max-lines-per-function` are warn-level. Audit current violation count, set a baseline, block new violations
- [ ] **Knip**: Dead code detection runs manually. Add to pre-push or CI as blocking check

Goal: every quality check that currently warns should eventually block, with a clear baseline so new violations are caught immediately.

#### 🏗️ Schema-Type Unification (Zod `z.infer`)

Adopt `z.infer<typeof schema>` across all job types to eliminate manual interface/schema sync. Currently each job type has both a Zod schema and a hand-written TypeScript interface that must be kept in sync manually.

- [ ] Replace `ShapesImportJobData` / `ShapesImportJobResult` interfaces with `z.infer<>` derivations
- [ ] Do the same for `AudioTranscriptionJobData`, `ImageDescriptionJobData`, `LLMGenerationJobData`
- [ ] Consider discriminated unions for success/failure result types (compile-time enforcement that `personalityId` is required on success, `error` is required on failure)
- [ ] Audit all Zod schemas in common-types for interface/schema drift

**Context**: PR #651 added Zod schemas for shapes import jobs and an enforcement test that catches missing schemas. This follow-up eliminates the remaining duplication.

#### 🧹 Ops CLI Command Migration

Migrate stub commands to proper TypeScript implementations.

---

## 🧊 Icebox

_Ideas for later. Resist the shiny object._

### v2 Parity (Low Priority)

_Eventually kill v2, but these are rarely used features._

- **Personality Aliases** - User-managed alternative names for personalities. v2 had: multi-word aliases (1-4 words, longest-match priority), smart collision handling (append name parts, then random suffix), auto-alias creation from display names, and alias reassignment between personalities. Single-level indirection only (alias → personality ID, no chains). v3 already has `PersonalityAlias` model in schema.
- **Rate Limiting** - Token bucket rate limiting
- **PluralKit Proxy Support** - Support PluralKit proxied messages

### Infrastructure Debt (Do Opportunistically)

#### 🏗️ Reasoning/Thinking Modernization

Partially done: migrated from `include_reasoning` to modern `reasoning` param via `modelKwargs`. But the custom fetch wrapper in `ModelFactory.ts` that intercepts raw OpenRouter HTTP responses and injects `<reasoning>` tags is still fragile — LangChain's Chat Completions converter silently drops `reasoning` fields, so we intercept before it parses. Needs a cleaner approach (e.g., native Responses API support from OpenRouter, or a LangChain plugin).

**Full details**: `~/.claude/plans/tender-tinkering-stonebraker.md` (Phase 4)

#### 🏗️ Prompt Caching (Anthropic)

Add `cache_control` breakpoints to static prompt sections (character profile, response protocol) for Anthropic models via OpenRouter. Deferred Phase 4 from the XML prompt restructure.

#### 🏗️ Streaming Responses

Stream LLM responses to Discord for better UX on long generations.

#### 🏗️ File Naming Convention Audit

Inconsistent casing between services. Low value / high effort.

#### 🏗️ Incognito Mode - Parallel API Calls

Status command fires up to 100 parallel API calls. Have API return names with sessions.

### Code Quality

#### 🧹 Audit Existing Tests for Type Violations

Review all `*.test.ts` files to ensure they match their naming convention.

### Nice-to-Have Features

- **Release Notifications** - `/changelog` command, announcement channel, GitHub webhook
- **Remove Dashboard Close Button** - Redundant with Discord's native "Dismiss Message" on ephemeral messages. Sessions auto-expire via Redis TTL (15 min) anyway.
- **Align Preset Browse UX with Character Browse** - Characters group by owner with clear section headers and consistent emoji badges (from the Emoji Standardization epic). Presets still use a flat list with ad-hoc badging. Needs: owner grouping, standardized emoji badges, consistent legend formatting.

### Tooling Polish

#### 🏗️ Type-Safe Command Options Hardening

- [ ] CI validation for `commandOptions.ts` schema-handler drift
- [ ] AST-based parsing for robustness
- [ ] Channel type refinement

#### 🧹 Railway Ops CLI Enhancements

Low priority quality-of-life improvements.

#### ✨ Dynamic Model Selection for Presets

Fetch OpenRouter model list dynamically instead of hardcoded options.

#### 🧹 Free-Tier Model Strategy

Define free-tier model allowlist, usage quotas, upgrade prompts.

---

## ⏸️ Deferred

_Decided not to do yet._

| Item                                        | Why                                                                                                                                          |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema versioning for BullMQ jobs           | No breaking changes yet                                                                                                                      |
| Contract tests for HTTP API                 | Single consumer, integration tests sufficient                                                                                                |
| Redis pipelining                            | Fast enough at current traffic                                                                                                               |
| BYOK `lastUsedAt` tracking                  | Nice-to-have, not breaking                                                                                                                   |
| Handler factory generator                   | Add when creating many new routes                                                                                                            |
| Scaling preparation (timers)                | Single-instance sufficient for now                                                                                                           |
| Vision failure JIT repair                   | Negative cache now skipped during retries (PR #617); TTL expiry handles cross-request dedup                                                  |
| GLM 4.5 Air empty reasoning                 | Fixed in v3.0.0-beta.73 — reasoning-only responses now used as content                                                                       |
| Denylist batch cache invalidation           | Single pubsub messages handle current scale; premature optimization for bulk ops that rarely happen                                          |
| Deny detail view DashboardBuilder migration | Action-oriented UI (toggle/edit/delete) doesn't fit multi-section edit dashboard pattern; already uses SessionManager and DASHBOARD_MESSAGES |
| Thread config cascade for threads           | Fixed in beta.80 — threads inherit parent activation but explicit deactivation is respected                                                  |

---

## References

- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full release history
- [docs/proposals/backlog/OPENMEMORY_MIGRATION_PLAN.md](docs/proposals/backlog/OPENMEMORY_MIGRATION_PLAN.md)
- Shapes.inc import: Phases 1-4 complete on develop (see Character Portability theme)
- [docs/research/sillytavern-features.md](docs/research/sillytavern-features.md)
- [docs/research/voice-cloning-2026.md](docs/research/voice-cloning-2026.md)
