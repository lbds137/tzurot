# Current

> **Session**: 2026-01-31
> **Version**: v3.0.0-beta.61

---

## Session Summary (2026-01-31)

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
