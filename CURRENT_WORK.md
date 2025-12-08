# Current Work

> Last updated: 2025-12-08

## Status: Documentation Cleanup Sprint

**Current Phase**: Housekeeping - Documentation Consolidation
**Branch**: `docs/cleanup-consolidation-sprint`

---

## Active Work: Documentation Cleanup Sprint

### Session Goals

1. Remove docs for planned work that has been implemented
2. Clean up CLAUDE.md (too large - move content to skills)
3. Apply SRP/DRY principles to documentation
4. Update README for anything out of date

### Completed This Session

- Deleted obsolete planning docs (6 files for completed features)
- Updated all "alpha" references to "beta" across docs
- Consolidated shapes.inc documentation
- Fixed broken doc references in ROADMAP.md
- Cleaned up docs/improvements folder
- Moved Git Hooks section from CLAUDE.md to tzurot-git-workflow skill
- Moved Timer Patterns section to tzurot-async-flow skill
- Moved Scripts section to tzurot-db-vector skill
- Reviewed skills for SRP/DRY opportunities (fixed DRY violations)
- Updated README.md deployment section

---

## Previous Work: /me Command & Autocomplete Refactor

**Branch**: `refactor/me-commands-and-autocomplete`
**Status**: Planned, not started

### Problem Statement

The `/me` command has architectural issues:

1. **Gateway Bypass**: All `/me` commands use direct Prisma instead of API gateway
2. **Inconsistent Autocomplete**: 3 different personality autocomplete implementations

**Full documentation**: [docs/improvements/me-command-refactor.md](docs/improvements/me-command-refactor.md)

---

## v3 Current State

**Deployment**: Railway development environment (public beta)

- Branch: `develop`
- Status: Stable and operational
- BYOK implemented - users can bring their own API keys
- Guest mode available for users without API keys

### Features Working

- @personality mentions
- Reply detection
- Message references (Discord message links + reply context)
- Webhook management (unique avatar/name per personality)
- Long-term memory via pgvector
- Image attachment support
- Voice transcription support
- Slash commands (admin, character, wallet, llm-config, model, settings, profile)
- BYOK (Bring Your Own Key)
- Free model guest mode

### Not Yet Ported from v2

- Auto-response (activated channels)
- Rate limiting
- NSFW verification
- Request deduplication

---

## Quick Links

### Planning

- **[ROADMAP.md](ROADMAP.md)** - The source of truth for sprints and tasks
- [docs/planning/V2_FEATURE_TRACKING.md](docs/planning/V2_FEATURE_TRACKING.md) - V2 feature parity

### Architecture

- [CLAUDE.md](CLAUDE.md) - AI assistant rules and project context
- [docs/architecture/ARCHITECTURE_DECISIONS.md](docs/architecture/ARCHITECTURE_DECISIONS.md) - Why v3 is designed this way
- [docs/deployment/RAILWAY_DEPLOYMENT.md](docs/deployment/RAILWAY_DEPLOYMENT.md) - Railway deployment guide

---

_This file reflects current focus. Updated when switching context._
