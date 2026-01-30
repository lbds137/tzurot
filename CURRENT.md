# Current

> **Session**: 2026-01-30
> **Version**: v3.0.0-beta.59

---

## Session Goal

_DM personality chat support and speaker identification fix._

---

## Completed This Session

- **DM Personality Chat Support** - Users can now chat with personalities in DMs by replying to bot messages
  - 3-tier lookup strategy: Redis (fast) → Database (authoritative) → Display name parsing (fallback)
  - New endpoint: `GET /user/conversation/message-personality`
  - Updated `ReplyResolutionService` to handle DM replies (bot messages don't use webhooks)
  - 6 new test cases for DM reply resolution
- **Speaker Identification Fix** - Fixed regression where LLM didn't know who current speaker was
  - Added `<from>PersonaName</from>` prefix to user messages
  - Matches the `from=` attribute format used in `<chat_log>` for consistency
- **Integration Test Fix** - AIJobProcessor.int.test.ts now uses `loadPGliteSchema()`
  - Removed manual table creation (was missing `nsfw_verified` column)
  - Added pgvector extension support
  - CI integration tests now pass

**PR**: #548 - feat: DM personality chat support with speaker identification fix

---

## Recent Highlights

- **beta.59**: NSFW verification with proactive message cleanup
- **beta.58**: ConversationSyncService standardization, testing infrastructure
- **beta.57**: DeepSeek R1 reasoning fix, temperature jitter, LLM config key consolidation
- **beta.56**: Reasoning param conflict warning, API-level reasoning extraction tests
- **beta.55**: ownerId NOT NULL migration, stop sequences fix, model footer on errors

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items (replaces ROADMAP + TECH_DEBT)
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
