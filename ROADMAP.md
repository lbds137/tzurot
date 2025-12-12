# Tzurot v3 Master Roadmap

> **Last Updated**: 2025-12-12
> **Current Version**: v3.0.0-beta.17
> **Status**: Public Beta (BYOK enabled, Guest Mode available)

---

## Current Focus: Close the Loops

**The Problem**: Public beta is live, but some features are half-baked. Users hit dead ends.

**The Solution**: Finish what's started before adding new things.

### Priority 1: UX Dead Ends

| Task                     | What's Broken                                | Sprint |
| ------------------------ | -------------------------------------------- | ------ |
| **`/preset edit`**       | Users can create/delete presets but NOT edit | 7.4    |
| **`advancedParameters`** | Schema exists, API routes ignore it          | 7.15   |

### Priority 2: User Self-Service

| Task                 | User Pain                    | Sprint |
| -------------------- | ---------------------------- | ------ |
| **`/history clear`** | No way to reset conversation | 7.6    |

### Priority 3: User Requests (After Above)

| Request                 | Source                        | Sprint    |
| ----------------------- | ----------------------------- | --------- |
| **DM Personality Chat** | Beta user (multiple requests) | 6.5       |
| PluralKit JSON import   | User request                  | 10.4      |
| Shapes.inc import       | Future planning               | 7.17-7.19 |

**Rule**: Do NOT start Priority 3 until Priority 1 and 2 are done.

---

## Completed Phases

### Phase 0: Foundation (Complete)

- Contract tests for BullMQ jobs and API endpoints
- Component tests with PGlite (in-memory Postgres)
- Message reference handling with BFS traversal
- Scripts directory reorganization

### Phase 1: Gatekeeper (Complete)

- **Prisma 7.0 migration** - Modern ORM with driver adapter pattern
- **BYOK infrastructure** - Encrypted API key storage (AES-256-GCM)
- **User API key management** - `/wallet` commands (set, list, remove, test)
- **LLM config system** - `/preset` and `/me model` commands
- **Usage tracking** - `/admin usage` command with token stats
- **Timezone support** - `/me timezone` commands
- **Guest mode** - Free model fallback for users without API keys
- **Reasoning model support** - OpenAI o1/o3, Claude 3.7+, Gemini thinking models
- **Persona management** - `/me profile` commands (create, edit, list, default, view, override, share-ltm)
- **Memory scope** - `shareLtmAcrossPersonalities` via `/me profile share-ltm`
- **Custom error messages** - Per-personality error messages

---

## Phase 2: Refinement (Current)

**Goal**: Quick wins and v2 feature parity to improve user experience and retention.

### Sprint 4: Voice Enhancements (Not Started)

- [ ] Create `VoiceConfig` table (ElevenLabs settings per personality)
- [ ] Create `VoiceConfigSample` table (voice cloning samples)
- [ ] Extract voice settings from shapes.inc backups
- [ ] `/voice enable/disable/reset` commands
- [ ] ElevenLabs Instant Voice Cloning integration

### Sprint 5: Quick Wins & Polish (Partial)

**Remaining**:

- [ ] **5.1**: Transcription cleanup (LLM post-processing for Whisper)
- [ ] **5.3**: Birthday awareness (Personality.birthday in responses)
- [ ] **5.4**: Author's Note / Depth Prompting (combat "Lost in the Middle")
- [ ] **5.5**: Define `SkillDefinition` interface (groundwork for Sprint 9)
- [ ] **5.6**: Configurable regex response cleanup pipeline

### Sprint 6: V2 Feature Parity (Not Started)

- [ ] **6.1**: Auto-Response System (`/channel activate/deactivate`)
- [ ] **6.2**: Rate Limiting (token bucket algorithm)
- [ ] **6.3**: Request Deduplication (prevent duplicate processing)
- [ ] **6.4**: NSFW Verification (one-time per-user)
- [ ] **6.5**: DM Personality Chat (USER REQUESTED - use conversation history for matching)

### Sprint 7: Slash Command Architecture Redesign (Not Started)

**Phase A: Foundation**

- [ ] **7.1-7.3**: Session manager abstraction, Redis storage, dashboard pattern spec

**Phase B: User Self-Service**

- [ ] **7.4**: `/preset edit` for regular users
- [ ] **7.5**: `/me profile` dashboard upgrade
- [ ] **7.6-7.7**: `/history clear` and `/history undo` with Context Epochs
- [ ] **7.8-7.9**: `/memory search` and `/memory purge`

