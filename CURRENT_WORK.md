# 🎯 Current Work

> Last updated: 2025-11-01

## Status: Building Test Infrastructure Foundation

**Current Phase**: Establishing comprehensive testing framework for v3

**Recent Completion**:
- ✅ PR #192, #193, #194 merged and released as v3.0.0-alpha.17
- ✅ All three bug fixes deployed to production
- ✅ Unit testing infrastructure established

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
**Status**: Needs architectural planning

**Goal**: Extract context from Discord replies and message links

**Features**:
- Extract content from replied-to messages
- Parse Discord message links (format: `https://discord.com/channels/guild/channel/message`)
- Look up or create default personas for referenced message authors
- Add referenced messages as separate prompt section (not mixed with conversation history)
- Improved embed extraction (v2's approach was incomplete)

**Technical Approach**:
- New module: `context/MessageReferenceExtractor.ts`
- New module: `utils/EmbedParser.ts`
- Separate prompt section for referenced messages
- Chronological ordering with same metadata as conversation history
- Better embed field extraction (images, fields, footers)

**v2 Reference** (read-only, don't copy bad patterns):
- `origin/feature/enhanced-context-metadata` branch
- Problems with v2: messy structure, mixed concerns, not modular
- Keep v3's clean prompt format

**Open Questions**:
- How many levels deep should we follow message references?
- Should we extract embeds from referenced messages too?
- How to handle references to messages in inaccessible channels?

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
