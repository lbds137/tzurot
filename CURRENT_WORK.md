# 🎯 Current Work

> Last updated: 2025-11-16

## Status: Documentation & Infrastructure Improvements 🎯

**Current Phase**: Project Housekeeping & CI/CD Enhancement

**Recent Completion**:

- ✅ **v3.0.0-alpha.39 Release** (2025-11-16) - Critical voice transcription fix
  - Fixed AudioTranscriptionResult field mismatch (`transcript` → `content`)
  - Voice messages now working correctly in production
  - Documented async pattern architectural note
- ✅ **CI/CD Pipeline** - Re-enabled with pnpm and v2 exclusions
  - Automated tests, linting, type checking, builds
  - Proper isolation of legacy v2 codebase
- ✅ **CLAUDE.md Rebalancing** - Major reorganization (Gemini consultation)
  - Separated universal principles from project-specific context
  - Added CURRENT_WORK.md update guidance
  - Added session handoff procedures
- ✅ **Documentation Cleanup** - Removed redundant CHANGELOG, updated README
  - GitHub Releases serve as version history
  - Created comprehensive documentation audit

## Active Work

**Next Session**: Continue documentation improvements
- Refresh V2_FEATURE_TRACKING.md with current v3 state
- Research Claude Code workflow optimizations (subagents, skills)
- Archive completed planning docs

## Planned Features (Priority Order)

### 1. LLM Model & Personality Management 🎯 **[PLANNED]**

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
1-8. Core migration (10-15 sessions)
9. Agentic features (5-8 sessions) - toolbox, "free will", memory management

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

### 3. Message Reference System 🔗

**Priority**: Medium - Feature parity with v2
**Status**: Architecture designed, ready for implementation

**Goal**: Extract context from Discord replies and message links

**Features**:

- Extract content from replied-to messages
- Parse Discord message links (format: `https://discord.com/channels/guild/channel/message`)
- Look up or create default personas for referenced message authors
- Add referenced messages as separate prompt section (not mixed with conversation history)
- Improved embed extraction with all fields included
- Replace message links in user's message with numbered references (e.g., "Reference 1", "Reference 2")

**Technical Approach**:

- New module: `context/MessageReferenceExtractor.ts`
- New module: `utils/EmbedParser.ts`
- Separate prompt section: "## Referenced Messages"
- Numbered references paired with message content:
  - User message: "Check out Reference 1 and Reference 2"
  - Context section: "[Reference 1] <message content>", "[Reference 2] <message content>"
- Chronological ordering with same metadata as conversation history
- Full embed extraction: title, description, fields, images, footers, etc.
- LLM-friendly embed formatting

**Design Decisions**:

- **Max references**: 10 referenced messages (configurable in personality LLM config)
- **Embed extraction**: Yes - extract and format all embed fields from referenced messages
- **Inaccessible channels**: Skip silently (don't error, just exclude)
- **Link replacement**: Replace Discord message links with "Reference N" (except reply-to, which has no link in content)
- **Numbering**: Consistent numbering between user message and context section for LLM clarity

**v2 Reference** (read-only, don't copy bad patterns):

- `origin/feature/enhanced-context-metadata` branch
- Problems with v2: messy structure, mixed concerns, not modular
- Keep v3's clean prompt format

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
- Webhook management (unique avatar/name per personality)
- Message chunking (2000 char Discord limit)
- Conversation history tracking
- Long-term memory via pgvector
- Image attachment support
- **Voice transcription support** ✅ (fixed in alpha.39)
- Model indicator in responses
- Persistent typing indicators
- Basic slash commands (/ping, /help)
- **CI/CD pipeline** ✅ (re-enabled 2025-11-16)

### 📋 Not Yet Ported from v2

- Auto-response (activated channels)
- Full slash command system
- Rate limiting
- NSFW verification
- Request deduplication

### 🚧 Blockers for Public Launch

**Critical**:

- **BYOK (Bring Your Own Key)**: Users provide own API keys
- **Admin Commands**: Server management for bot owner

---

## Quick Links

### Planning Docs

- **[docs/planning/QOL_MODEL_MANAGEMENT.md](docs/planning/QOL_MODEL_MANAGEMENT.md)** - **ACTIVE**: LLM config & personality management
- **[docs/planning/OPENMEMORY_MIGRATION_PLAN.md](docs/planning/OPENMEMORY_MIGRATION_PLAN.md)** - OpenMemory migration plan (deferred)
- [docs/planning/V3_REFINEMENT_ROADMAP.md](docs/planning/V3_REFINEMENT_ROADMAP.md) - Comprehensive improvement roadmap
- [docs/planning/V2_FEATURE_TRACKING.md](docs/planning/V2_FEATURE_TRACKING.md) - Feature parity tracking

### Architecture

- [docs/architecture/ARCHITECTURE_DECISIONS.md](docs/architecture/ARCHITECTURE_DECISIONS.md) - Why v3 is designed this way
- [docs/deployment/DEPLOYMENT.md](docs/deployment/DEPLOYMENT.md) - Railway deployment guide

### Development

- [docs/guides/DEVELOPMENT.md](docs/guides/DEVELOPMENT.md) - Local development setup
- [CLAUDE.md](CLAUDE.md) - AI assistant rules and project context

---

_This file reflects current focus and planned work. Updated when switching context._
