# Tzurot v3 Master Roadmap

> **Last Updated**: 2026-01-08
> **Current Version**: v3.0.0-beta.40
> **Status**: Public Beta (BYOK enabled, Guest Mode available)

---

## Current Priority: User-Requested Features

**Goal**: Deliver user value first. v2 parity is not urgent - legacy system isn't hurting anything.

---

## Next Up (In Order)

### 1. Quick Wins (Tech Debt & Naming)

**Why first**: Fast cleanup before building new features. Fix terminology before more UI work.

- [ ] Drop deprecated `BotSettings` table (replaced by `AdminSettings`)
- [ ] Rename `/me model` → `/me preset` (fix confusing terminology)
  - Rename command group
  - Update parameter names (`config` → `preset`)
  - Update help text and documentation

### 2. Memory Management Commands (Phase 2 + Read Toggle)

**Why**: User-requested, high retention value. Bundle LTM commands with memory read toggle.

**Reference**: [docs/proposals/active/MEMORY_MANAGEMENT_COMMANDS.md](docs/proposals/active/MEMORY_MANAGEMENT_COMMANDS.md)

**Phase 1 - STM (COMPLETE - beta.19):**

- [x] `/history clear`, `/history undo`, `/history hard-delete`, `/history view`
- [x] Per-persona epoch tracking

**Phase 2 - LTM (NOT STARTED):**

- [ ] `/memory search` - semantic search with filtering
- [ ] `/memory browse` - paginated memory deck UI
- [ ] `/memory edit` - edit memory content (regenerate embedding)
- [ ] `/memory delete` - single memory deletion
- [ ] `/memory purge` - bulk deletion with typed confirmation
- [ ] `/memory lock/unlock` - core memory protection
- [ ] **Memory Read Toggle** ("Focus Mode") - disable LTM retrieval per-user/personality
  - Different from Incognito (write) - this controls read
  - UX: 🛑 "Stop Recording" (Incognito) vs 🔒 "Focus Mode" (Read Toggle)

**Phase 3 - Incognito Mode (NOT STARTED):**

- [ ] `/incognito enable/disable/status/forget`
- [ ] Visual indicator in responses when active

### 3. Channel Allowlist/Denylist

**Why**: User-requested. Prevents bot from spamming unwanted channels, reduces server kicks.

- [ ] Add `mode` (allowlist/denylist) and `channels` array to ChannelSettings or new table
- [ ] `/channel restrict` command for server admins
- [ ] Middleware check in message handler
- [ ] Consider "Ghost Mode" - bot listens but only replies when pinged

### 4. Slash Command Dashboard Pattern + User System Prompts

**Why**: Fix UX before adding complex features. Bundle system prompts into preset editor.

- [ ] Session manager abstraction for multi-step flows
- [ ] Redis-backed session storage
- [ ] `/preset edit` - dashboard with all LLM params (temperature, topP, etc.)
- [ ] `/me profile` dashboard upgrade
- [ ] **User System Prompts** - "Sidecar prompt" appended to system message per-user
- [ ] Standardize modal/button patterns across commands

### 5. DM Personality Chat

**Why**: User-requested. Multiple requests for this feature.

- [ ] Detect DM context in message handler
- [ ] Use conversation history to identify which personality user was chatting with
- [ ] Allow personality selection in DMs (`/character chat` in DMs)
- [ ] Handle first-time DM (no history yet)

---

## v2 Parity (When Ready)

**Goal**: Eventually kill v2, but not urgent. Do these when convenient.

### NSFW Verification

**Why**: Required for certain content. Keep it simple and TOS-compliant.

**Approach**: User-level verification (not per-personality). User verifies once via Discord's native age-gating, unlocked everywhere after.

- [ ] Track `nsfwVerified` boolean on User record
- [ ] "Handshake" verification: user must interact with bot in a Discord age-gated channel
- [ ] Once verified, NSFW content unlocked globally for that user

### Shapes.inc Import

**Why**: Users need migration path from v2. Do after other features stabilize.

- [ ] Parse shapes.inc backup JSON format
- [ ] Import wizard slash command (`/character import`)
- [ ] Map shapes.inc fields to v3 personality schema
- [ ] Handle avatar migration
- [ ] Validation and preview before import

---

## Later (Post User Features)

### Agentic Scaffolding

**Why**: Build capabilities before building the storage for them. Do this before OpenMemory.

- [ ] Define `SkillDefinition` interface
- [ ] Tool registration system
- [ ] Basic agentic loop (think → act → observe)
- [ ] Memory search as first tool
- [ ] Keep stateless initially (no OpenMemory dependency)

