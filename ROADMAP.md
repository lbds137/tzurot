# Tzurot v3 Master Roadmap

> **Last Updated**: 2025-11-22
> **Philosophy**: Launch, Stabilize, Evolve
> **Context**: Solo dev + AI, must avoid decision fatigue and context switching

## 🧠 Current Context

- **Status**: Alpha (Private testing on Railway)
- **Deployment**: 67 personalities, stable and operational
- **Blocker**: BYOK (Risk of expensive API bills prevents public invites)
- **Constraint**: Solo dev workflow - prioritize focus over feature count

## 🎯 The Strategy: "Launch, Stabilize, Evolve"

**Gemini's Hard Truth**: You must put sophisticated cognitive architecture (OpenMemory) in a box until you have a sustainable billing model. Build the **Wallet** (BYOK) first, then build the **Brain** (OpenMemory).

**Prioritization Order**:
1. **Business Value** (unblock launch)
2. **Risk Mitigation** (prevent production fires)
3. **Innovation** (advanced features)

---

## 🛠️ Phase 0: "Foundation" - Stabilize Before Building

**Goal**: ~~Update dependencies,~~ establish integration test coverage ~~, and stabilize foundation before major schema changes~~.

**Why First**: Cannot safely refactor database schema or add complex features without ~~stable dependencies and~~ integration tests. Risk mitigation before risk-taking.

**CRITICAL FINDING (2025-11-22)**: All 6 Dependabot PRs blocked by Prisma 7.0 migration. **Deferred to Phase 1** (consolidate with schema changes).

**Revised Estimated Timeline**: 2-3 sessions (focus on integration tests only)

### Sprint 0: ~~Dependency Updates &~~ Integration Test Coverage (2-3 sessions)

**Dependabot PRs** ~~to Review & Merge~~ **DEFERRED TO PHASE 1** (6 PRs from Nov 19-21):
- [x] ~~**Task 0.1**: Review PR #262~~ - **BLOCKED**: Contains Prisma 7.0 (requires schema migration)
- [x] ~~**Task 0.2**: Review PR #261~~ - **BLOCKED**: Contains Prisma 7.0
- [x] ~~**Task 0.3**: Review PR #255~~ - **BLOCKED**: Contains Prisma 7.0 + uuid 11→13
- [x] ~~**Task 0.4**: Review PR #254~~ - **BLOCKED**: Contains Prisma 7.0
- [x] ~~**Task 0.5**: Review PR #252~~ - **BLOCKED**: Contains Prisma 7.0
- [x] ~~**Task 0.6**: Review PR #251~~ - **BLOCKED**: Outdated (created before alpha.47)

**Decision**: Integrate Prisma 7.0 into Phase 1 Sprint 2 (already doing schema changes). Dependency updates will happen AFTER Prisma migration.

**Integration Test Coverage** (Safety Net):
- [x] **Task 0.7**: Inventory critical paths lacking integration tests ✅
  - Created: docs/planning/INTEGRATION_TEST_PLAN.md
  - Finding: 80 component tests exist, 0 contract tests, 0 live dependency tests
  - **Revised Strategy**: Focus on contract tests (realistic), defer live dependency tests

**Contract Tests** (Priority 1 - catches breaking changes at service boundaries):
- [ ] **Task 0.8**: BullMQ Job Contract Test 🚨 CRITICAL
  - Verify: api-gateway job creation matches ai-worker consumption
  - Verify: Shared Zod schema for job payload
  - **Catches**: Breaking changes during Phase 1 schema refactor
  - Estimated: 0.5 session
- [ ] **Task 0.9**: API Endpoint Contract Tests
  - Verify: `/ai/generate`, `/ai/confirmDelivery`, `/ai/jobStatus` schemas
  - **Catches**: Breaking changes in API contracts
  - Estimated: 0.5 session

**Component Tests** (Priority 2 - single service with real DB/Redis):
- [ ] **Task 0.10**: AIJobProcessor Component Test
  - Test job processing logic with mocked AI provider
  - Real: Prisma DB, conversation history
  - Estimated: 1 session
- [ ] **Task 0.11**: Verify CI/CD pipeline catches regressions
  - All tests must pass before merge
  - Build succeeds for all services

