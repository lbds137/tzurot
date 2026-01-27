# Backlog

> **Last Updated**: 2026-01-26
> **Version**: v3.0.0-beta.51

Single source of truth for all work. Tech debt competes for the same time as features.

**Tags**: 🏗️ `[LIFT]` refactor/debt | ✨ `[FEAT]` feature | 🐛 `[FIX]` bug | 🧹 `[CHORE]` maintenance

---

## Inbox

_New items go here. Triage to appropriate section later._

- ✨ `[FEAT]` **Message Reactions in XML** - Add reaction metadata to extended context messages showing emoji and who reacted (use same user/persona resolution as elsewhere)
- 🏗️ `[LIFT]` **Make ownerId NOT NULL** - `LlmConfig.ownerId` and `Personality.ownerId` are nullable but all records have owners. Migration to make non-nullable + clean up code paths handling null (removes dead "global/unowned" concept)

---

## High Priority

_Top 3-5 items to pull into CURRENT next._

### 1. 🏗️ Slash Command & Dashboard UX Standardization ⬅️ NEXT

Inconsistent patterns across slash commands and dashboard interactions. Need comprehensive review and standardization.

**File Structure**

- [ ] Audit existing command directories for structure patterns
- [ ] Define standard: when to use subdirectories vs flat files for subcommand groups
- [ ] Update `tzurot-slash-command-ux` skill with mandatory file structure rules
- [ ] Refactor existing commands to match new standard
- [ ] Clean up legacy files (e.g., `persona/list.ts` from old `/me` command)

**Shared Browse Utilities**

- [ ] Extract shared browse utilities (pagination, sorting) into `utils/browse/`
  - `sortItems<T>()` generic sorting function used by `/persona browse`, `/character browse`, `/admin servers`
  - `buildPaginationButtons()` shared pagination button builder
  - Common constants (`ITEMS_PER_PAGE`, `MAX_SELECT_LABEL_LENGTH`)
- [ ] Reusable browse context pattern - store page/sort/filter state for "Back to Browse" button
  - Persona browse now stores context (fixed), but pattern should be extracted as reusable utility
  - Implement generic pattern based on persona's `browseContext` in session data

**Dashboard/Button Interaction Testing**

- [ ] Add tests for `isDashboardInteraction` check functions across all commands
  - Bug found: `isPersonaDashboardInteraction` matched ALL `persona::*` customIds, not just dashboard actions
  - This caused "expand" and "back" buttons to silently fail
- [ ] Add test patterns that verify:
  - Each customId action has a handler
  - Non-dashboard actions don't match dashboard checks
  - Button routing works end-to-end

**Command Definition Validation**

- [ ] Add tests that verify handler option names match command definitions
  - Bug found: `/persona default` handler used `getString('profile', true)` but command option is named `'persona'`
  - This caused `CommandInteractionOptionNotFound` error at runtime
- [ ] Consider generating types from command definitions to catch mismatches at compile time
- [ ] Add static analysis or test that scans handlers for `getString`/`getInteger`/etc calls and validates option names exist in command builder

**Autocomplete UX**

- [ ] Review and document timezone autocomplete ordering logic
  - Current ordering is unclear/confusing to users
  - Consider: alphabetical, by UTC offset, by popularity, or user's recent selections first
- [ ] Establish standard autocomplete ordering patterns for different data types
  - Timezones, personas, characters, presets, etc.

**CustomIds Standardization & Testing**

- [ ] Audit all custom ID patterns across commands for consistency
  - Bug found: `wallet::` prefix used for `/settings apikey` modal - customId prefix didn't match command name, requiring `componentPrefixes` hack
  - Fixed by renaming to `settings::apikey::*` pattern so routing works naturally
- [ ] Evaluate if `componentPrefixes` should be eliminated entirely
  - Commands should use customId prefixes that match their name or use nested patterns like `{command}::{subcommand}::{action}`
  - Document when it's acceptable to use a different prefix (legacy migration?)
- [ ] Add registry integrity tests that verify:
  - All dashboard entityTypes are routable to their command
  - All customId prefixes route to valid commands
  - No orphaned componentPrefixes that could cause "Unknown interaction" errors
- [ ] Add round-trip tests for ALL customId patterns (not just some)
  - Currently only a subset of builders have round-trip tests
  - Should cover every builder function

**Dashboard UX Polish**

- [ ] Delete button redundant ownership checks - `character/browse.ts:679` combines `canEdit` with explicit `ownerId` check
- [ ] Clone name edge case - `preset/dashboardButtons.ts:364-375` regex for "(Copy N)" fails on "Preset (Copy) (Copy)"
- [ ] Modal submit silent failure - `character/dashboard.ts:164-168` failed updates logged but user not notified
- [ ] Dashboard refresh race condition - Session-cached `isGlobal` becomes stale if preset visibility changed elsewhere

