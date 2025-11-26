# 🎯 Current Work

> Last updated: 2025-11-26

## Status: 🚀 **Database Migrations In Progress**

**Current Phase**: Phase 1 Sprint 2 - BYOK Schema Migration (Database migrations active)

**Sprint 2 Progress (2025-11-26)**:

- ✅ **Task 2.P1**: Encryption utilities (AES-256-GCM for API key storage) - 32 tests
- ✅ **Task 2.P2**: Advanced params schema (OpenRouter unified params) - 64 tests
- ✅ **Task 2.1**: Update `User` table (added `timezone`, `isSuperuser`)
- ✅ **Task 2.2**: Create `UserApiKey` table (encrypted API key storage)
- ✅ **Task 2.3**: Update `Personality` table (added errorMessage, birthday, ownerId, isPublic)
- ✅ **Task 2.4 Step A**: Update `LlmConfig` (added provider, advancedParameters, maxReferencedMessages)
- ✅ **Task 2.5**: Create `PersonalityAlias` table (alias → personality mapping)
- ✅ **Task 2.6**: Create `UsageLog` table (API usage tracking)
- All 1,783 tests passing

**🎉 ALL SCHEMA MIGRATIONS COMPLETE!** Ready for Data Migration tasks (2.7-2.10)

**Recent Completion**:

- ✅ **Sliding Window LTM Search + Message Limits + Parameterization Planning** (2025-11-25)
  - Added 3-turn conversation history window to LTM search queries
  - Solves the "pronoun problem" ("what about that?" now finds relevant memories)
  - Bumped MAX_REFERENCED_MESSAGES from 10 to 20
  - Added MESSAGE_LIMITS constant group, removed deprecated HISTORY_LIMIT
  - Added Phase 2.5 to Sprint 2 Guide: Database-configurable limits per personality
    - `maxMentionsPerMessage`, `maxChannelsPerMessage`, `maxRolesPerMessage`
    - `ltmSearchHistoryTurns`, `maxReferencedMessages`
  - All 1,687 tests passing

- ✅ **Channel/Role Mention Resolution** (2025-11-25) - PR #285
  - Added channel mention resolution (`<#channelId>` → `#channel-name`)
  - Added role mention resolution (`<@&roleId>` → `@RoleName`)
  - Implemented waterfall LTM retrieval (channel-scoped first, then global backfill)
  - Added `resolveAllMentions()` for combined user/channel/role handling
  - All 1,660 tests passing

- ✅ **v3.0.0-alpha.47 Release** (2025-11-22) - Critical bug fixes
  - Fixed Gemini censorship retry mechanism (moved check into retry loop)
  - Fixed referenced message LTM lookup (include actual content, not placeholders)
  - Added referenced message attachments to LTM search
  - Refactored text parsing to ReferencedMessageFormatter (SRP)
- ✅ **v3.0.0-alpha.40 Release** (2025-11-17) - Massive linter cleanup
  - Crushed 500+ linter errors across all services
  - Enhanced pre-commit hooks (build → lint → test)
  - LLM config parsing fixes (coerceToNumber for all numeric fields)

## 🎉 Phase 0 Complete - Milestone 0 Achieved!

**Completed Tasks (2025-11-22 to 2025-11-23)**:

- ✅ **Task 0.8**: Standardized npm scripts (consolidated test commands)
- ✅ **Task 0.8.1**: Standardized test summary command
- ✅ **Task 0.8.2**: Consolidated test commands across all services
- ✅ **Task 0.8.3**: Organized scripts directory (60+ flat scripts → 8 categorized subdirectories)
- ✅ **Task 0.9**: BullMQ Job Contract Test (15 tests - validates job payload schemas)
- ✅ **Task 0.10**: API Endpoint Contract Tests (18 tests - validates request/response schemas)
- ✅ **Task 0.11**: AIJobProcessor Component Test (6 tests with PGlite - real DB, mocked AI)
- ✅ **Task 0.12**: Verified CI/CD pipeline catches regressions (fixed CI detection bug - 95/95 integration tests passing)

**Milestone 0 Achievements**:

- ✅ Contract tests catch breaking changes at service boundaries (33 tests)
- ✅ Component tests cover critical job processing logic (6 tests with PGlite)
- ✅ CI/CD catches regressions (95/95 integration tests, 0 skipped)
- ✅ Safe to proceed with Phase 1 schema changes
- ✅ Test naming convention established (`.test.ts`, `.component.test.ts`, `tests/integration/*.test.ts`)
- ✅ Scripts organized for maintainability (8 categorized subdirectories with READMEs)

**PR Status**: #267 approved by 2 reviewers ⭐⭐⭐⭐⭐ - Ready to merge

## 🎉 Phase 1 Sprint 1 Complete!

**Completed (2025-11-24)**:

- ✅ **Task 1.1**: Tests for `LlmConfig` parsing - 25 tests already existed in `PersonalityValidator.test.ts`
- ✅ **Task 1.2**: Tests for `Personality` loading - 35+ tests already existed across loader/mention/service tests
- ✅ **Task 1.3**: Tests for `ConversationManager` - Created new: 23 tests
- ✅ **Task 1.4**: Tests for `CommandHandler` - 14 tests already existed
- ✅ **Task 1.5**: Component test for `ConversationHistoryService` - Created new: 25 tests with PGlite

**Test Suite Status**: 1,715+ tests passing (1,620 unit + 95 integration)

## Next Steps

**Phase 1, Sprint 2**: BYOK Schema Migration (7-10 sessions remaining)

**Reference**: [SPRINT_2_IMPLEMENTATION_GUIDE.md](docs/planning/SPRINT_2_IMPLEMENTATION_GUIDE.md) - Consolidated implementation guide

**Prisma 7.0 Migration** ✅ COMPLETE (2025-11-24)

**Documentation Updates** ✅ COMPLETE (2025-11-25):

- [x] Created Sprint 2 Implementation Guide (consolidated from 4 docs + Gemini consultation)
- [x] Updated ROADMAP.md with proper task ordering (per Gemini dependency analysis)
- [x] Marked Prisma 7.0 complete in PHASED_IMPLEMENTATION_PLAN.md
- [x] Reconciled QOL_MODEL_MANAGEMENT.md with ROADMAP.md sprints

**Current Sprint**: Database Migrations (Dependency Order)

- [x] **Task 2.P1**: Create encryption utilities - DONE
- [x] **Task 2.P2**: Create Zod schemas for `advancedParameters` - DONE
- [x] **Task 2.1**: Update `User` table (root dependency) - DONE
- [x] **Task 2.2**: Create `UserApiKey` table (depends on User) - DONE
- [x] **Task 2.3**: Update `Personality` table (depends on User for ownerId) - DONE
- [x] **Task 2.4**: Refactor `LlmConfig` table (Step A done, B/C deferred) - DONE
- [x] **Task 2.5**: Create `PersonalityAlias` table - DONE
- [x] **Task 2.6**: Create `UsageLog` table - DONE ✅

## Planned Features (Priority Order)

### 🛠️ 0. Foundation Stabilization ✅ **[COMPLETE]**

**Priority**: **CRITICAL** - **PREREQUISITE FOR ALL OTHER WORK**
**Status**: ✅ Complete (2025-11-24)
**Documentation**: [ROADMAP.md](ROADMAP.md) - Phase 0

**Overview**: Dependency updates + integration test coverage BEFORE major schema changes. Risk mitigation before risk-taking.

**Completed**:

- ✅ Prisma 7.0 migration (major version upgrade with breaking changes)
- ✅ Integration tests covering critical paths (95 tests with PGlite)
- ✅ Stable CI/CD pipeline (all tests pass locally and in CI)
- ✅ Self-contained test infrastructure (no external DB required)

#### Phase 0 Results

**Dependency Updates**:

- ✅ Prisma 7.0.0 (from 6.x) - driver adapter pattern, schema changes
- 6 Dependabot PRs ready to merge after `feat/dependency-upgrades-prisma-7` lands

**Integration Test Infrastructure**:

- ✅ PGlite with pgvector for in-memory Postgres testing
- ✅ Redis mock for local development
- ✅ 95 integration tests covering all critical paths
- ✅ 1,620 unit tests across all services

