# Tzurot v3 Master Roadmap

> **Last Updated**: 2025-12-13
> **Current Version**: v3.0.0-beta.17
> **Status**: Public Beta (BYOK enabled, Guest Mode available)

---

## Current Priority: Kill v2

**Goal**: Finish v2 feature parity → delete tzurot-legacy → reduce maintenance burden.

---

## Next Up (In Order)

### 1. Memory Management Commands ⬅️ ACTIVE

**Why first**: User-requested, high retention value. Comprehensive memory control enables privacy features.

**Reference**: [docs/planning/MEMORY_MANAGEMENT_COMMANDS.md](docs/planning/MEMORY_MANAGEMENT_COMMANDS.md)

**Short-Term Memory (STM):**

- [ ] Context epoch system (timestamp-based soft reset with undo)
- [ ] `/history clear` - soft reset conversation context
- [ ] `/history undo` - restore cleared context
- [ ] `/history hard-delete` - permanent deletion with confirmation

**Long-Term Memory (LTM):**

- [ ] `/memory search` - semantic search with filtering
- [ ] `/memory browse` - paginated memory deck UI
- [ ] `/memory edit` - edit memory content (regenerate embedding)
- [ ] `/memory delete` - single memory deletion
- [ ] `/memory purge` - bulk deletion with typed confirmation
- [ ] `/memory lock/unlock` - core memory protection

**Incognito Mode:**

- [ ] `/incognito enable` - timed session to disable LTM
- [ ] `/incognito disable` - end incognito session
- [ ] `/incognito status` - check current state
- [ ] `/incognito forget` - retroactive LTM deletion
- [ ] Visual indicator in responses when active

### 2. Shapes.inc Import

**Why**: Can't kill v2 until users can migrate their data. This unblocks deletion.

- [ ] Parse shapes.inc backup JSON format
- [ ] Import wizard slash command (`/character import`)
- [ ] Map shapes.inc fields to v3 personality schema
- [ ] Handle avatar migration
- [ ] Validation and preview before import

### 3. DM Personality Chat

**Why**: Biggest feature gap from v2. Multiple user requests.

- [ ] Detect DM context in message handler
- [ ] Use conversation history to identify which personality user was chatting with
- [ ] Allow personality selection in DMs (`/character chat` in DMs)
- [ ] Handle first-time DM (no history yet)

### 4. Slash Command Dashboard Pattern

**Why**: Fix UX before adding complex features like NSFW settings.

- [ ] Session manager abstraction for multi-step flows
- [ ] Redis-backed session storage
- [ ] `/preset edit` - users can finally edit their presets
- [ ] `/me profile` dashboard upgrade
- [ ] Standardize modal/button patterns across commands

### 5. NSFW Verification

**Why**: Required for certain content. Keep it simple and TOS-compliant.

**Approach**: User-level verification (not per-personality). User verifies once via Discord's native age-gating, unlocked everywhere after.

- [ ] Track `nsfwVerified` boolean on User record
- [ ] "Handshake" verification: user must interact with bot in a Discord age-gated channel
- [ ] Once verified, NSFW content unlocked globally for that user

### 6. Agentic Scaffolding

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

Reference: [docs/planning/OPENMEMORY_MIGRATION_PLAN.md](docs/planning/OPENMEMORY_MIGRATION_PLAN.md)

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

### Phase 0: Foundation

- Contract tests for BullMQ jobs and API endpoints
- Component tests with PGlite (in-memory Postgres)
- Message reference handling with BFS traversal

### Phase 1: Gatekeeper (Public Beta Launch)

- **BYOK infrastructure** - Encrypted API key storage (AES-256-GCM)
- **User API key management** - `/wallet` commands
- **LLM config system** - `/preset` and `/me model` commands
- **Guest mode** - Free model fallback
- **Persona management** - `/me profile` commands
- **Memory scope** - `shareLtmAcrossPersonalities`
- **Reasoning model support** - o1/o3, Claude 3.7+, Gemini thinking

---

## Smaller Items (Do When Convenient)

### UX Fixes

- [ ] `advancedParameters` - schema exists, API routes ignore it
- [ ] Autocomplete UX - include slug for same-name personalities
- [ ] DRY violation - `me/model/autocomplete.ts` duplicates shared utility

### V2 Parity (Lower Priority)

- [ ] Auto-Response System (`/channel activate/deactivate`)
- [ ] Rate Limiting (token bucket)
- [ ] Request Deduplication
- [ ] PluralKit proxy support

### Technical Debt

- [ ] 142 lint warnings (complexity issues)
- [ ] Consolidate `scripts/data/import-personality/` workspace
- [ ] Increase test coverage for `WebhookManager`
- [ ] Document `advancedParameters` JSONB structures

---

## Icebox

Ideas for later. Resist the shiny object.

- Character Card Import (V2/V3 PNG metadata)
- Streaming responses
- Local/OpenRouter Embeddings
- Lorebooks / Sticky Context
- Multi-personality responses
- Dream sequences (self-reflection)
- Relationship graphs
- Metrics & monitoring (Prometheus)

---

## How to Use This Roadmap

1. **Work in order** - Items in "Next Up" are prioritized. Do #1 before #2.
2. **Smaller items** - Tackle opportunistically between major features
3. **New ideas** - Add to Icebox, don't derail current work
4. **Update CURRENT_WORK.md** - When switching context

---

## Related Docs

- [docs/planning/OPENMEMORY_MIGRATION_PLAN.md](docs/planning/OPENMEMORY_MIGRATION_PLAN.md)
- [docs/planning/V2_FEATURE_TRACKING.md](docs/planning/V2_FEATURE_TRACKING.md)
- [docs/reference/v2-patterns-reference.md](docs/reference/v2-patterns-reference.md)
