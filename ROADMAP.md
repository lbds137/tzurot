# Tzurot v3 Master Roadmap

> **Last Updated**: 2025-12-12
> **Current Version**: v3.0.0-beta.17
> **Status**: Public Beta (BYOK enabled, Guest Mode available)

---

## Current Priority: Kill v2

**Goal**: Finish v2 feature parity → delete tzurot-legacy → reduce maintenance burden.

---

## Next Up (In Order)

### 1. Shapes.inc Import

**Why first**: Can't kill v2 until users can migrate their data. This unblocks everything.

- [ ] Parse shapes.inc backup JSON format
- [ ] Import wizard slash command (`/character import`)
- [ ] Map shapes.inc fields to v3 personality schema
- [ ] Handle avatar migration
- [ ] Validation and preview before import

### 2. DM Personality Chat

**Why**: Biggest feature gap from v2. Multiple user requests.

- [ ] Detect DM context in message handler
- [ ] Use conversation history to identify which personality user was chatting with
- [ ] Allow personality selection in DMs (`/character chat` in DMs)
- [ ] Handle first-time DM (no history yet)

### 3. Slash Command Dashboard Pattern

**Why**: Fix UX before adding complex features like NSFW settings.

- [ ] Session manager abstraction for multi-step flows
- [ ] Redis-backed session storage
- [ ] `/preset edit` - users can finally edit their presets
- [ ] `/me profile` dashboard upgrade
- [ ] Standardize modal/button patterns across commands

### 4. NSFW Verification

**Why**: Required for certain content. Keep it simple and TOS-compliant.

**Approach**: User-level verification (not per-personality). User verifies once via Discord's native age-gating, unlocked everywhere after.

- [ ] Track `nsfwVerified` boolean on User record
- [ ] "Handshake" verification: user must interact with bot in a Discord age-gated channel
- [ ] Once verified, NSFW content unlocked globally for that user
- [ ] Consider "Incognito Mode" toggle (disable LTM for NSFW chats - privacy feature)

### 5. LTM & Context Management

**Why**: Retention feature. Better memory = better conversations.

- [ ] `/history clear` - reset conversation context
- [ ] `/memory search` - find specific memories
- [ ] `/memory purge` - delete memories
- [ ] Context window optimization
- [ ] Consider summary compression (cheap model summarizes before injection)

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
