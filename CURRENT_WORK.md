# Current Work

> Last updated: 2025-12-06

## Status: /me Command Refactor

**Current Phase**: Phase 2 Sprint 5 - Quick Wins & Polish
**Branch**: `refactor/me-commands-and-autocomplete`

---

## Active Work: /me Command & Autocomplete Refactor

### Problem Statement

The `/me` command has significant architectural issues discovered during PR #318 review:

1. **Gateway Bypass**: All `/me` commands use direct Prisma instead of API gateway
2. **Inconsistent Autocomplete**: 3 different personality autocomplete implementations
3. **Command Structure**: `override` and `settings` should be under `profile`

**Full documentation**: [docs/improvements/me-command-refactor.md](docs/improvements/me-command-refactor.md)

### Audit Findings

**Files bypassing gateway (using `getPrismaClient`):**

- `me/autocomplete.ts`, `me/create.ts`, `me/default.ts`, `me/edit.ts`
- `me/list.ts`, `me/override.ts`, `me/settings.ts`, `me/view.ts`

**Root cause**: No `/user/persona` gateway endpoints exist.

**Autocomplete inconsistency:**
| Implementation | API | Visibility Icons | Return |
|---------------|-----|-----------------|--------|
| `/character/autocomplete.ts` | Gateway | 🌐/🔒/📖 | slug |
| `/me/autocomplete.ts` | **Prisma** | None | slug |
| `/me/model/autocomplete.ts` | Gateway | None | id |

### Implementation Plan

1. **Phase 1**: Create gateway endpoints for persona CRUD
2. **Phase 2**: Create shared personality autocomplete utility
3. **Phase 3**: Refactor /me commands to use gateway
4. **Phase 4**: Restructure command groups (override, settings → profile)
5. **Phase 5**: Update all tests

**Estimated effort**: 4-6 sessions

---

## Previous Active Work: Slash Command Restructuring

### Problem Statement

Current command structure (9 top-level commands) is confusing with overlapping concepts:

| Command        | Purpose                       | Issues                                              |
| -------------- | ----------------------------- | --------------------------------------------------- |
| `/admin`       | Bot owner tools               | OK - keep separate                                  |
| `/character`   | AI characters (dashboard)     | Overlaps with `/personality`                        |
| `/personality` | AI characters (owner-only)    | Redundant with `/character`                         |
| `/llm-config`  | LLM config definitions        | Overlaps with `/model`                              |
| `/model`       | Model override assignments    | Overlaps with `/llm-config` and `/profile override` |
| `/profile`     | User personas + overrides     | Override feature duplicates `/model`                |
| `/settings`    | User settings (only timezone) | Too thin, should merge with `/profile`              |
| `/utility`     | ping, help                    | `/help` should be top-level                         |
| `/wallet`      | BYOK API keys                 | OK - keep distinct (sensitive)                      |

### Proposed Restructuring (Gemini-Assisted Design)

**Goal**: Reduce from 9 commands to 5-6, group by user intent not database schema.

#### New Structure

1. **`/help`** - Promote to top-level (currently buried under `/utility help`)

2. **`/character`** - Unified AI character management
   - Absorb `/personality` (use permission checks, not separate commands)
   - Keep dashboard pattern (create, edit, view, list, avatar)
   - Add model assignment as a field in character edit (not separate command)

3. **`/preset`** - Rename `/llm-config` for clarity
   - "Presets" are definitions (GPT-4 Turbo config, Claude config, etc.)
   - `list`, `create`, `delete`
   - Remove abstract `/model` command entirely

4. **`/me`** - Unified user settings
   - Merge `/profile` + `/settings`
   - `persona` (view, edit, create, list, default)
   - `settings` (timezone, preferred model preset)
   - `overrides` (per-character model overrides - move from `/model`)

5. **`/wallet`** - Keep as-is (sensitive BYOK operations)

6. **`/admin`** - Keep as-is (owner-only server management)

#### Key Changes

| Old                  | New                            | Notes                                          |
| -------------------- | ------------------------------ | ---------------------------------------------- |
| `/personality`       | DELETE                         | Merge into `/character` with permission checks |
| `/llm-config`        | `/preset`                      | Rename for clarity                             |
| `/model set/reset`   | `/me overrides`                | Move to user-centric location                  |
| `/model set-default` | `/me settings preferred-model` | Part of user settings                          |
| `/model list`        | `/me overrides list`           | Shows user's overrides                         |
| `/settings timezone` | `/me settings timezone`        | Consolidate under `/me`                        |
| `/profile *`         | `/me persona *`                | Rename for clarity                             |
| `/utility help`      | `/help`                        | Promote to top-level                           |
| `/utility ping`      | `/admin ping` or keep          | Low priority                                   |

#### Implementation Order

1. **Phase 1**: Promote `/help` to top-level (quick win)
2. **Phase 2**: Rename `/llm-config` → `/preset`
3. **Phase 3**: Merge `/profile` + `/settings` → `/me`
4. **Phase 4**: Move `/model` overrides → `/me overrides`
5. **Phase 5**: Merge `/personality` → `/character` (with permission checks)
6. **Cleanup**: Delete deprecated commands after transition period

#### Deprecation Strategy

- Mark old commands as `(Deprecated)` in description
- Old commands reply with "Please use `/new-command` instead"
- Keep deprecated commands for 2-4 weeks before removal

---

## Recent Work (2025-12-05)

**Character List Pagination** - COMPLETE:

- `/character list` was failing for users with many characters (67+) due to Discord's 2000 character message limit
- Implemented pagination with embeds (4096 char limit) and Previous/Next buttons
- 15 characters per page with page indicator button
- Stateless pagination - re-fetches data on page change for freshness
- Also fixed creator name display (was showing "System" for all - now shows actual Discord usernames)
- Added `ownerId` and `ownerDiscordId` to `PersonalitySummary` type
- Updated API to return owner Discord ID for fetching display names

**Commits**:

- `83c93bf1` fix(character): add pagination to list command to fix 2000 char limit

---

## Recent Work (2025-12-04)

**Personality Access Control** - COMPLETE:

- Added `isPublic` and `ownerId` fields to `DatabasePersonality` type
- Updated `PersonalityLoader` with access control filter: `isPublic = true OR ownerId = userId`
- Fixed "Reply Loophole" security issue - replies to private personality messages now check access
- Updated all processors to pass `userId` for access validation (PersonalityMentionProcessor, ReplyMessageProcessor)
- Rewrote `BotMentionProcessor` to show help message instead of loading non-existent "default" personality
  - When users @mention the bot directly, they now get guidance on how to interact with personalities
- Added "Personality Access Allowlist" feature to Icebox in ROADMAP.md for future enhancement
- All 3,039 tests passing

---

## Recent Work (2025-12-03)

**Test Coverage Improvements**:

- Added `config.test.ts` (18 tests) - env schema validation
- Added `ModalFactory.test.ts` (21 tests) - dashboard modal building
- Expanded `settings/index.test.ts` (+6 autocomplete tests)
- Coverage: common-types 77.36%, bot-client 76.10%

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
