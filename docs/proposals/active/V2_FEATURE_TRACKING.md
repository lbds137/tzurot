# V2 Feature Tracking

This document tracks which features from Tzurot v2 have been ported to v3, which are planned, and which are intentionally avoided.

**Last Updated:** 2026-01-30

## Legend

- ✅ **Ported** - Feature implemented in v3
- 🚧 **In Progress** - Currently being implemented
- 📋 **Planned** - Will be implemented
- ⏸️ **Deferred** - Low priority, will implement later
- ❌ **Not Porting** - Intentionally excluded (architectural reasons)

---

## Core Bot Functionality

### Discord Integration

| Feature                 | Status    | Notes                                                    |
| ----------------------- | --------- | -------------------------------------------------------- |
| Discord.js client setup | ✅ Ported | Clean initialization in bot-client/src/index.ts          |
| Message event handling  | ✅ Ported | Simplified in MessageHandler                             |
| Webhook management      | ✅ Ported | Clean 150-line implementation vs v2's 2800 lines         |
| Webhook caching         | ✅ Ported | 10-minute TTL, prevents API spam                         |
| Webhook fallback        | ✅ Ported | Falls back to regular messages for DMs                   |
| Typing indicator        | ✅ Ported | Shows when bot is processing                             |
| Message chunking        | ✅ Ported | Preserves code blocks when splitting 2000+ char messages |
| Slash commands          | ✅ Ported | Full command suite with autocomplete                     |

### Personality System

| Feature                      | Status      | Notes                                     |
| ---------------------------- | ----------- | ----------------------------------------- |
| JSON personality configs     | ✅ Ported   | Database + file-based loading             |
| Personality name lookup      | ✅ Ported   | Case-insensitive database lookup          |
| Custom display names         | ✅ Ported   | Part of personality config                |
| Custom avatars               | ✅ Ported   | avatarUrl in personality config           |
| System prompts               | ✅ Ported   | Stored in database                        |
| Model configuration          | ✅ Ported   | temperature, maxTokens, model             |
| Default personality          | ✅ Ported   | Fallback when no match found              |
| Personality create/edit/list | ✅ Ported   | /character and /personality commands      |
| Personality access control   | ✅ Ported   | Public/private with owner-based filtering |
| Personality aliases          | ⏸️ Deferred | v2 had complex alias resolution           |

### Message Handling

| Feature               | Status    | Notes                                                         |
| --------------------- | --------- | ------------------------------------------------------------- |
| @personality mentions | ✅ Ported | @lilith triggers personality                                  |
| Bot @mentions         | ✅ Ported | Shows help message                                            |
| DM personality chat   | ✅ Ported | 3-tier lookup: Redis → Database → Display name parsing        |
| DM sticky sessions    | ✅ Ported | Continue DM conversation without @mention after first message |
| Guild channel support | ✅ Ported | Uses webhooks                                                 |
| Referenced messages   | ✅ Ported | MessageReferenceExtractor + Discord link parsing              |
| Reply detection       | ✅ Ported | Reply to bot to continue conversation                         |
| Conversation history  | ✅ Ported | ConversationPersistence service                               |
| Auto-response system  | ✅ Ported | `/channel activate` and `/channel deactivate` commands        |
| Reset conversation    | ✅ Ported | `/history clear` command clears conversation with personality |

### AI Integration

| Feature                   | Status    | Notes                                                           |
| ------------------------- | --------- | --------------------------------------------------------------- |
| API Gateway communication | ✅ Ported | HTTP client with job polling                                    |
| Job polling               | ✅ Ported | 1s interval, configurable timeout                               |
| Error handling            | ✅ Ported | Try/catch with user-friendly messages                           |
| Long-term memory          | ✅ Ported | pgvector with semantic retrieval                                |
| Image support             | ✅ Ported | Vision models for image analysis                                |
| Voice transcription       | ✅ Ported | OpenAI Whisper integration                                      |
| Model indicators          | ✅ Ported | Shows which model generated response                            |
| BYOK (Bring Your Own Key) | ✅ Ported | Users provide their own API keys                                |
| Guest mode                | ✅ Ported | Free models for users without keys                              |
| Rate limiting             | ✅ Ported | Redis-backed token bucket in api-gateway                        |
| Request deduplication     | ✅ Ported | Multi-layer duplicate detection (Dice, Jaccard, embeddings)     |
| Memory incognito mode     | ✅ Ported | `/memory incognito` - temporary disable memory storage (v3 new) |
| Memory focus mode         | ✅ Ported | `/memory focus` - restrict RAG to specific timeframe (v3 new)   |
| Memory management         | ✅ Ported | `/memory search/view/edit/delete/purge` commands (v3 new)       |

### User Management

| Feature            | Status    | Notes                                                  |
| ------------------ | --------- | ------------------------------------------------------ |
| User personas      | ✅ Ported | /me profile commands                                   |
| Model overrides    | ✅ Ported | Per-personality model selection                        |
| LLM configurations | ✅ Ported | /llm-config commands                                   |
| Timezone settings  | ✅ Ported | /settings timezone                                     |
| Admin commands     | ✅ Ported | /admin servers, kick, usage                            |
| NSFW verification  | ✅ Ported | Discord age-gated channel handshake, proactive cleanup |

---

## V2 Features NOT Ported (Intentionally)

### DDD Architecture ❌

**Why Not:** Over-engineered for this project, caused more problems than it solved

- ApplicationBootstrap dependency injection
- Domain layer (entities, value objects, aggregates)
- Application layer (services, commands, event handlers)
- Repository pattern with file persistence
- Domain events system
- Bounded contexts