**Context**: The `/persona override` subcommand group uses `override/set.ts` and `override/clear.ts` (subdirectory pattern). Other commands may use flat patterns inconsistently. Recent bugs exposed that interaction routing has gaps in test coverage that should be addressed systematically.

### 2. 🏗️ Extended Context Pipeline Refactor

The pipeline has two parallel code paths (extended context on/off) that constantly get out of sync. This is blocking reliable feature development.

- [ ] Remove the extended context toggle - always use extended context
- [ ] Remove dead code paths (all "if not extended context" branches)
- [ ] Unify the pipeline - single path from Discord → LLM input
- [ ] Consolidate types - `ConversationHistoryEntry` carries ALL data through pipeline

**Files**: `DiscordChannelFetcher.ts`, `MessageContextBuilder.ts`, `conversationUtils.ts`, pipeline steps

### 3. ✨ LTM Summarization (Shapes.inc Style)

Verbatim conversation storage is redundant with extended context. Replace with LLM-generated summaries.

- [ ] Configurable grouping (5, 10, 50 messages or 1h, 4h, 24h time windows)
- [ ] Separate LLM call for summarization (fast/cheap model)
- [ ] Store summaries as LTM instead of verbatim turns

**Depends on**: Pipeline Refactor

### 4. 🏗️ Memories Table Migration

Two formats coexist (shapes.inc imports vs tzurot-v3 verbatim). Need unified format.

- [ ] Design unified memory format (draw from both sources)
- [ ] One-time migration of existing tzurot-v3 memories
- [ ] Run existing verbatim memories through summarizer

**Depends on**: LTM Summarization

### 5. 🐛 Admin Debug Doesn't Work with Failures

`/admin debug` can't show diagnostics for failed jobs. The most important cases (failures) have no data.

- [ ] Record diagnostics on failure path, not just success path
- [ ] Capture partial state at failure point

---

## Epic: User-Requested Features

_Features requested by actual users._

### ✨ User System Prompts

"Sidecar prompt" appended to system message per-user.

- [ ] Add `systemPrompt` field to User or UserPersonalityConfig
- [ ] `/me profile` dashboard upgrade to edit system prompt

### ✨ Channel Allowlist/Denylist

Prevents bot from spamming unwanted channels, reduces server kicks.

- [ ] Add `mode` (allowlist/denylist) and `channels` array to ChannelSettings
- [ ] `/channel restrict` command for server admins
- [ ] Middleware check in message handler
- [ ] Consider "Ghost Mode" - bot listens but only replies when pinged

### ✨ DM Personality Chat

Chat with personalities in DMs.

- [ ] Detect DM context in message handler
- [ ] Use conversation history to identify which personality user was chatting with
- [ ] Allow personality selection in DMs (`/character chat` in DMs)
- [ ] Handle first-time DM (no history yet)

---

## Epic: v2 Parity

_Eventually kill v2, but not urgent._

### ✨ NSFW Verification

User-level verification. User verifies once via Discord's native age-gating, unlocked everywhere after.

- [ ] Track `nsfwVerified` boolean on User record
- [ ] "Handshake" verification: interact with bot in a Discord age-gated channel

### ✨ Shapes.inc Import

Migration path from v2.

- [ ] Parse shapes.inc backup JSON format
- [ ] Import wizard slash command (`/character import`)
- [ ] Map shapes.inc fields to v3 personality schema
- [ ] Handle avatar migration

### 🧹 Rate Limiting

- [ ] Token bucket rate limiting

### ✨ PluralKit Proxy Support

- [ ] Support PluralKit proxied messages

---

## Epic: API & Validation Hardening

### 🏗️ Inconsistent Request Validation

Mix of manual type checks, Zod schemas, and `as Type` casting.

- [ ] Standardize on Zod schemas for all POST/PUT bodies
- [ ] Create `schemas/` directory, use `safeParse` consistently
- [ ] Audit: `routes/user/*.ts`, `routes/admin/*.ts`, `routes/internal/*.ts`

### 🐛 API Response Consistency

Same resource returns different fields from GET vs POST vs PUT.

- [ ] Shared response builder functions per resource type

### 🐛 Date String Validation for Memory Search

`dateFrom`/`dateTo` accepted without validation - invalid dates cause PostgreSQL errors.

### 🏗️ Zod Schema/TypeScript Interface Mismatch

Zod strips fields not in schema. When we add fields to TS interfaces but forget Zod, data disappears.

- [ ] Contract tests ensuring Zod schema keys match interface fields
- [ ] Use `.passthrough()` or `.strict()` during development
- [ ] Audit: `schemas.ts`, `jobs.ts`, route schemas

---

## Epic: Observability & Debugging

### 🏗️ Basic Structured Logging