**🎉 MILESTONE 0: Stable Foundation**
- ~~All dependencies up to date~~ **DEFERRED** (Prisma 7.0 in Phase 1)
- Contract tests catch breaking changes at service boundaries ✅
- Component tests cover critical job processing logic ✅
- CI/CD catches regressions ✅
- Safe to proceed with Phase 1 schema changes

---

## 🚧 Phase 1: "Gatekeeper" - Public Beta Launch

**Goal**: Enable BYOK and stabilize core systems to allow public invites without bankruptcy risk.

**Estimated Timeline**: 15-20 sessions (4-6 weeks)
**Prerequisites**: Phase 0 complete (stable dependencies, integration tests)

### Sprint 1: Testing Baseline & BYOK Foundation (5-7 sessions)

**Why Testing First**: Cannot safely refactor schema without tests. This is the safety net.

- [ ] **Task 1.1**: Write tests for `LlmConfig` parsing and retrieval
- [ ] **Task 1.2**: Write tests for `Personality` loading and mention detection
- [ ] **Task 1.3**: Write tests for `ConversationManager` (158 lines - next target)
- [ ] **Task 1.4**: Write tests for `CommandHandler` (149 lines - slash command routing)

### Sprint 2: BYOK Schema Migration (9-13 sessions, increased from 7-10)

**Why This Order**: Schema changes are risky - tests catch regressions. Prisma 7.0 first to unblock Dependabot PRs.

**Prisma 7.0 Migration** (DO FIRST - 2-3 sessions):
- [ ] **Task 2.0.1**: Upgrade Prisma 6.x → 7.0.0 in all package.json files
- [ ] **Task 2.0.2**: Update `schema.prisma`:
  - Change `provider = "prisma-client-js"` → `"prisma-client"`
  - Add `output = "../src/generated/prisma"` (or similar path per service)
- [ ] **Task 2.0.3**: Update 20+ files to import from new generated path
  - Change: `import { PrismaClient } from '@prisma/client'`
  - To: `import { PrismaClient } from '../generated/prisma/client'`
- [ ] **Task 2.0.4**: Run `prisma generate` and verify generated client
- [ ] **Task 2.0.5**: Run full test suite (989 tests must pass)
- [ ] **Task 2.0.6**: Deploy to development environment, smoke test
- [ ] **Task 2.0.7**: Merge Dependabot PRs (now unblocked)
  - PR #262, #261, #255, #254, #252, #251 (or new ones if they've been updated)

**Database Changes**:
- [ ] **Task 2.1**: Create `UserApiKey` table (AES-256-GCM encrypted storage)
  - Fields: iv, content, tag, provider, isActive
  - Unique constraint: (userId, provider)
- [ ] **Task 2.2**: Create `UsageLog` table (token usage tracking)
  - Fields: userId, provider, model, tokensIn, tokensOut, requestType, timestamp
  - Prevent infrastructure abuse even with BYOK
- [ ] **Task 2.3**: Create `PersonalityAlias` table (unique aliases)
  - Fields: alias, personalityId
  - Unique constraint on alias (prevent overlap)
- [ ] **Task 2.4**: Update `Personality` table
  - Add `errorMessage` (String?, Text) - migrate from `custom_fields.errorMessage`
  - Add `birthday` (DateTime?, Date) - extract from shapes.inc backups
  - Add `ownerId` (String) - user who created personality
  - Add `isPublic` (Boolean, default true) - visibility control
- [ ] **Task 2.5**: Update `User` table
  - Add `timezone` (String, default "UTC")
  - Add `isSuperuser` (Boolean, default false) - bot owner flag
  - Relationships: apiKeys, usageLogs
- [ ] **Task 2.6**: Refactor `LlmConfig` table (hybrid schema)
  - Add `provider` (String, default "openrouter")
  - Add `advancedParameters` (JSONB, default "{}")
  - Add `maxReferencedMessages` (Int, default 10)
  - Add `ownerId` (String?) - null = global, set = user override
  - Migrate existing columns → JSONB: topK, frequencyPenalty, presencePenalty, etc.
  - Drop old columns after migration

