# 🎯 Current Work

> Last updated: 2025-11-02

## Status: Code Quality & Refactoring Sprint 🧹

**Current Phase**: Systematic refactoring and test coverage improvements

**Recent Completion**:
- ✅ PR #203, #204 merged and released as v3.0.0-alpha.21
- ✅ Emergency fix for Qdrant lockfile issue deployed
- ✅ Completed first refactoring chunk (api-gateway utilities)
  - Created 3 new utility modules with 95 comprehensive tests
  - Reduced admin.ts from 437 → 328 lines (25% reduction)
  - Eliminated ~109 lines of duplicate code

## Active Work

### API Gateway Refactoring & Testing (In Progress)
**Branch**: `refactor/api-gateway-utilities`
**Status**: First chunk complete, ready for PR

**Completed**:
- ✅ `errorResponses.ts` - Centralized error response creation (41 tests)
- ✅ `authMiddleware.ts` - Owner authentication middleware (24 tests)
- ✅ `imageProcessor.ts` - Avatar optimization utility (30 tests)
- ✅ Refactored `admin.ts` to use all new utilities

**Impact**:
- **Code reduction**: 437 → 328 lines in admin.ts (25% reduction)
- **Test coverage**: Added 95 comprehensive tests
- **Maintainability**: Eliminated duplicate error handling, auth checks, and image processing logic
- **Type safety**: Full TypeScript coverage with proper error code enums

**Next Steps** (separate PRs):
- Refactor `ai.ts` routes to use error response utilities
- Additional test coverage for route handlers
- More duplicate code elimination

## Planned Features (Priority Order)

### 1. Unit Testing Infrastructure 🧪✨
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

### 4. Multi-Personality Response Feature 🎭
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
- Long-term memory via Qdrant vectors
- Image attachment support
- Voice transcription support
- Model indicator in responses
- Persistent typing indicators
- Basic slash commands (/ping, /help)

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
- [docs/planning/V3_REFINEMENT_ROADMAP.md](docs/planning/V3_REFINEMENT_ROADMAP.md) - Comprehensive improvement roadmap
- [docs/planning/V2_FEATURE_TRACKING.md](docs/planning/V2_FEATURE_TRACKING.md) - Feature parity tracking

### Architecture
- [docs/architecture/ARCHITECTURE_DECISIONS.md](docs/architecture/ARCHITECTURE_DECISIONS.md) - Why v3 is designed this way
- [docs/deployment/DEPLOYMENT.md](docs/deployment/DEPLOYMENT.md) - Railway deployment guide

### Development
- [docs/guides/DEVELOPMENT.md](docs/guides/DEVELOPMENT.md) - Local development setup
- [CLAUDE.md](CLAUDE.md) - AI assistant rules and project context

---

*This file reflects current focus and planned work. Updated when switching context.*
