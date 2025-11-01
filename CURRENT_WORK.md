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
- ✅ Type-safe mock factory pattern
- ✅ Example tests for personality mention parser (22 tests, all passing)
- ✅ Testing guidelines documentation
- ✅ V2 lessons learned analysis
- ✅ Gemini code review integration

**Architecture Highlights**:
- Co-located tests (`.test.ts` next to source)
- Type-safe mocks (no `as any` - compiler-enforced)
- Built-in fake timers (Vitest)
- Explicit mock factories (not magic presets)
- Integration-focused test strategy

**Current Work**:
- Adding more utility test coverage
- Creating Discord.js mock factories
- Setting up integration test patterns

**Key Files**:
- `docs/guides/TESTING.md` - Complete testing guide
- `docs/architecture/TESTING_LESSONS_LEARNED.md` - V2 → V3 migration insights
- `services/bot-client/src/test/mocks/` - Type-safe mock factories

**Next Steps**:
1. Add Discord.js mock factories
2. Create integration test examples
3. Add tests for MessageHandler
4. Expand coverage to other utilities

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
