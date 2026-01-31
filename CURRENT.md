# Current

> **Session**: 2026-01-31
> **Version**: v3.0.0-beta.61
> **Branch**: `feature/reaction-personas-in-context`

---

## Active Task: Message Reactions in XML

**Goal**: Add reaction metadata to extended context and include reactor personas in participant context.

### Scope

1. **Extract reactions from Discord messages** - Get emoji and users who reacted
2. **Include reactor personas in participants** - Bump limit from 5 → 10 personas
3. **Smart participant selection** - Dedupe with existing conversation participants, fill remaining slots with recent reactors
4. **Format reactions as XML metadata** - Add to message context

### Technical Findings

**Discord.js Limitation**: Reaction timestamps are NOT exposed via the API. We cannot order reactions by "most recent". Alternative approaches:

- Use message timestamp as proxy (reactions on recent messages are likely recent)
- Use arbitrary order from Discord.js reaction collection
- Fetch reactions in order they appear on the message

**Current Hard Limit of 5 Participants**: Located in `RAGUtils.ts:140-150`, constrained by stop sequence budget:

- 16 total stop sequences allowed (Gemini API limit)
- 11 reserved for safety (XML markers, hallucination prevention, etc.)
- 5 remaining for participant names

**Key Files**:

- `services/ai-worker/src/services/RAGUtils.ts` - Stop sequence limit (lines 140-150)
- `services/ai-worker/src/services/prompt/ParticipantFormatter.ts` - XML formatting
- `services/ai-worker/src/services/MemoryRetriever.ts` - Participant population (lines 211-317)
- `services/bot-client/src/services/MessageContextBuilder.ts` - Context building

### Implementation Plan

- [ ] Bump participant limit from 5 → 10 in RAGUtils.ts
- [ ] Add reaction extraction to MessageContextBuilder
- [ ] Pass reactions through ConversationHistory pipeline
- [ ] Resolve reactor personas (same pattern as other participants)
- [ ] Dedupe reactors with existing conversation participants
- [ ] Fill remaining participant slots with reactor personas
- [ ] Add reactions XML to message format in conversationUtils.ts

### Questions to Resolve

1. **Stop sequence budget**: Can we safely reduce reserved sequences to accommodate 10 participants?
2. **Reaction ordering**: Without timestamps, how do we prioritize which reactors to include?
3. **Performance**: How many API calls does fetching reactor user info require?

---

## Session Summary (2026-01-31 - Earlier)

Character Chat Feature Parity completed:

- **Extended Context Fix**: `/character chat` now uses `buildContext` with a Message object, enabling extended context support (Discord message fetching) - parity with @mention pattern
- **Code Cleanup**: Deleted unused `buildContextFromInteraction` method (YAGNI)

Bug fixes deployed:

- **Thread Verification Cleanup Fix**: `VerificationMessageCleanup.deleteMessage()` now supports thread channels (PublicThread, PrivateThread, AnnouncementThread)
- **DM Message Link Fix**: `/admin debug` now supports DM message links (`@me` format)

Earlier cleanup session:

- **v2 Legacy Cleanup**: Removed scripts/ and tests/ from tzurot-legacy
- **v3 Scripts Cleanup**: Removed v2 cruft from v3 scripts/
- **Baseline Consolidation**: Moved baselines to `.github/baselines/`
- **Safety Improvements**: Added explicit `rm -rf` prohibition to CLAUDE.md

---

## Recent Highlights

- **beta.61**: Character chat extended context fix, admin debug improvements
- **beta.60**: DM personality chat support, sticky DM sessions, speaker identification fix
- **beta.58**: ConversationSyncService standardization, testing infrastructure
- **beta.57**: DeepSeek R1 reasoning fix, temperature jitter, LLM config key consolidation
- **beta.56**: Reasoning param conflict warning, API-level reasoning extraction tests
- **beta.55**: ownerId NOT NULL migration, stop sequences fix, model footer on errors

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items (replaces ROADMAP + TECH_DEBT)
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
