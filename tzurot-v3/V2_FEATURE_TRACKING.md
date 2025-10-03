# V2 Feature Tracking

This document tracks which features from Tzurot v2 have been ported to v3, which are planned, and which are intentionally avoided.

**Last Updated:** 2025-10-02

## Legend

- ✅ **Ported** - Feature implemented in v3
- 🚧 **In Progress** - Currently being implemented
- 📋 **Planned** - Will be implemented
- ⏸️ **Deferred** - Low priority, will implement later
- ❌ **Not Porting** - Intentionally excluded (architectural reasons)

---

## Core Bot Functionality

### Discord Integration

| Feature | Status | Notes |
|---------|--------|-------|
| Discord.js client setup | ✅ Ported | Clean initialization in bot-client/src/index.ts |
| Message event handling | ✅ Ported | Simplified in MessageHandler |
| Webhook management | ✅ Ported | Clean 150-line implementation vs v2's 2800 lines |
| Webhook caching | ✅ Ported | 10-minute TTL, prevents API spam |
| Webhook fallback | ✅ Ported | Falls back to regular messages for DMs |
| Typing indicator | ✅ Ported | Shows when bot is processing |
| Message chunking | ✅ Ported | Preserves code blocks when splitting 2000+ char messages |

### Personality System

| Feature | Status | Notes |
|---------|--------|-------|
| JSON personality configs | ✅ Ported | Simple file-based loading |
| Personality name lookup | ✅ Ported | Case-insensitive Map-based storage |
| Custom display names | ✅ Ported | Part of BotPersonality interface |
| Custom avatars | ✅ Ported | avatarUrl in personality config |
| System prompts | ✅ Ported | Passed to API Gateway |
| Model configuration | ✅ Ported | temperature, maxTokens, model |
| Personality aliases | 📋 Planned | v2 had complex alias resolution |
| Default personality | ✅ Ported | Fallback when no personalities loaded |
| Personality add/remove commands | 📋 Planned | v2 had !tz add/remove |
| Personality list command | 📋 Planned | v2 had !tz list |

### Message Handling