**V3 Approach:** Clean, simple classes with constructor dependency injection

### Complex Singletons ❌

**Why Not:** Made testing difficult, caused circular dependencies

- PersonalityManager singleton
- Global client variable
- Module-level state initialization

**V3 Approach:** Factory functions and dependency injection

### Over-Abstracted Systems ❌

**Why Not:** Unnecessary complexity for current needs

- Complex message tracker with multiple layers
- Advanced caching (profile/avatar cache - no longer needed without shapes.inc)
- Elaborate alias resolution with chains and circular detection

**V3 Approach:** Will implement simpler versions when needed

---

## Remaining Features to Port

### High Priority 🔥 (User-Requested)

1. ~~**DM Personality Chat**~~ ✅ COMPLETE - 3-tier lookup (Redis → Database → Display name parsing)

2. ~~**Auto-Response System**~~ ✅ COMPLETE - `/channel activate` and `/channel deactivate`

3. ~~**Reset Conversation**~~ ✅ COMPLETE - `/history clear` command

### Medium Priority 📋

4. ~~**Rate Limiting**~~ ✅ COMPLETE - Redis-backed token bucket in api-gateway

5. ~~**Request Deduplication**~~ ✅ COMPLETE - Multi-layer duplicate detection with embeddings

6. ~~**NSFW Verification**~~ ✅ COMPLETE - Discord age-gated channel handshake with proactive cleanup

### Low Priority ⏸️

7. **Personality Aliases** - User-managed alternative names
   - Schema migration needed (add ownerId to PersonalityAlias)
   - `/alias add/remove/list` commands

8. **Release Notifications** - Notify about bot updates
   - Nice UX feature
   - v2 had NotificationsCommand

9. **Backup/Export** - Data portability
   - v2 had comprehensive backup with shapes.inc
   - Need to adapt for v3's PostgreSQL-based storage

---

## New V3 Features (Not in V2)

These are improvements over v2's architecture:

- **Microservices Architecture** - Gateway, Worker, Bot-Client separation
- **BullMQ Job Queue** - Async job processing with Redis
- **TypeScript** - Type safety across all services
- **Monorepo with pnpm** - Better dependency management
- **pgvector** - Memory persistence with PostgreSQL
- **Modular AI Providers** - OpenRouter with 400+ models
- **Slash Commands** - Modern Discord interactions (v2 used text prefix !tz)
- **BYOK** - Users bring their own API keys
- **Guest Mode** - Free model access without API keys
- **Memory Management** - Full CRUD for memories (`/memory search/view/edit/delete/purge`)
- **Memory Incognito Mode** - Temporary disable memory storage per-personality
- **Memory Focus Mode** - Restrict RAG retrieval to specific timeframe
- **LLM Presets** - User-customizable LLM configurations (`/preset create/edit/list`)
- **Extended Context** - Pull recent channel messages into prompt context
- **Multi-layer Duplicate Detection** - Bigram, word, and semantic similarity checks
- **LLM Diagnostic Flight Recorder** - Admin debug tool for prompt inspection (`/admin debug`)

---

## Progress Tracking

### Phase 1: Foundation ✅ COMPLETE

- [x] Monorepo setup
- [x] API Gateway service
- [x] AI Worker service
- [x] Bot-Client basic structure

### Phase 2: Core Messaging ✅ COMPLETE

- [x] Webhook management
- [x] Message routing
- [x] Personality loading
- [x] Gateway communication
- [x] Slash command system
- [x] Error handling

### Phase 3: Conversation Features ✅ COMPLETE

- [x] Conversation history
- [x] Referenced messages
- [x] Long-term memory
- [x] Image support
- [x] Voice transcription

### Phase 4: User Management ✅ COMPLETE

- [x] BYOK (Bring Your Own Key)
- [x] Guest mode (free models)
- [x] User personas
- [x] Model overrides
- [x] LLM configurations
- [x] Admin commands

### Phase 5: Polish & Enhancement 🚧 IN PROGRESS

- [x] Auto-response system (`/channel activate`)
- [x] Rate limiting (Redis token bucket)
- [x] Request deduplication (multi-layer detection)
- [x] NSFW verification
- [ ] Personality aliases
- [x] DM personality chat
- [x] Memory management (`/memory` commands)
- [x] LLM presets (`/preset` commands)
- [x] Extended context mode

---

## Questions & Decisions Log

### Why not port DDD architecture?

- **Decision:** Start clean, avoid over-engineering
- **Date:** 2025-10-02
- **Reasoning:** V2's DDD caused more problems than benefits (circular deps, complexity)

### Why simplify webhook manager from 2800 to 150 lines?

- **Decision:** Extract only essential caching logic
- **Date:** 2025-10-02
- **Reasoning:** Most of v2's code was DDD ceremony and unnecessary abstraction

### Why slash commands instead of text prefix (!tz)?

- **Decision:** Use Discord's native slash command system
- **Date:** 2025-10-02
- **Reasoning:**
  - Self-documenting (users discover commands in Discord UI)
  - Built-in autocomplete and validation
  - Better UX with descriptions and parameter hints
  - Modern Discord best practice

### Why BYOK (Bring Your Own Key)?

- **Decision:** Users provide their own OpenRouter API keys
- **Date:** 2025-11-21
- **Reasoning:**
  - Enables public launch without bankruptcy risk
  - Users control their own costs
  - Free model fallback for users without keys

---

**Note:** This is a living document. Update as features are implemented or priorities change.