**Data Migration**:
- [ ] **Task 2.7**: Move `custom_fields.errorMessage` → `Personality.errorMessage` (66 personalities)
- [ ] **Task 2.8**: Extract aliases from shapes.inc backups → PersonalityAlias table (66 personalities)
- [ ] **Task 2.9**: Extract birthdays from shapes.inc backups → Personality.birthday (66 personalities)
- [ ] **Task 2.10**: Assign ownership (set all existing personalities to bot owner as superuser)

**Application Code**:
- [ ] **Task 2.11**: Create encryption utilities (`packages/common-types/src/utils/encryption.ts`)
  - `encryptApiKey()`, `decryptApiKey()` using AES-256-GCM
  - Master key from Railway environment (`APP_MASTER_KEY`)
- [ ] **Task 2.12**: Add log sanitization middleware
  - Regex: `sk-...`, `sk_...`, `AIza...` → `[REDACTED]`
  - Apply to all services (bot-client, api-gateway, ai-worker)
- [ ] **Task 2.13**: Update ai-worker to use decrypted user API keys
  - Check for user config first, fallback to system config
  - Implement hierarchical inheritance (user → global)
- [ ] **Task 2.14**: Add key validation service (dry run API calls before storage)
- [ ] **Task 2.15**: Create Zod schemas for `advancedParameters` validation (per provider)
  - OpenAI: reasoningEffort, maxCompletionTokens, frequencyPenalty, etc.
  - Anthropic: topK, thinking.budgetTokens, cacheControl, etc.
  - Gemini: topK, safetySettings, thinking_level (Gemini 3.0 Pro), etc.
  - OpenRouter: minP, topA, typicalP, repetitionPenalty, etc.

### Sprint 3: Slash Commands for BYOK (3-4 sessions)

**Why Now**: Users need a UI to input their keys. Do this immediately after backend support.

- [ ] **Task 3.1**: `/wallet set <provider>` - Modal input (ephemeral, secure)
  - Opens Discord Modal for API key input (more secure than slash command args)
  - Validates key with dry run API call before storing
  - Encrypts and stores if valid
- [ ] **Task 3.2**: `/wallet list` - Show configured providers (ephemeral)
- [ ] **Task 3.3**: `/wallet remove <provider>` - Delete API key
- [ ] **Task 3.4**: `/wallet test <provider>` - Validate key still works (quota check)
- [ ] **Task 3.5**: `/llm-config create` - Create user LLM config override
- [ ] **Task 3.6**: `/llm-config list` - Show available configs (global + user)
- [ ] **Task 3.7**: `/llm-config delete` - Delete user config override
- [ ] **Task 3.8**: `/model set <personality> <config>` - Override model for personality
- [ ] **Task 3.9**: `/model reset <personality>` - Remove override, use default
- [ ] **Task 3.10**: `/timezone set` - Dropdown of common timezones (user-level setting)
- [ ] **Task 3.11**: `/timezone get` - Show current timezone
- [ ] **Task 3.12**: `/usage` - Daily/weekly/monthly token stats

**Integration**: Ownership model (isSuperuser, ownerId) from QOL_MODEL_MANAGEMENT.md integrated here.

**🎉 MILESTONE 1: Public Beta Launch**
- Users can add their own API keys
- Bot owner no longer pays for all API costs
- Can invite users without bankruptcy risk
- Modern AI features supported (Claude 3.7, Gemini 3.0 Pro thinking_level, OpenAI o1/o3)

---

## 📋 Phase 2: "Refinement" - Retention & Usability

**Goal**: Quick wins and v2 feature parity to improve user experience and retention.

**Estimated Timeline**: 12-18 sessions (3-5 weeks)

### Sprint 4: Voice Enhancements (5-7 sessions)

**Why Now**: Users are paying for their own keys, they'll want expensive features (Voice Cloning).

**Database Changes**:
- [ ] **Task 4.1**: Create `VoiceConfig` table (ElevenLabs settings per personality)
  - Fields: voiceId, voiceModel, stability, similarity, style, frequency
  - 1:1 relationship with Personality