Add event types: `rate_limit_hit`, `dedup_cache_hit`, `pipeline_step_failed`, `llm_request` with latency/tokens.

### ✨ Admin Debug Filtering

Add `/admin debug recent` with personality/user/channel filters.

### 🧹 DLQ Viewing Script

Create `scripts/debug/view-failed-jobs.ts` to inspect failed BullMQ jobs.

---

## Epic: Duplicate Detection Hardening

### 🐛 Temperature Strategy

Cache-busting temp 1.1 rejected by some providers. Need random jitter 0.95-1.0.

### 🏗️ Unbounded History Scanning

Scans entire history looking for 5 assistant messages. Add `MAX_SCAN_DEPTH = 100`.

### 🧹 Logging Verbosity

INFO log for EVERY response. Downgrade PASSED to DEBUG, keep NEAR-MISS/DUPLICATE at INFO.

---

## Epic: Memory System

### 🏗️ Per-User Quotas

No limits on memories per persona. Add `maxMemoriesPerPersona` (default: 10,000).

### 🐛 Redundant Referenced Messages

Reply to message in context stores it twice (context + `[Referenced content:]`).

---

## Epic: Incognito Mode Improvements

### 🐛 String Matching for Status

`data.message.includes('already')` is brittle. Add explicit `wasAlreadyActive` boolean.

### 🏗️ Parallel API Calls for Session Names

Status command fires up to 100 parallel API calls. Have API return names with sessions.

---

## Smaller Items

_Opportunistic work between major features._

### 🐛 Thinking Tag Leaking

`<thinking>` tags from reasoning models occasionally appear in output.

**Location**: `reasoningModelUtils.ts:stripThinkingTags()` or upstream.

### 🏗️ N+1 Query Pattern in UserReferenceResolver

Sequential DB queries in a loop for user references. Use batch extraction pattern.

### 🏗️ Split Large Fetcher/Formatter Files

`DiscordChannelFetcher.ts` (~600 lines) and `conversationUtils.ts` (~720 lines) need splitting.

### 🏗️ Job Idempotency Check

Add Redis-based `processed:${discordMessageId}` check in `AIJobProcessor` to prevent duplicate replies.

### 🏗️ Verify Vector Index Usage

Run `EXPLAIN ANALYZE` on production memory queries to confirm index is used.

### 🧹 37 Lint Warnings

Complexity issues - down from 142. Chip away opportunistically.

### 🧹 Consolidate import-personality Scripts

`scripts/data/import-personality/` workspace needs cleanup.

### Testing Debt

Component test gaps (use `pnpm ops test:audit-services`):

- `LongTermMemoryService.ts`, `ConversationalRAGService.ts`, `PersonalityService.ts` (high)
- `ShortTermMemoryService.ts`, `SystemPromptService.ts`, `UserService.ts` (medium)

---

## Icebox

_Ideas for later. Resist the shiny object._

### Character & Prompt Features

- Character Card Import (V2/V3 PNG metadata)
- Lorebooks / Sticky Context - Keyword-triggered lore injection with TTL
- Author's Note Depth Injection

### Multi-Entity Features

- Multi-personality per channel
- Natural Order speaker selection
- Dream sequences (self-reflection)
- Relationship graphs

### Agentic Features

- Agentic Scaffolding (think → act → observe loop)
- OpenMemory Migration (waypoint graph, multi-sector storage)
- Contrastive Retrieval for RAG
- Dynamic Directive Injection (anti-sycophancy)

### Infrastructure

- Streaming responses
- Voice Synthesis (open-source TTS/STT)
- Image Generation
- Free-Tier Model Strategy
- Metrics & monitoring (Prometheus)
- Release Notifications

---

## Deferred

_Decided not to do yet._

| Item                              | Why                                           |
| --------------------------------- | --------------------------------------------- |
| Schema versioning for BullMQ jobs | No breaking changes yet                       |
| Contract tests for HTTP API       | Single consumer, integration tests sufficient |
| Redis pipelining                  | Fast enough at current traffic                |
| BYOK `lastUsedAt` tracking        | Nice-to-have, not breaking                    |
| Dependency Cruiser                | ESLint catches most issues                    |
| Handler factory generator         | Add when creating many new routes             |
| Scaling preparation (timers)      | Single-instance sufficient for now            |

---

## References

- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full release history
- [docs/proposals/backlog/OPENMEMORY_MIGRATION_PLAN.md](docs/proposals/backlog/OPENMEMORY_MIGRATION_PLAN.md)
- [docs/proposals/active/V2_FEATURE_TRACKING.md](docs/proposals/active/V2_FEATURE_TRACKING.md)
- [docs/research/sillytavern-features.md](docs/research/sillytavern-features.md)
- [docs/research/voice-cloning-2026.md](docs/research/voice-cloning-2026.md)