**Milestone**: Foundation ready for Phase 1 BYOK schema changes ✅

---

### 🚨 1. Schema Migration & BYOK Implementation **[ACTIVE]**

**Priority**: **CRITICAL** - **BLOCKS PUBLIC LAUNCH**
**Status**: In Progress - Prisma 7.0 ✅, BYOK schema next
**Documentation**: [ROADMAP.md](ROADMAP.md) - Phase 1

**Overview**: Three-phased approach to implement BYOK, migrate shapes.inc data, modernize LlmConfig, and enhance voice synthesis.

**Prerequisites**: ✅ Phase 0 complete (Prisma 7.0 migrated, integration tests in place)

#### Phase 1: BYOK + Critical Schema Migration (12-15 sessions) 🚨

**Goal**: Unblock public launch by implementing BYOK and migrating critical production data

**New Tables**:

- **UserApiKey** - AES-256-GCM encrypted API key storage
- **UsageLog** - Token usage tracking (prevent infrastructure abuse)
- **PersonalityAlias** - Unique aliases across personalities

**Table Updates**:

- **Personality** - Add `errorMessage`, `birthday` columns (migrate from `custom_fields`)
- **User** - Add `timezone` column, relationships to `apiKeys`/`usageLogs`
- **LlmConfig** - Hybrid schema refactor (JSONB for provider-specific params)
  - Supports reasoning models (Claude 3.7, OpenAI o1/o3, Gemini 3.0 Pro `thinking_level`)

**Data Migration**:

- 67 personalities in production (66 from shapes.inc + 1 new)
- Move `custom_fields.errorMessage` → `Personality.errorMessage` (66 personalities)
- Extract aliases, birthdays from shapes.inc backups

**Features**:

- `/wallet` commands (set, list, remove, test API keys)
- `/timezone` commands (set, get)
- `/usage` command (token stats)
- Hierarchical API key inheritance (user wallet → persona override)
- Log sanitization (API keys never visible)
- Encrypted at rest, ephemeral Discord responses

**Why First**: Unblocks public launch - without BYOK, random users can rack up expensive API bills on bot owner's account.

#### Phase 2: Voice Enhancements (5-7 sessions)

**Goal**: Enhance existing voice synthesis with user controls and voice cloning

**New Tables**:

- **VoiceConfig** - ElevenLabs settings per personality (stability, similarity, style, frequency)
- **VoiceConfigSample** - Voice cloning samples (10MB limit, binary storage)
- **UserPreferences** - User-level voice overrides

**Features**:

- Voice settings migration from shapes.inc (66 personalities)
- Voice sample upload (Instant Voice Cloning, 10MB max)
- User voice overrides (`/voice enable`, `disable`, `reset`)
- Hierarchical voice control (user override → personality setting)

**Why Second**: Builds on existing feature, manageable scope, not a production blocker.

#### Phase 3: Image Generation (FUTURE - ON HOLD)

**Status**: Deferred - requires agentic infrastructure (tool calls)
**Blocker**: OpenRouter only supports Gemini image models (no DALL-E/Flux/SD)

**Decision**: Wait until tool calling framework is ready, then implement image generation properly with natural language → tool selection flow.

---

### 1. LLM Model & Personality Management 🎯 **[DEFERRED]**

**Priority**: **CRITICAL** - Blocking production issues
**Status**: Planning complete, ready to implement when resumed
**Branch**: Will be `feat/qol-model-management` (off `develop`)

**Problem**: Claude Haiku gave refusal message to new user despite jailbreak, requiring manual model switch to Gemini 2.5 Flash. No easy way to manage LLM configs globally or per-user.

**Goal**: Easy model switching for users and bot owner, proper ownership model, visibility control.

**Features**:

- ✅ Schema already supports this (just needs wiring)
- Interactive slash commands for LLM config management
- User overrides for personality models
- Global vs per-user config hierarchy
- Personality ownership (bot owner = superuser, not special case)
- Public/private personality visibility

**Phases** (7-8 sessions total):

1. Database setup (add `isPublic`, `isSuperuser`, assign ownership)
2. LLM config slash commands (`/llm-config create`, list, delete)
3. Model override commands (`/model set`, reset, show)
4. Config resolution logic in ai-worker
5. Testing & polish