- [ ] **Task 4.2**: Create `VoiceConfigSample` table (voice cloning samples)
  - Fields: personalityId, sampleData (bytea), fileSize, mimeType, duration
  - Up to 25 samples per personality (10MB limit each for Instant Voice Cloning)
- [ ] **Task 4.3**: Create `UserPreferences` table (user-level overrides)
  - Fields: userId, voiceEnabled (Boolean?) - null = use personality default

**Data Migration**:
- [ ] **Task 4.4**: Extract voice settings from shapes.inc backups → VoiceConfig table (66 personalities)
  - voice_id, voice_model, voice_stability, voice_similarity, voice_style, voice_frequency

**Application Code**:
- [ ] **Task 4.5**: Update voice synthesis service to query VoiceConfig table
- [ ] **Task 4.6**: Add voice sample upload endpoint (validate size ≤10MB, format MP3/WAV)
- [ ] **Task 4.7**: Add ElevenLabs Instant Voice Cloning integration
- [ ] **Task 4.8**: Implement user preference override logic

**Slash Commands**:
- [ ] **Task 4.9**: `/voice enable` - Enable voice for current user (override)
- [ ] **Task 4.10**: `/voice disable` - Disable voice for current user (override)
- [ ] **Task 4.11**: `/voice reset` - Remove user override (use personality default)
- [ ] **Task 4.12**: (Admin) `/personality voice-sample upload <personality> <file>`

### Sprint 5: Quick Wins & Polish (3-5 sessions)

**Why**: Low effort, high visible impact features.

- [ ] **Task 5.1**: Transcription Cleanup (LLM post-processing for Whisper)
  - Add punctuation and formatting to transcriptions
  - Use cheap model (Claude Haiku)
  - Makes bot feel "smarter" immediately
- [ ] **Task 5.2**: Custom error messages (use Personality.errorMessage)
  - Already migrated in Sprint 2, just wire it up
  - Replace generic "no job result" error with personality-specific messages
- [ ] **Task 5.3**: Birthday awareness (use Personality.birthday)
  - Personalities can reference their birthday in responses
  - Time-aware responses using User.timezone

### Sprint 6: V2 Feature Parity - Core Systems (4-6 sessions)

**Why**: Essential features for retention and UX.

**From V2_FEATURE_TRACKING.md - High Priority**:

- [ ] **Task 6.1**: Auto-Response System (activated channels)
  - `/channel activate <personality>` - Enable auto-response in channel
  - `/channel deactivate` - Disable auto-response
  - Personality responds to every message in activated channel
- [ ] **Task 6.2**: Rate Limiting (token bucket algorithm)
  - Per-user rate limits (prevent API spam)
  - Per-channel rate limits
  - Graceful degradation (show friendly message)
- [ ] **Task 6.3**: Request Deduplication (prevent duplicate processing)
  - Track recent message IDs (simple Map-based cache)
  - TTL-based cleanup
- [ ] **Task 6.4**: NSFW Verification (age verification)
  - One-time per-user verification (not per-channel)
  - Auto-verify by using bot in NSFW-marked Discord channel
  - Prevent access to NSFW personalities without verification

**🎉 MILESTONE 2: Feature Parity**
- All critical v2 features ported
- Voice synthesis fully configurable
- Users can customize their experience
- Production-ready for sustained growth

---

## 🧊 Phase 3: "Evolution" - Advanced Architecture

**Goal**: Deep architecture changes and advanced features. Only start when Phase 1 & 2 are stable and you have real user data.

**Estimated Timeline**: 15-23 sessions (4-6 weeks)

### Sprint 7: OpenMemory Migration - Foundation (10-15 sessions)

**Why Later**: Massive rewrite. By doing this after launch, you'll have real user data to test the new memory graph against.

**Reference**: [docs/planning/OPENMEMORY_MIGRATION_PLAN.md](docs/planning/OPENMEMORY_MIGRATION_PLAN.md)

**Database Changes** (PostgreSQL + pgvector):
- [ ] **Task 7.1**: Design waypoint graph schema
  - `waypoints` table (nodes in memory graph)
  - `waypoint_connections` table (edges with weights)
  - `memory_sectors` table (episodic, semantic, emotional, procedural, reflective)