**Phase C: Alias Consolidation**

- [ ] **7.10-7.13**: Alias schema migration, auto-create on personality create, refactor tagging

**Phase D: Admin & Advanced**

- [ ] **7.14**: `/admin system-prompt` CRUD
- [ ] **7.15**: Complete advancedParameters JSONB wiring
- [ ] **7.16**: API route naming audit

**Phase E: Shapes Import** (Future)

- [ ] **7.17-7.19**: Shapes.inc backup and import wizard

---

## Phase 3: Evolution (Icebox)

**Goal**: Deep architecture changes. Only start when Phase 2 is stable with real user data.

### Sprint 8: OpenMemory Migration

Waypoint graph memory system with multi-sector storage (episodic, semantic, emotional, procedural, reflective). Hybrid scoring with decay system.

Reference: [docs/planning/OPENMEMORY_MIGRATION_PLAN.md](docs/planning/OPENMEMORY_MIGRATION_PLAN.md)

### Sprint 9: Agentic Features

Skill system with agentic loop, web research skill, URL scraper, memory search tool, "Free Will" autonomous actions.

### Sprint 10: Advanced Features

Image generation, multi-personality response, natural order group orchestration, PluralKit proxy support, release notifications.

---

## Icebox - Ideas for Later

**Rule**: New ideas go here. Resist the shiny object.

### From Code Reviews

- Extract modal customIds to constants (DRY improvement)
- Personality Access Allowlist (`/character allowlist add @user`)
- Investigate XML/sanitization libraries vs hand-rolled
- Add Zod schema for `UpdatePersonalityBody`
- Correlation IDs for cache invalidation logging

### From SillyTavern Analysis

- Character Card Import (V2/V3 PNG metadata)
- Local Embeddings (`@xenova/transformers`)
- OpenRouter Embeddings
- Robust Chat Templates (Llama, Mistral via Ollama)
- Slash Command Piping (`/search | /summarize`)
- Lorebooks / Sticky Context (keyword-triggered lore)

### Original Ideas

- Streaming responses
- Metrics & monitoring (Prometheus)
- Advanced caching strategies
- Multi-language support
- Dream sequences (personality self-reflection)
- Emotion tracking over time
- Relationship graphs

---

## Technical Debt

**Code Quality:**

- [ ] 142 lint warnings - mostly complexity issues (functions >15 complexity, >100 lines)
- [ ] DRY violation - `me/model/autocomplete.ts` duplicates shared autocomplete utility
- [ ] Autocomplete UX - include slug in parentheses for same-name personalities

**Infrastructure:**

- [ ] Consolidate `scripts/data/import-personality/` workspace
- [ ] Full schema consistency review
- [ ] Investigate Atlas for composite schema management
- [ ] Document `advancedParameters` JSONB structures

**Testing:**

- [ ] Increase test coverage for `WebhookManager`
- [ ] Add integration tests for end-to-end flows

**Operations:**

- [ ] Rotate encryption keys every 90 days
- [ ] Database backups before major migrations

---

## How to Use This Roadmap

### For AI Sessions

1. **Start**: Read the **Current Focus** section
2. **Work**: Pick the next unchecked task in current sprint
3. **Resist**: New ideas go in Icebox, not current sprint

### For Context Switching

1. **Before Break**: Update CURRENT_WORK.md
2. **After Break**: Read CURRENT_WORK.md, then this roadmap

### Emergency Procedures

**Production Fire**: Stop → Fix → Write test → Resume sprint
**Overwhelmed**: Look at current sprint, do ONE task
**Scope Creep**: Write in Icebox → Ask "does this help launch?" → Resume

---

## Related Documentation

- [docs/planning/OPENMEMORY_MIGRATION_PLAN.md](docs/planning/OPENMEMORY_MIGRATION_PLAN.md) - Phase 3 architecture
- [docs/planning/V2_FEATURE_TRACKING.md](docs/planning/V2_FEATURE_TRACKING.md) - Feature parity tracking
- [docs/planning/SLASH_COMMAND_ARCHITECTURE.md](docs/planning/SLASH_COMMAND_ARCHITECTURE.md) - Sprint 7 detailed plan
- [docs/reference/v2-patterns-reference.md](docs/reference/v2-patterns-reference.md) - V2 patterns worth porting
