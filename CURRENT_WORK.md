# Current Work

> Last updated: 2025-11-30

## Status: Redis Client Migration Complete

**Current Phase**: Phase 2 Sprint 5 - Quick Wins & Polish

---

## Recent Work (2025-11-30)

**Redis Client Migration** - COMPLETE:

- Consolidated from dual Redis clients (node-redis + ioredis) to single ioredis client
- BullMQ requires ioredis anyway, so this eliminates redundant connections
- Updated all services: ai-worker, bot-client, common-types
- Updated test mocks to use ioredis types
- All 2,525 tests passing

**VisionProcessor Guest Mode Fix**:

- Fixed flawed `:free` suffix heuristic for vision fallback detection
- Now uses proper `isGuestMode` from ApiKeyResolver throughout the chain
- BYOK users who choose free models now correctly get paid vision fallbacks

**Free Model Guest Mode** - COMPLETE (Tasks 5.G1-5.G9):

- Added `isFreeDefault` boolean to `LlmConfig` table
- `ApiKeyResolver` returns `isGuestMode: boolean` in results
- Guest mode footer in responses via `DiscordResponseSender`
- `/llm-config list` shows free badges, dims paid models for guests
- `/model set` and `/model set-default` validate free-model-only for guests
- Selected `x-ai/grok-4.1-fast:free` as default (2M context, vision)

---

## Next Priority

**User Persona Management** (Sprint 5.0.1-5.0.7) or **Quick Wins** (5.1-5.6)

See [ROADMAP.md](ROADMAP.md) for the full task list.

---

## v3 Current State

**Deployment**: Railway development environment (public beta)

- Branch: `develop`
- Status: Stable and operational
- BYOK implemented - users can bring their own API keys

### Features Working

- @personality mentions
- Reply detection
- Message references (Discord message links + reply context)
- Webhook management (unique avatar/name per personality)
- Long-term memory via pgvector
- Image attachment support
- Voice transcription support
- Slash commands (admin, personality, wallet, llm-config, model, settings)
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