- [ ] **Task 7.2**: Implement multi-sector memory storage
- [ ] **Task 7.3**: Add decay system (daily REM sleep simulation)

**Application Code**:
- [ ] **Task 7.4**: Build waypoint graph system with associative learning
- [ ] **Task 7.5**: Implement hybrid scoring (60% similarity + 20% overlap + 15% waypoints + 5% recency)
- [ ] **Task 7.6**: Add adaptive query expansion
- [ ] **Task 7.7**: Implement deterministic reflection (no LLM censorship concerns)

**Migration**:
- [ ] **Task 7.8**: Migrate existing pgvector memories to OpenMemory structure
- [ ] **Task 7.9**: Run parallel systems (old + new) for validation
- [ ] **Task 7.10**: Cut over to OpenMemory, deprecate old system

### Sprint 8: Agentic Features (5-8 sessions)

**Why**: Natural extension of sophisticated memory - let personalities be more autonomous.

- [ ] **Task 8.1**: Toolbox system (personalities can use tools)
  - Search memory
  - Create waypoints
  - Reflect on conversations
- [ ] **Task 8.2**: "Free Will" loop (unsolicited personality actions)
  - Check-in messages
  - Spontaneous reflections
  - Memory consolidation
- [ ] **Task 8.3**: Memory management commands
  - `/memory search <query>`
  - `/memory prune <threshold>`
  - `/memory stats`

### Sprint 9: Advanced Features (Variable - as desired)

**Why**: Fun experiments and nice-to-haves.

- [ ] **Task 9.1**: Image Generation (if tool calling infrastructure ready)
  - Only Gemini models available on OpenRouter
  - Wait for proper tool call architecture
  - See: [docs/planning/PHASED_IMPLEMENTATION_PLAN.md - Phase 3](docs/planning/PHASED_IMPLEMENTATION_PLAN.md)
- [ ] **Task 9.2**: Multi-Personality Response
  - `@Lilith @Sarcastic hey both of you` → Both respond
  - Complex conversation history tracking
- [ ] **Task 9.3**: PluralKit Proxy Support
  - Detect PluralKit proxies
  - Link system members to Discord users
  - Simplified vs v2's elaborate system
- [ ] **Task 9.4**: Release Notifications
  - Notify about bot updates
  - Port from v2

**🎉 MILESTONE 3: AGI-lite**
- Sophisticated cognitive architecture operational
- Personalities have autonomy and memory graphs
- Advanced features for power users

---

## 🧊 Icebox - Ideas for Later

**Rule**: If you have an idea, it goes here. Close all other tabs/docs. Resist the shiny object.

- Streaming responses (real-time message updates)
- Metrics & monitoring (Prometheus)
- Advanced caching strategies
- Multi-language support
- Custom personality training data
- Personality collaboration features
- Dream sequences (personality self-reflection)
- Emotion tracking over time
- Relationship graphs between users and personalities

---

## 📝 Technical Debt / Maintenance

**Ongoing**: These don't block features but improve quality of life.

- [ ] Increase test coverage for `WebhookManager` (249 lines)
- [ ] Refactor `MessageHandler` if it grows beyond 468 lines (consider splitting)
- [ ] Add integration tests for end-to-end flows
- [ ] Document all `advancedParameters` JSONB structures per provider
- [ ] Update CHANGELOG.md with each release
- [ ] Rotate encryption keys every 90 days
- [ ] Database backups before major migrations

---

## 🎯 How to Use This Roadmap

### For AI Sessions:

1. **Start Every Session**: Read the **current sprint** section
2. **Context Injection**: Paste the active tasks into your AI prompt
   - *Example*: "We are working on Sprint 2, Task 2.11 (encryption utilities). Here is the context..."
3. **Resist Shiny Objects**: If your brain says "Let's design the cognitive architecture," look at the Roadmap. Is Phase 1 done? If no, write it down in the Icebox and go back to work.

### For Planning Sessions:

1. **Update Status**: Mark tasks as complete [ → x]
2. **Add New Ideas**: Add to Icebox, don't derail current sprint
3. **Reprioritize**: Only if a production fire requires it

### For Context Switching:

1. **Before Break**: Update CURRENT_WORK.md with "Last worked on: Sprint X, Task Y"
2. **After Break**: Read CURRENT_WORK.md, then jump to that sprint in ROADMAP.md

---

## 📊 Progress Tracking

### Phase 0: "Foundation" 🚧 CURRENT PRIORITY
- **Sprint 0**: Dependency Updates & Test Coverage → 📋 Not Started
- **Estimated Completion**: 1-2 weeks
- **Risk Mitigation**: Stable dependencies + integration tests before schema changes ✅

### Phase 1: "Gatekeeper" 📋 PLANNED (after Phase 0)
- **Sprint 1**: Testing Baseline → 📋 Blocked on Phase 0
- **Sprint 2**: Prisma 7.0 + BYOK Schema Migration → 📋 Blocked on Phase 0
- **Sprint 3**: Slash Commands → 📋 Blocked on Phase 0
- **Estimated Completion**: 5-7 weeks after Phase 0 (increased due to Prisma 7.0 migration)
- **Blocker Removal**: BYOK enables public launch ✅
- **Dependency Updates**: Unblocked after Prisma 7.0 migration in Sprint 2

### Phase 2: "Refinement" 📋 PLANNED
- **Sprint 4**: Voice Enhancements → 📋 Not Started
- **Sprint 5**: Quick Wins → 📋 Not Started
- **Sprint 6**: V2 Feature Parity → 📋 Not Started
- **Estimated Completion**: 3-5 weeks after Phase 1
- **Value**: Feature parity + retention

### Phase 3: "Evolution" 🧊 ICEBOX
- **Sprint 7**: OpenMemory Foundation → 🧊 Blocked on Phase 1 & 2
- **Sprint 8**: Agentic Features → 🧊 Blocked on Sprint 7
- **Sprint 9**: Advanced Features → 🧊 Blocked on infrastructure
- **Estimated Completion**: 4-6 weeks after Phase 2
- **Value**: Innovation, differentiation

---

## 🚨 Emergency Procedures

### If Production is On Fire:
1. Stop everything
2. Fix the fire
3. Write a test that would have caught it
4. Update this roadmap with lessons learned
5. Resume current sprint

### If Feeling Overwhelmed:
1. Close all docs except ROADMAP.md and CURRENT_WORK.md
2. Look at current sprint - what's the next checkbox?
3. Do that one task
4. Don't think about anything else

### If Scope Creep Detected:
1. Write the idea in Icebox
2. Ask: "Does this help launch the public beta?" If no → Icebox
3. Ask: "Does this prevent a production fire?" If no → Icebox
4. Resume current sprint

---

## 📚 Related Documentation

### Planning Docs
- [docs/planning/PHASED_IMPLEMENTATION_PLAN.md](docs/planning/PHASED_IMPLEMENTATION_PLAN.md) - BYOK Phase 1-3 details
- [docs/planning/schema-improvements-proposal.md](docs/planning/schema-improvements-proposal.md) - Detailed schema changes
- [docs/planning/QOL_MODEL_MANAGEMENT.md](docs/planning/QOL_MODEL_MANAGEMENT.md) - LLM config management details (integrated into Sprint 2-3)
- [docs/planning/OPENMEMORY_MIGRATION_PLAN.md](docs/planning/OPENMEMORY_MIGRATION_PLAN.md) - OpenMemory architecture (Sprint 7-8)
- [docs/planning/V2_FEATURE_TRACKING.md](docs/planning/V2_FEATURE_TRACKING.md) - v2 feature parity tracking (Sprint 6)

### Architecture
- [docs/architecture/llm-hyperparameters-research.md](docs/architecture/llm-hyperparameters-research.md) - Advanced LLM parameters (validated)
- [docs/architecture/ARCHITECTURE_DECISIONS.md](docs/architecture/ARCHITECTURE_DECISIONS.md) - Why v3 is designed this way

---

**Remember**: You are currently blocking yourself from success by thinking about the **Brain** (OpenMemory) before you have built the **Wallet** (BYOK). Build the Wallet. Launch. Then build the Brain.

**The One Document Rule**: If you have an idea, it goes into the Icebox section of this document. Close all other tabs/docs. Focus on the current sprint.

