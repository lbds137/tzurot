# Current

> **Session**: 2026-01-31
> **Version**: v3.0.0-beta.61
> **Branch**: `feature/reaction-personas-in-context` (ready for PR)

---

## Completed: Message Reactions in XML

**Goal**: Add reaction metadata to extended context and include reactor personas in participant context.

### What Was Implemented

1. **Reaction extraction from Discord messages** - Last 5 messages have reactions extracted
2. **Reactor personas in participant context** - Dedupe with existing participants, batch create personas
3. **XML formatting** - Reactions included as nested elements in message XML
4. **Stop sequence tracking** - In-memory scoreboard for monitoring activations

### Implementation Details

**New Constants** (common-types):

- `MAX_REACTION_MESSAGES`: 5 (extract reactions from last 5 messages)
- `MAX_PARTICIPANT_PERSONAS`: 10 (separate from stop sequence limit of 5)

**New Types** (common-types):

- `MessageReaction`: emoji, isCustom flag, reactors array
- `ReactionReactor`: personaId, displayName

**XML Format**:

```xml
<message from="Alice" role="user" t="...">
Hello everyone!
<reactions>
<reaction emoji="👍">Bob, Carol</reaction>
<reaction emoji=":custom:" custom="true">Dave</reaction>
</reactions>
</message>
```

**Key Files Changed**:

- `DiscordChannelFetcher.ts`: extractReactions(), processReactions(), collectReactorUsers()
- `MessageContextBuilder.ts`: includes reactor users in batch persona creation
- `conversationUtils.ts`: formatSingleHistoryEntryAsXml() includes <reactions> section
- `StopSequenceTracker.ts`: in-memory tracker for stop sequence activations

### Technical Notes

- Stop sequence limit (5) remains separate from participant persona limit (10)
- Reactions are only extracted from extended context messages (Discord fetch), not DB history
- Reactor users are deduped with existing conversation participants before persona resolution
- Stop sequence activations are logged with structured JSON for Railway log search

---

## Also Completed This Session

**db-sync Improvements**:

- Exclude all user preference columns (`default_llm_config_id`, `default_persona_id`)
- Exclude `personality_default_configs` table entirely
- Add exclusions for `user_personality_configs` and `user_persona_history_configs`

**/admin debug Fix**:

- AI error message IDs now work for log lookup
- Added `updateDiagnosticResponseIds` call in error response path

**DeepSeek R1 Error Handling**:

- Added SDK parsing error patterns to apiErrorParser
- Added `response.ok` check before reasoning injection

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