**Timeline**: 2-4 weeks (depending on session frequency)

**Documentation**: [docs/planning/QOL_MODEL_MANAGEMENT.md](docs/planning/QOL_MODEL_MANAGEMENT.md)

**Will Resume After This**: OpenMemory migration

---

### 2. OpenMemory Migration 🧠 **[PLANNED, DEFERRED]**

**Priority**: High - Major architecture upgrade
**Status**: Fully planned, paused for QoL improvements
**Branch**: `feat/openmemory-migration` (docs only currently)

**Goal**: Replace pgvector with sophisticated OpenMemory cognitive architecture.

**Key Features**:

- Multi-sector memory (episodic, semantic, emotional, procedural, reflective)
- Waypoint graph system with associative learning
- Hybrid scoring (60% similarity + 20% overlap + 15% waypoints + 5% recency)
- Adaptive query expansion
- Daily decay (mimics REM sleep)
- **Deterministic reflection** (no LLM censorship concerns!)

**Phases** (15-23 sessions for full vision):
1-8. Core migration (10-15 sessions) 9. Agentic features (5-8 sessions) - toolbox, "free will", memory management

**Timeline**: 6-9 weeks once resumed

**Documentation**:

- [docs/planning/OPENMEMORY_MIGRATION_PLAN.md](docs/planning/OPENMEMORY_MIGRATION_PLAN.md) - Complete migration plan
- DeepAgents design patterns documented for Phase 9

**Why Paused**: Need better tooling to manage production issues first (QoL improvements).

---

### 3. Unit Testing Infrastructure 🧪✨

**Priority**: High - Foundation for quality
**Status**: **Active Development** (Branch: `feat/unit-test-infrastructure`)

**Completed**:

- ✅ Vitest configuration (root + service-specific)
- ✅ Pragmatic mock factory pattern (after 5.5hr journey through 4 iterations)
- ✅ Discord.js mock factories (User, Guild, Channel, Message, etc.)
- ✅ Tests for personalityMentionParser (22 tests passing)
- ✅ Tests for discordContext utilities (17 tests passing)
- ✅ Comprehensive lessons learned documentation
- ✅ Gemini MCP consultation integration

**Architecture Highlights**:

- Co-located tests (`.test.ts` next to source)
- **Pragmatic factory pattern**: Type-safe without over-engineering
  - `Partial<T>` for overrides
  - Plain arrow functions for non-spied methods
  - Strategic `@ts-expect-error` for type predicates
  - `as unknown as T` final assertion (tests are ground truth)
- Built-in fake timers (Vitest)
- No `as any` - TypeScript discipline enforced
- 39 tests passing, TypeScript build clean

**Key Learning**:
After attempting vitest-mock-extended, Mockable<T>, and complex MockData<T> patterns, we landed on a pragmatic approach that prioritizes runtime correctness over compile-time perfection. See `docs/architecture/TESTING_LESSONS_LEARNED.md` for the full 5.5-hour journey.

**Key Files**:

- `services/bot-client/src/test/mocks/Discord.mock.ts` - Core mock factories
- `services/bot-client/src/test/types.ts` - Utility types
- `docs/architecture/TESTING_LESSONS_LEARNED.md` - Comprehensive post-mortem

**Next Targets** (prioritized by complexity):

1. **ConversationManager** (158 lines) - Focused service, no external deps
2. **CommandHandler** (149 lines) - Slash command routing
3. **WebhookManager** (249 lines) - Discord webhook management
4. **MessageHandler** (468 lines) - May need refactoring before testing
5. Integration test patterns

**Files Needing Tests**:

- ✅ `utils/personalityMentionParser.ts` - Done
- ✅ `utils/discordContext.ts` - Done
- 🎯 `memory/ConversationManager.ts` - Next up (158 lines)
- ⏳ `handlers/CommandHandler.ts` - (149 lines)
- ⏳ `webhooks/WebhookManager.ts` - (249 lines)
- ⚠️ `handlers/MessageHandler.ts` - **May need refactoring first** (468 lines - large file that should be broken up before testing to avoid throwaway tests)
- ⏳ `utils/deployCommands.ts` - (102 lines)
- ⏳ `gateway/GatewayClient.ts` - (173 lines)

