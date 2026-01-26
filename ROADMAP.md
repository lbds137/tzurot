# Tzurot v3 Master Roadmap

> **Last Updated**: 2026-01-25
> **Current Version**: v3.0.0-beta.50
> **Status**: Public Beta (BYOK enabled, Guest Mode available)

---

## Current Priority: User-Requested Features

**Goal**: Deliver user value first. v2 parity is not urgent - legacy system isn't hurting anything.

---

## Next Up (In Order)

### 1. User System Prompts ⬅️ NEXT

**Why**: User-requested feature to customize AI behavior per-user.

- [ ] "Sidecar prompt" appended to system message per-user
- [ ] `/me profile` dashboard upgrade to edit system prompt

### 2. Channel Allowlist/Denylist

**Why**: User-requested. Prevents bot from spamming unwanted channels, reduces server kicks.

- [ ] Add `mode` (allowlist/denylist) and `channels` array to ChannelSettings or new table
- [ ] `/channel restrict` command for server admins
- [ ] Middleware check in message handler
- [ ] Consider "Ghost Mode" - bot listens but only replies when pinged

### 3. DM Personality Chat

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

### Voice Synthesis (Open Source)

Open-source voice cloning is now CPU-capable. Two-tier approach: free users get open-source, premium BYOK ElevenLabs.

- [ ] Python microservice: `services/voice-engine/`
- [ ] TTS: Kyutai Pocket TTS (zero-shot cloning, 100M params, CPU-capable)
- [ ] STT: SenseVoice (emotion detection + punctuation, replaces Whisper)
- [ ] ElevenLabs BYOK for premium users

**Reference**: [docs/research/voice-cloning-2026.md](docs/research/voice-cloning-2026.md)

### Image Generation

- [ ] Image generation via DALL-E/Midjourney/etc.

### Release Notifications

Not needed until post-beta when we care about semantic versioning again.

- DM users about new releases
- Changelog integration

---

## Completed

See [GitHub Releases](https://github.com/lbds137/tzurot/releases) for detailed history.

**Major milestones:**

- Slash Command UX Epic (dashboards, browse pattern, autocomplete standardization)
- Prompt Format Standardization (unified timestamps, XML location, extended context)
- Memory Management (STM commands, LTM commands, Incognito Mode)
- LTM Embedding Migration (OpenAI eviction, local bge-small embeddings)
- Duplicate Detection Epic (multi-layer detection, escalating retry)
- LLM Diagnostic Flight Recorder
- Public Beta Launch (BYOK, guest mode, reasoning models)

---

## Smaller Items (Do When Convenient)

### V2 Parity (Lower Priority)

- [ ] Rate Limiting (token bucket)
- [ ] PluralKit proxy support

### Technical Debt

- [ ] 37 lint warnings (complexity issues) - down from 142
- [ ] Consolidate `scripts/data/import-personality/` workspace
- [ ] Increase test coverage for `WebhookManager`

### Testing Debt (Chip-Away Targets)

**Component test gaps** - services without `.component.test.ts` (use `pnpm ops test:audit-services` to see current list):

**High Priority** (core functionality):

- [ ] `services/ai-worker/src/services/LongTermMemoryService.ts` - core memory operations
- [ ] `services/ai-worker/src/services/ConversationalRAGService.ts` - AI generation flow
- [ ] `services/api-gateway/src/services/PersonalityService.ts` - used everywhere

**Medium Priority** (important features):

- [ ] `services/ai-worker/src/services/ShortTermMemoryService.ts` - conversation history
- [ ] `services/api-gateway/src/services/SystemPromptService.ts` - prompt management
- [ ] `services/api-gateway/src/services/UserService.ts` - user management

**Workflow**: Pick 2-3 per week, write component tests, update baseline with `pnpm ops test:audit-services --update`. See `tzurot-testing` skill for patterns.

### Reliability & Architecture Review (from Gemini consultation 2025-12-18)

**High Priority:**

- [ ] **Job idempotency check** - Add Redis-based `processed:${discordMessageId}` check in `AIJobProcessor` to prevent duplicate replies on crash-retry scenarios
- [ ] **Verify vector index usage** - Run `EXPLAIN ANALYZE` on production memory queries to confirm `idx_memories_embedding` is being used (not seq scan)

**Medium Priority:**

- [ ] **DLQ viewing script** - Create `scripts/debug/view-failed-jobs.ts` to inspect failed BullMQ jobs for debugging "why didn't user get a reply?" issues
- [ ] **common-types logic audit** - Review whether services like `ConversationHistoryService`, `PersonalityService`, `UserService` should move from common-types to api-gateway (currently couples all service deployments)

**Low Priority / Monitor:**

- [ ] Pipeline abstraction review - Evaluate if pipeline steps add value or are unnecessary wrappers (current assessment: steps have distinct responsibilities, keep as-is)

---

## Icebox

Ideas for later. Resist the shiny object.

### Character & Prompt Features

- Character Card Import (V2/V3 PNG metadata) - Parse community cards
- Lorebooks / Sticky Context - Keyword-triggered lore injection with TTL
- Author's Note Depth Injection - Insert instructions at configurable context depth

### Multi-Entity Features

- Multi-personality per channel (activate multiple, each responds based on triggers or probability)
- Natural Order speaker selection (deterministic heuristics vs LLM routing)
- Dream sequences (self-reflection)
- Relationship graphs

### Agentic & Dynamic Features

- Contrastive Retrieval for RAG - Avoid echo chamber loop in memory retrieval
- Dynamic Directive Injection - Inject prompts based on conversation patterns (anti-sycophancy)
- Analysis Step - Detect user engagement/sentiment before generation

### Infrastructure

- Streaming responses
- Free-Tier Model Strategy - 8+ free model configs, fallback chains
- Metrics & monitoring (Prometheus)

**Research References**:

- [docs/research/sillytavern-features.md](docs/research/sillytavern-features.md) - Character cards, lorebooks, Author's Note
- [docs/research/free-tier-models-2026.md](docs/research/free-tier-models-2026.md) - Free model configs

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