| Feature | Status | Notes |
|---------|--------|-------|
| @personality mentions | ✅ Ported | @lilith triggers personality |
| Bot @mentions | ✅ Ported | Uses default personality |
| DM support | ✅ Ported | Falls back to regular replies |
| Guild channel support | ✅ Ported | Uses webhooks |
| Referenced messages | 📋 Planned | v2 supported replying to messages |
| Slash commands | 📋 Planned | Modern Discord commands (replacing v2's !tz prefix) |
| Auto-response system | 📋 Planned | v2 had activated channels |
| Conversation history | 📋 Planned | v2 tracked recent messages |

### AI Integration

| Feature | Status | Notes |
|---------|--------|-------|
| API Gateway communication | ✅ Ported | HTTP client with job polling |
| Job polling | ✅ Ported | 500ms interval, 30s timeout |
| Error handling | ✅ Ported | Try/catch with user-friendly messages |
| Rate limiting | 📋 Planned | v2 had token bucket |
| Request deduplication | 📋 Planned | v2 had message tracker |
| Streaming responses | 📋 Planned | Future enhancement |

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
- ~~PluralKit detection system~~ (Actually needed - will port simplified version)
- Advanced caching (profile/avatar cache - no longer needed without shapes.inc)
- Elaborate alias resolution with chains and circular detection

**V3 Approach:** Will implement simpler versions when needed

---

## Planned Features (From V2)

### High Priority 🔥

1. **Slash Command System** - Modern Discord interactions
   - `/personality add`, `/personality remove`, `/personality list`, `/personality info`
   - `/channel activate`, `/channel deactivate`
   - Built-in Discord UI with descriptions and autocomplete
   - Auto-documented (users can discover commands in Discord)
   - Permission checking via Discord's permission system

2. **Conversation History** - Track recent messages per channel
   - Simple in-memory cache
   - Configurable history length
   - Passed to AI for context

3. **Auto-Response System** - Activated channels
   - Channel activation/deactivation
   - Personality assignment per channel
   - Message history tracking

4. **Referenced Message Support** - Reply detection
   - Extract referenced message content
   - Include in context for AI

### Medium Priority 📋

5. **NSFW Verification** - Age verification system
   - **CHANGED FROM V2:** One-time verification per user (not per-channel)
   - Auto-verify by using bot in NSFW-marked Discord channel
   - Store verified user IDs persistently
   - Once verified, can use bot in any channel
   - Simple: just prevent kids from accessing

6. **Rate Limiting** - Token bucket algorithm
   - Per-user rate limits
   - Per-channel rate limits
   - Graceful degradation

7. **Request Deduplication** - Prevent duplicate processing
   - Track recent message IDs
   - Simple Map-based cache
   - TTL-based cleanup

8. **Personality Aliases** - Alternative names for personalities
   - **SIMPLIFIED FROM V2:** Just Map<alias, personalityName>
   - No domain objects, no smart alternate generation, no reassignment
   - Case-insensitive lookup
   - If alias taken, user picks another

9. **Error Message Customization** - Per-personality error messages
   - Custom timeout messages
   - Custom error responses
   - Part of personality config

### Low Priority ⏸️

10. **PluralKit Support** - Detect and handle proxied messages
    - NEEDED: Some users are PluralKit users
    - Simplified detection vs v2's elaborate system
    - Just need to detect webhook messages and handle appropriately

11. **Release Notifications** - Notify about bot updates
    - Port from v2
    - Nice UX feature
    - Low priority for now

12. **Metrics & Monitoring** - Usage statistics
    - Prometheus metrics
    - Logging improvements

---

## New V3 Features (Not in V2)

These are improvements over v2's architecture:

- **Microservices Architecture** - Gateway, Worker, Bot-Client separation
- **BullMQ Job Queue** - Async job processing with Redis
- **LangChain.js Integration** - Better RAG and AI orchestration
- **TypeScript** - Type safety across services
- **Monorepo with pnpm** - Better dependency management
- **Vector Store** - Memory persistence with Qdrant
- **Modular AI Providers** - Easy to add new providers
- **Slash Commands** - Modern Discord interactions (v2 used text prefix !tz)

---

## Migration Philosophy

**Extracting Clean Patterns:**
- Look at v2 code to understand WHAT it does
- Ignore HOW v2 implemented it (often overcomplicated)
- Implement the simplest version that works
- Add complexity only when needed

**Testing as We Go:**
- Each ported feature gets basic tests
- Focus on integration over unit tests
- Test with real Discord bot when possible

**Incremental Approach:**
- Port core features first (messaging, personalities)
- Add command system next (user management)
- Then conversation features (history, auto-response)
- Finally polish features (aliases, caching, metrics)

---

## Progress Tracking

### Phase 1: Foundation ✅ COMPLETE
- [x] Monorepo setup
- [x] API Gateway service
- [x] AI Worker service
- [x] Bot-Client basic structure

### Phase 2: Core Messaging 🚧 IN PROGRESS
- [x] Webhook management
- [x] Message routing
- [x] Personality loading
- [x] Gateway communication
- [ ] Slash command system (Discord interactions)
- [ ] Error handling polish

### Phase 3: Conversation Features 📋 PLANNED
- [ ] Conversation history
- [ ] Auto-response system
- [ ] Referenced messages
- [ ] Channel activation

### Phase 4: User Management 📋 PLANNED
- [ ] Rate limiting
- [ ] Request deduplication
- [ ] User authentication
- [ ] Permission system

### Phase 5: Polish & Enhancement ⏸️ DEFERRED
- [ ] Personality aliases
- [ ] Custom error messages
- [ ] Advanced caching
- [ ] Metrics & monitoring

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
  - Text prefix only useful for Revolt, which is descoped

### Why simplify NSFW verification from v2?
- **Decision:** One-time per-user verification, not per-channel
- **Date:** 2025-10-02
- **Reasoning:**
  - V2 required verification per channel (annoying)
  - Auto-verify by detecting NSFW channel usage
  - Simple goal: just prevent kids from accessing
  - Once verified, trust the user across all channels

### Why simplify alias system from v2?
- **Decision:** Just Map<alias, personalityName>, no domain objects
- **Date:** 2025-10-02
- **Reasoning:**
  - V2 had: Alias ValueObject, smart alternate generation, reassignment logic
  - That's a full class hierarchy for what's essentially a string lookup
  - If alias is taken, just tell user to pick another name
  - No need to be clever with automatic conflict resolution

### When to add conversation history?
- **Decision:** After slash command system works
- **Date:** 2025-10-02
- **Reasoning:** Commands provide user control, then add auto-features

---

## Next Steps

1. **Immediate:** Deploy to Railway, test end-to-end with real Discord
2. **This Week:** Implement slash command system (Discord interactions)
3. **Next Week:** Add conversation history and auto-response
4. **This Month:** Complete all high-priority features

---

**Note:** This is a living document. Update as features are implemented or priorities change.