---

### 2. Transcription Cleanup Feature 🎤

**Priority**: Medium - Quality of life improvement
**Status**: Needs architectural planning

**Goal**: LLM post-processing for Whisper transcriptions

**Problem**: Whisper transcriptions lack punctuation, making them hard to read.

**Solution**: Add second LLM pass to clean up transcriptions:

- Add punctuation
- Add formatting
- Add paragraphs for long messages
- **Don't change underlying content** (just formatting)

**Technical Approach**:

- Use cheaper model (Claude Haiku suggested)
- New service or utility in ai-worker
- Consider making it optional (config flag?)

**Open Questions**:

- Should this be opt-in or default?
- How to handle cost (already transcribing + LLM response, now adding cleanup LLM too)?
- Should cleanup be cached with the transcript?

---

### 3. ✅ Message Reference System 🔗 **[COMPLETED]**

**Status**: Implemented and working in production

**What It Does**:

- Extracts content from replied-to messages
- Parses Discord message links and fetches referenced messages
- Creates default personas for referenced message authors
- Adds referenced messages as separate prompt section
- Full embed extraction with all fields
- Replaces message links with numbered references

**Implementation**:

- `services/bot-client/src/handlers/MessageReferenceExtractor.ts` - Main extraction logic
- `services/bot-client/src/services/ReferenceEnrichmentService.ts` - Enrichment service
- `services/bot-client/src/services/ReplyResolutionService.ts` - Reply handling
- `services/bot-client/src/utils/referenceFormatter.ts` - Formatting utilities
- Comprehensive test coverage in `MessageReferenceExtractor.test.ts`

---

### 4. PluralKit Proxy Support 🎭

**Priority**: Medium - Quality of life for many users
**Status**: Requires implementation (not working correctly now)

**Goal**: Detect PluralKit proxies and link system member personas to the original Discord user

**Context**: PluralKit is a popular Discord bot that allows users with DID/OSDD or similar to have multiple "system members" speaking through proxied webhook messages. When a user sends a message with a PluralKit trigger, PluralKit:

1. Deletes the original message
2. Creates a webhook message with the system member's name/avatar
3. This happens within 1-3 seconds

**Current Behavior** (BROKEN):

- We respond to the original message before PluralKit proxies it
- We don't wait to see if it gets proxied
- Webhook messages create personas but they're not linked to the original user
- No correlation between webhook personas and Discord user IDs

**Correct Behavior** (what we need):

- See the original message, track it
- Wait 2-3 seconds (already in place from Message References!)
- If message gets deleted AND webhook appears → PK proxy detected
- Correlate webhook message to original Discord user
- Create/use persona for "User ID + PK member name"
- Process the **webhook message**, not the original
- One Discord user can have multiple personas:
  - Default persona (when not using PK)
  - "Alice" persona (PK member 1)
  - "Bob" persona (PK member 2)
  - etc.

**Technical Approach**:

- **Message deletion tracking**: Watch for deletions within 3s of send
- **Webhook correlation**: Match webhook message to deleted message by content/channel/timing
- **User association cache**: Map webhook message → original Discord user ID
- **Persona management**: Store `(userId, memberName)` → persona mapping
- **Process webhook message**: Use the webhook message content, not original

**Implementation Needs**:

- New service: `PluralKitDetector`
- Message deletion event handler
- Temporary message store (content, user, channel, timestamp)
- Webhook correlation algorithm (content similarity + timing)
- User-to-webhook mapping cache
- Persona lookup by `(userId, memberName)` instead of just `userId`

**v2 Reference** (patterns to extract, not copy):

- `src/utils/pluralkitMessageStore.js` - Deletion tracking pattern
- `src/utils/webhookUserTracker.js` - User association pattern
- `src/handlers/referenceHandler.js` - Correlation logic pattern

**Benefits of Implementing After Message References**:

- The 2-3s delay is already implemented
- Message refetch logic already in place
- Infrastructure for tracking and correlation is similar
- Can reuse patterns from reference extraction