---

## Later (Post v2 Parity)

### OpenMemory Migration

Big architecture change for LTM. Waypoint graph with multi-sector storage (episodic, semantic, emotional, procedural, reflective).

**Deferred because**: Scary change that touches core LTM. Wait until we see how users use the simpler LTM improvements first. Agentic scaffolding should come first.

Reference: [docs/proposals/backlog/OPENMEMORY_MIGRATION_PLAN.md](docs/proposals/backlog/OPENMEMORY_MIGRATION_PLAN.md)

### Image Generation + Voice Synthesis

Nice-to-have features. High cost, high complexity. Can wait.

- ElevenLabs voice cloning integration
- Image generation via DALL-E/Midjourney/etc.

### Release Notifications

Not needed until post-beta when we care about semantic versioning again.

- DM users about new releases
- Changelog integration

---

## Completed

- **Phase 0**: Foundation (contract tests, PGlite component tests, message reference handling)
- **Phase 1**: Gatekeeper / Public Beta Launch (BYOK, `/wallet`, `/preset`, `/me model`, `/me profile`, guest mode, reasoning models)
- **Memory Management Phase 1**: STM commands (`/history clear/undo/hard-delete/view`)

---

## Smaller Items (Do When Convenient)

### UX Fixes

- [x] Autocomplete UX - include slug for same-name personalities ✅ Already shows `(slug)` in label
- [x] DRY violation - `me/model/autocomplete.ts` duplicates shared utility ✅ Now uses shared `handlePersonalityAutocomplete`

### Feature Additions

- [ ] `advancedParameters` support - schema exists in common-types, API routes need to accept/store it

### V2 Parity (Lower Priority)

- [ ] Auto-Response System (`/channel activate/deactivate`)
- [ ] Rate Limiting (token bucket)
- [ ] Request Deduplication
- [ ] PluralKit proxy support

### Technical Debt

- [ ] 72 lint warnings (complexity issues) - down from 142
- [ ] Consolidate `scripts/data/import-personality/` workspace
- [ ] Increase test coverage for `WebhookManager`
- [ ] Document `advancedParameters` JSONB structures

### Reliability & Architecture Review (from Gemini consultation 2025-12-18)

**High Priority:**

- [ ] **Job idempotency check** - Add Redis-based `processed:${discordMessageId}` check in `AIJobProcessor` to prevent duplicate replies on crash-retry scenarios
- [ ] **Verify vector index usage** - Run `EXPLAIN ANALYZE` on production memory queries to confirm `idx_memories_embedding` is being used (not seq scan)

**Medium Priority:**

- [ ] **DLQ viewing script** - Create `scripts/debug/view-failed-jobs.ts` to inspect failed BullMQ jobs for debugging "why didn't user get a reply?" issues
- [ ] **common-types logic audit** - Review whether services like `ConversationHistoryService`, `PersonalityService`, `UserService` should move from common-types to api-gateway (currently couples all service deployments)

**Low Priority / Monitor:**

- [ ] Pipeline abstraction review - Evaluate if pipeline steps add value or are unnecessary wrappers (current assessment: steps have distinct responsibilities, keep as-is)
- [ ] Model config as data - Consider moving model definitions to DB table for runtime changes (current assessment: over-engineering for one-person project, defer)

---

## Icebox

Ideas for later. Resist the shiny object.

- Character Card Import (V2/V3 PNG metadata)
- Streaming responses
- Local/OpenRouter Embeddings
- Lorebooks / Sticky Context
- Multi-personality per channel (activate multiple personalities in one channel, each responds based on trigger patterns or probability)
- Dream sequences (self-reflection)
- Relationship graphs
- Metrics & monitoring (Prometheus)
- Smart git hooks (skip checks for doc-only changes)

---

## How to Use This Roadmap

1. **Work in order** - Items in "Next Up" are prioritized. Do #1 before #2.
2. **Smaller items** - Tackle opportunistically between major features
3. **New ideas** - Add to Icebox, don't derail current work
4. **Update CURRENT_WORK.md** - When switching context

---

## Related Docs

- [docs/proposals/backlog/OPENMEMORY_MIGRATION_PLAN.md](docs/proposals/backlog/OPENMEMORY_MIGRATION_PLAN.md)
- [docs/proposals/active/V2_FEATURE_TRACKING.md](docs/proposals/active/V2_FEATURE_TRACKING.md)
- [docs/reference/v2-patterns-reference.md](docs/reference/v2-patterns-reference.md)