---

### 5. Multi-Personality Response Feature 🎭

**Priority**: Low - New feature, not v2 parity
**Status**: Concept phase

**Goal**: Support multiple personalities responding to a single message

**Example**: `@Lilith @Sarcastic hey both of you` → Both Lilith and Sarcastic respond

**Technical Challenges**:

- `findPersonalityMention()` needs to return array of personalities (not just one)
- MessageHandler creates multiple jobs (one per personality)
- Each personality needs context: "who else was tagged?"
- Conversation history tracking gets complex
- Response ordering/timing considerations

**Open Questions**:

- Do we track "Lilith and Sarcastic were both tagged" in conversation history?
- How do we handle if one personality's job fails but another succeeds?
- Should personalities be aware of each other's responses in real-time?
- Database schema changes needed?

---

## v3 Current State

**Deployment**: Railway development environment (private testing)

- Branch: `develop`
- Status: Stable and operational
- **NOT PUBLIC**: No BYOK yet, all API costs on owner

### ✅ Features Working

- @personality mentions (@lilith, @default, @sarcastic)
- Reply detection (reply to bot messages)
- **Message references** ✅ (Discord message links + reply context)
- Webhook management (unique avatar/name per personality)
- Message chunking (2000 char Discord limit)
- Conversation history tracking
- Long-term memory via pgvector
- Image attachment support
- **Voice transcription support** ✅ (fixed in alpha.39)
- Model indicator in responses
- Persistent typing indicators
- **Slash commands** ✅ (admin, personality create/edit/import, utility)
- **CI/CD pipeline** ✅ (re-enabled 2025-11-16)

### 📋 Not Yet Ported from v2

- Auto-response (activated channels)
- Full slash command system
- Rate limiting
- NSFW verification
- Request deduplication

### 🚧 Blockers for Public Launch

**See**: [Phase 1 - BYOK + Critical Schema Migration](#-0-schema-migration--byok-implementation-active-planning)

**Critical**:

- **BYOK (Bring Your Own Key)**: Users provide own API keys → **Phase 1 addresses this**
- ~~**Admin Commands**: Server management for bot owner~~ → **Slash commands already exist** (alpha.40+)

---

## Quick Links

### 🎯 Master Roadmap

- **[ROADMAP.md](ROADMAP.md)** - **THE SOURCE OF TRUTH**: Consolidated backlog, priorities, timeline

### Planning Docs (Details)

- [docs/planning/PHASED_IMPLEMENTATION_PLAN.md](docs/planning/PHASED_IMPLEMENTATION_PLAN.md) - BYOK Phase 1-3 details
- [docs/planning/schema-improvements-proposal.md](docs/planning/schema-improvements-proposal.md) - Detailed schema changes for Phase 1
- [docs/planning/QOL_MODEL_MANAGEMENT.md](docs/planning/QOL_MODEL_MANAGEMENT.md) - LLM config management (integrated into ROADMAP.md Sprint 2-3)
- [docs/planning/OPENMEMORY_MIGRATION_PLAN.md](docs/planning/OPENMEMORY_MIGRATION_PLAN.md) - OpenMemory details (ROADMAP.md Sprint 7-8)
- [docs/planning/V2_FEATURE_TRACKING.md](docs/planning/V2_FEATURE_TRACKING.md) - V2 feature parity (ROADMAP.md Sprint 6)

### Architecture

- [docs/architecture/llm-hyperparameters-research.md](docs/architecture/llm-hyperparameters-research.md) - Advanced LLM parameters research (validated)
- [docs/architecture/ARCHITECTURE_DECISIONS.md](docs/architecture/ARCHITECTURE_DECISIONS.md) - Why v3 is designed this way
- [docs/deployment/RAILWAY_DEPLOYMENT.md](docs/deployment/RAILWAY_DEPLOYMENT.md) - Railway deployment guide

### Development

- [docs/guides/DEVELOPMENT.md](docs/guides/DEVELOPMENT.md) - Local development setup
- [CLAUDE.md](CLAUDE.md) - AI assistant rules and project context

---

_This file reflects current focus and planned work. Updated when switching context._
