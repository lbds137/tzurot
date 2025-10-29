# Tzurot v3 Refinement Roadmap

**Last Updated:** 2025-10-28
**Source:** Code review collaboration with Gemini AI
**Status:** Planning Phase

> **Purpose:** This document organizes architectural improvements, feature enhancements, and technical debt items identified during the v3 code review. It provides a prioritized roadmap for refinement work.

---

## Table of Contents

1. [Prioritization Framework](#prioritization-framework)
2. [Tier 1: Foundational Stability](#tier-1-foundational-stability--highest-priority-)
3. [Tier 2: Core Database Functionality](#tier-2-core-database-functionality-)
4. [Tier 3: Memory & RAG Intelligence](#tier-3-memory--rag-intelligence-)
5. [Tier 4: V2 Feature Parity](#tier-4-v2-feature-parity-)
6. [Tier 5: New V3 Capabilities](#tier-5-new-v3-capabilities-)
7. [Tier 6: Robustness & Monitoring](#tier-6-robustness--monitoring-ongoing-)
8. [Advanced Features (Future)](#advanced-features-future)
9. [Implementation Guidelines](#implementation-guidelines)

---

## Prioritization Framework

Work is organized into **6 tiers** based on dependencies and impact:

- **Tier 1-2:** Foundation - Must be stable before adding complex features
- **Tier 3-4:** Core functionality - Makes the bot usable and feature-complete
- **Tier 5-6:** Advanced capabilities - Adds polish and production readiness
- **Future:** Ambitious features requiring solid foundation

**Current Focus:** Tier 1 foundational work

---

## Tier 1: Foundational Stability (Highest Priority) 🧱

**Goal:** Ensure the basic architecture is sound and extensible before adding complex features.

### 1.1 Dependency Injection

**Why:** Makes future refactoring and testing much easier; improves modularity

**Services to update:**
- [ ] `ai-worker/ConversationalRAGService` - Inject Prisma, Qdrant adapter, model factory
- [ ] `ai-worker/AIJobProcessor` - Inject RAG service, model factory
- [ ] `bot-client/MessageHandler` - Inject UserService, HTTP client

**Implementation:**
- Use constructor-based injection
- Create initialization methods where needed
- Document dependencies in each service

**Tracking:** Create GitHub Issue `#TBD - Implement dependency injection`

---

### 1.2 Refactor `ConversationalRAGService`

**Why:** Service is too large (700+ lines); hard to maintain and test

**Target structure:**
```
ai-worker/src/services/rag/
├── ConversationalRAGService.ts    (orchestrator)
├── PromptBuilder.ts                (system prompt assembly)
├── MemoryRetriever.ts              (Qdrant queries + filtering)
├── MemoryStorer.ts                 (formatting + PendingMemory)
├── LlmInvoker.ts                   (ModelFactory interaction)
└── MultimodalProcessor.ts          (already separate)
```

**Tasks:**
- [ ] Extract `PromptBuilder` class
  - Handles: persona details, memory formatting, context, date, participants
  - Methods: `buildSystemPrompt()`, `formatMemories()`, `formatParticipants()`
- [ ] Extract `MemoryRetriever` class
  - Handles: Qdrant queries, STM/LTM buffer, scope filtering
  - Methods: `retrieveRelevant()`, `applyFilters()`
- [ ] Extract `MemoryStorer` class
  - Handles: interaction formatting, PendingMemory creation
  - Methods: `storeInteraction()`, `createPendingMemory()`
- [ ] Extract `LlmInvoker` class
  - Handles: ModelFactory interaction, response parsing
  - Methods: `invoke()`, `parseResponse()`, `handleErrors()`
- [ ] Update `ConversationalRAGService` to orchestrate these components

**Tracking:** Create GitHub Issue `#TBD - Refactor ConversationalRAGService into smaller classes`

---

### 1.3 Configuration Refinement

**Why:** Current config handling is basic; need validation, defaults, type safety

**Tasks:**
- [ ] Enhance `common-types/getConfig()` with Zod validation
- [ ] Define config schemas for each service
  - `bot-client` - Discord token, gateway URL, Redis
  - `api-gateway` - Port, CORS, Redis, database
  - `ai-worker` - Redis, database, Qdrant, AI providers
- [ ] Provide sensible defaults where possible
- [ ] Validate on startup; fail fast with clear error messages
- [ ] Document all environment variables in `.env.example`

**Example validation:**
```typescript
const BotClientConfigSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  GATEWAY_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),
  // ...
});
```

**Tracking:** Create GitHub Issue `#TBD - Add Zod validation for service configs`

---

### 1.4 Database Schema: User System Prompt Override

**Why:** Users need ability to override default system prompts per personality

**Schema change:**
```prisma
model UserPersonalityConfig {
  // ... existing fields ...

  // NEW: Allow user to override system prompt
  systemPromptId String?       @map("system_prompt_id") @db.Uuid
  systemPrompt   SystemPrompt? @relation(fields: [systemPromptId], references: [id])
}
```

**Tasks:**
- [ ] Add migration for new `systemPromptId` field
- [ ] Update `UserPersonalityConfig` in schema
- [ ] Add relation to `SystemPrompt` model
- [ ] Test migration on dev database

**Tracking:** Create GitHub Issue `#TBD - Add user system prompt override to schema`

---

### 1.5 Database Schema: Alias System

**Why:** V2 had personality aliases; need to decide how to store in v3

**Decision needed:** How to structure aliases?

**Option A: Dedicated Alias table (Recommended)**
```prisma
model PersonalityAlias {
  id            String      @id @default(uuid())
  name          String      @db.VarChar(100)
  personalityId String      @map("personality_id") @db.Uuid
  personality   Personality @relation(fields: [personalityId], references: [id])
  createdBy     String?     @map("created_by") @db.Uuid
  createdByUser User?       @relation(fields: [createdBy], references: [id])

  @@unique([name, personalityId])
  @@index([name])
}
```

**Option B: JSON array on Personality**
```prisma
model Personality {
  // ... existing fields ...
  aliases String[] @default([])
}
```

**Tasks:**
- [ ] Decide on alias storage approach (Option A recommended for queryability)
- [ ] Implement schema changes
- [ ] Create migration
- [ ] Update PersonalityService to handle alias lookups

**Tracking:** Create GitHub Issue `#TBD - Implement personality alias system`

---

## Tier 2: Core Database Functionality ⚙️

**Goal:** Make full use of the existing database schema for essential configuration and context.

### 2.1 LLM Config Hierarchical Selection

**Why:** Database has rich LLM config system; need to actually use it

**Hierarchy:**
1. `UserPersonalityConfig.llmConfigId` (highest priority)
2. `PersonalityDefaultConfig.llmConfigId`
3. Global default `LlmConfig` (where `isDefault = true`)

**Tasks:**
- [ ] Implement lookup logic in `ai-worker/PersonalityService`
- [ ] Method: `async getEffectiveLlmConfig(userId, personalityId): Promise<LlmConfig>`
- [ ] Use ALL parameters from selected config:
  - `temperature`, `topP`, `topK`
  - `frequencyPenalty`, `presencePenalty`, `repetitionPenalty`
  - `maxTokens`
  - `memoryScoreThreshold`, `memoryLimit`
  - `contextWindowSize`
- [ ] Update `LlmInvoker` to apply these parameters
- [ ] Add logging for which config was selected

**Tracking:** Create GitHub Issue `#TBD - Implement LLM config hierarchical selection`

---

### 2.2 System Prompt Hierarchical Selection

**Why:** Similar to LLM config; need to respect override hierarchy

**Hierarchy:**
1. `UserPersonalityConfig.systemPromptId` (from 1.4)
2. `Personality.systemPromptId`
3. Global default `SystemPrompt` (where `isDefault = true`)

**Tasks:**
- [ ] Implement lookup logic in `ai-worker/PersonalityService`
- [ ] Method: `async getEffectiveSystemPrompt(userId, personalityId): Promise<SystemPrompt>`
- [ ] Update `PromptBuilder` to use this
- [ ] Add logging for which prompt was selected

**Tracking:** Create GitHub Issue `#TBD - Implement system prompt hierarchical selection`

---

### 2.3 User Persona Management Commands

**Why:** Users need UI to manage their persona (self-representation)

**Commands to implement:**
- `/persona create <name> <description>` - Create new persona
- `/persona edit <persona-name>` - Edit existing persona (modal)
- `/persona set-default <persona-name>` - Set as default
- `/persona list` - Show your personas
- `/persona view <persona-name>` - View details

**Implementation:**
- [ ] Create command files in `bot-client/src/commands/persona/`
- [ ] Use Discord modals for multi-field editing
- [ ] Integrate with `UserService` (Prisma operations)
- [ ] Update `UserDefaultPersona` table appropriately
- [ ] Add validation (name length, uniqueness, etc.)

**Tracking:** Create GitHub Issue `#TBD - Implement persona management slash commands`

---

### 2.4 Channel Activation System

**Why:** `ActivatedChannel` table exists but isn't fully utilized

**Commands to implement:**
- `/activate <personality>` - Activate personality in channel
- `/deactivate` - Deactivate current personality
- `/autorespond [on|off]` - Toggle auto-response

**Tasks:**
- [ ] Create `ActivatedChannel` CRUD operations in service layer
- [ ] Implement slash commands in `bot-client/src/commands/channel/`
- [ ] Update `MessageHandler` to check `ActivatedChannel` table
  - If channel has activated personality + autoRespond = true → respond without @mention
- [ ] Track who activated (`createdBy` field)
- [ ] Handle deactivation (delete record)

**Tracking:** Create GitHub Issue `#TBD - Implement channel activation system`

---

## Tier 3: Memory & RAG Intelligence 🧠

**Goal:** Improve the AI's context awareness and ability to form relationships.

### 3.1 Hybrid Memory Strategy

**Current:** Storing full conversation turns verbatim in Qdrant

**Problem:**
- Risks LLM predictability (feeding its own output back)
- Can store hallucinations
- May lack scalability

**Solution:** Hybrid verbatim + selective summarization

**Implementation:**
```
┌─────────────────────────────────────┐
│ Recent (24-48h): Verbatim Storage   │ ← High fidelity
├─────────────────────────────────────┤
│ Older: Background Summarization     │ ← Noise reduction
│ - Key facts & events                │
│ - User information                  │
│ - Relationship updates              │
└─────────────────────────────────────┘
```

**Tasks:**
- [ ] Keep verbatim storage as-is for recent turns
- [ ] Add `timestamp` filtering in `MemoryRetriever`
- [ ] Create background summarization job (BullMQ)
  - Trigger: Periodically OR by conversation age/length
  - Use cheaper model (Haiku, Gemma 2) for summarization
  - System prompt: Extract key facts, discard filler
- [ ] Store summaries in Qdrant with metadata:
  - `summaryType: "conversation_chunk"`
  - `originalMessageIds: [...]`
  - `summarizedAt: timestamp`
- [ ] Update `MemoryRetriever` to fetch both verbatim + summaries
- [ ] Update `PromptBuilder` to label them differently:
  - "Recent Exchange:" (verbatim)
  - "From Past Conversations (Summary):" (summaries)

**Tracking:** Create GitHub Issue `#TBD - Implement hybrid memory strategy`

---

### 3.2 User Relationship Profiles (URPs)

**What:** Persistent summary of user-personality relationship state

**Why:**
- Provides consistent relationship context
- Grounds AI responses
- Reduces reliance on perfect memory retrieval

**Structure:**
```typescript
interface URP {
  type: "URP";
  personaId: string;
  personalityId: string;
  relationship: {
    stage: string;           // e.g., "acquaintance", "close friend", "romantic partner"
    dynamics: string;        // Key relationship characteristics
    insideJokes: string[];
    commitments: string[];
  };
  userFacts: {
    preferences: Record<string, string>;
    significantEvents: string[];
    personalDetails: string;
  };
  lastUpdated: Date;
}
```

**Tasks:**
- [ ] Design URP document structure (Zod schema)
- [ ] Create background URP update job (BullMQ)
  - Trigger: After N interactions OR periodically
  - Retrieve: Existing URP + recent verbatim + summaries
  - Use capable LLM to synthesize updates
  - Focus on: evolving dynamics, key memories, user facts
- [ ] Store URPs in Qdrant with metadata:
  - `type: "URP"`
  - `personaId`, `personalityId`
- [ ] Update `MemoryRetriever` to ALWAYS fetch relevant URP
- [ ] Update `PromptBuilder` to include URP prominently

**Tracking:** Create GitHub Issue `#TBD - Implement User Relationship Profiles (URPs)`

---

### 3.3 Memory Scope Implementation

**What:** Respect `canonScope` metadata (global, personal, session)

**Current:** Basic structure exists in schema but not enforced

**Tasks:**
- [ ] Ensure all memory writes include `canonScope` metadata
  - Direct interactions → `personal`
  - Personality background/traits → `global`
  - Temporary context (games, specific sessions) → `session`
- [ ] Update `MemoryStorer` to set appropriate scope
- [ ] Update `MemoryRetriever` to filter by scope:
  - DM conversations: Include `personal` + `global`
  - Channel conversations: Include `global` + `session` (if session ID provided)
- [ ] Add session ID tracking for channels (store in Redis?)

**Tracking:** Create GitHub Issue `#TBD - Implement memory scope filtering`

---

### 3.4 STM Optimization

**Current:** Loading last N messages from PostgreSQL

**Improvements:**
- [ ] **Dynamic loading based on token count** instead of fixed message count
  - Estimate tokens for each message
  - Load until reaching ~2k token budget (or config value)
- [ ] **Redis cache for very recent messages** (last 10-20)
  - Faster than Postgres for active channels
  - Keep Postgres as source of truth
  - Use TTL to prevent stale data
- [ ] **Consider summarization buffer** (LangChain pattern)
  - Periodically summarize older STM history
  - Keep recent messages verbatim

**Tracking:** Create GitHub Issue `#TBD - Optimize STM loading strategy`

---

## Tier 4: V2 Feature Parity ✨

**Goal:** Bring back essential user commands from V2 using the new architecture.

### 4.1 Personality Management Commands

**V2 commands:** `!add`, `!remove`, `!config`, `!info`, `!list`

**V3 equivalent:**
- `/personality create <name>` - Create personality (modal for details)
- `/personality delete <name>` - Delete personality
- `/personality configure <name>` - Edit personality (modal)
- `/personality info <name>` - Show personality details
- `/personality list` - List available personalities

**Tasks:**
- [ ] Create command files in `bot-client/src/commands/personality/`
- [ ] Use Discord modals for multi-field forms
- [ ] Integrate with `PersonalityService` (Prisma)
- [ ] Handle permissions (only owners can edit)
- [ ] Add validation and error handling

**Tracking:** Create GitHub Issue `#TBD - Implement personality management commands`

---

### 4.2 Alias Commands

**V2 command:** `!alias add <name> <personality>`

**V3 equivalent:**
- `/alias add <name> <personality>` - Create alias
- `/alias remove <name>` - Remove alias
- `/alias list` - Show all aliases

**Tasks:**
- [ ] Depends on 1.5 (alias schema)
- [ ] Create command files in `bot-client/src/commands/alias/`
- [ ] Implement alias lookup in `PersonalityService`
- [ ] Update `MessageHandler` to resolve aliases
- [ ] Handle conflicts (alias already exists, etc.)

**Tracking:** Create GitHub Issue `#TBD - Implement alias commands`

---

### 4.3 Conversation Control Commands

**V2 commands:** `!reset`

**V3 equivalent:**
- `/reset` - Reset conversation context

**Decision needed:** What should reset do in v3?
- Option A: Clear STM cache (Redis) but keep DB history
- Option B: Signal to RAG to ignore recent history for next interaction
- Option C: Actually delete recent conversation history (destructive)

**Recommendation:** Option A + B (clear cache, add flag to skip recent history once)

**Tasks:**
- [ ] Decide on reset behavior
- [ ] Implement `/reset` command
- [ ] Clear Redis STM cache if exists
- [ ] Add temporary "skip history" flag (store in Redis with TTL)
- [ ] Update `ConversationHistoryService` to respect flag

**Tracking:** Create GitHub Issue `#TBD - Implement /reset command`

---

### 4.4 PluralKit/Proxy Support

**V2 had:** `webhookUserTracker` for proxy detection

**V3 current:** Basic reply detection + Redis webhook mapping

**Improvements needed:**
- [ ] Review v2 proxy handling logic
- [ ] Ensure `MessageHandler` correctly identifies proxied messages
  - Check `message.reference` for replies
  - Look up webhook personality in Redis
  - Map webhook info back to user/persona
- [ ] Handle edge cases:
  - Unknown proxy (no Redis entry)
  - Multiple proxies in conversation
- [ ] Test with actual PluralKit setup
- [ ] Document proxy handling flow

**Tracking:** Create GitHub Issue `#TBD - Enhance PluralKit/proxy message handling`

---

## Tier 5: New V3 Capabilities 🚀

**Goal:** Implement planned advanced capabilities unique to V3.

### 5.1 BYOK (Bring Your Own Key) System

**Why:** Essential for public launch; prevents bot owner paying all costs

**Components:**
1. **Key Storage** (encrypted)
2. **Key Management Commands**
3. **Key Selection Logic**
4. **Usage Tracking**

**Schema:**
```prisma
model UserApiKey {
  id          String   @id @default(uuid())
  userId      String   @map("user_id") @db.Uuid
  user        User     @relation(fields: [userId], references: [id])
  provider    String   @db.VarChar(50)  // "openrouter", "gemini", etc.
  // Encrypted API key
  encryptedKey String  @map("encrypted_key") @db.Text
  nickname    String?  @db.VarChar(100)
  createdAt   DateTime @default(now())

  @@index([userId, provider])
}
```

**Commands:**
- `/keys set <provider> <key> [nickname]` - Add/update API key
- `/keys list` - Show your configured keys (masked)
- `/keys remove <provider>` - Delete API key

**Tasks:**
- [ ] Implement key encryption (use `crypto` module)
- [ ] Create `UserApiKey` Prisma model
- [ ] Implement key management commands
- [ ] Update `api-gateway` to look up user keys
- [ ] Pass user key to `ai-worker` in job data
- [ ] Update `ModelFactory` to use provided key
- [ ] Handle missing/invalid key gracefully

**Tracking:** Create GitHub Issue `#TBD - Implement BYOK system`

---

### 5.2 Usage Tracking & Attribution

**Why:** Required for BYOK cost transparency and background job attribution

**What to track:**
- Direct interaction tokens (user's key)
- Background job tokens (owner's key, attributed to users)
- Storage usage (memory entries per user)

**Schema:**
```prisma
model UserUsage {
  id              String   @id @default(uuid())
  userId          String   @map("user_id") @db.Uuid
  user            User     @relation(fields: [userId], references: [id])
  personalityId   String?  @map("personality_id") @db.Uuid
  personality     Personality? @relation(fields: [personalityId], references: [id])

  // Token counts
  directTokens    Int      @default(0) @map("direct_tokens")
  allocatedTokens Int      @default(0) @map("allocated_tokens")  // From background jobs

  // Timestamps
  periodStart     DateTime @map("period_start")
  periodEnd       DateTime @map("period_end")

  @@index([userId, periodStart])
}

model UserInteractionStats {
  id             String   @id @default(uuid())
  userId         String   @map("user_id") @db.Uuid
  personalityId  String   @map("personality_id") @db.Uuid

  interactionCount Int    @default(0)
  tokenCount       Int    @default(0)

  updatedAt      DateTime @updatedAt

  @@unique([userId, personalityId])
}
```

**Tasks:**
- [ ] Create usage tracking models
- [ ] Track tokens in `ai-worker` (LangChain callbacks)
- [ ] Store direct interaction stats
- [ ] Implement background job attribution:
  - Record which users' data is processed
  - Divide job cost proportionally by interaction volume
  - Store allocated costs in `UserUsage`
- [ ] Create `/usage` command to show stats
- [ ] Optional: Implement usage limits/budgets

**Tracking:** Create GitHub Issue `#TBD - Implement usage tracking and attribution`

---

### 5.3 User Memory Management

**Commands:**
- `/memory view [filter]` - List your memories (paginated)
- `/memory delete <id>` - Delete specific memory
- `/memory flag <id> [reason]` - Flag memory for review
- `/memory correct <id> <correction>` - Suggest correction

**Tasks:**
- [ ] Implement memory listing (query Qdrant by personaId)
- [ ] Show memory IDs in `/memory view` output
- [ ] Implement deletion (remove from Qdrant)
- [ ] Add flagging system (store flags in DB or Qdrant metadata)
- [ ] Implement correction mechanism
- [ ] Add pagination for large result sets

**Tracking:** Create GitHub Issue `#TBD - Implement user memory management commands`

---

### 5.4 Voice/Image Generation

**Current:** MultimodalProcessor handles INPUT (vision, transcription)

**Enhancement:** Generate OUTPUT (TTS, images)

**Tasks:**
- [ ] Check `Personality.voiceEnabled` flag
- [ ] If enabled, call TTS model after generating text response
  - Use `voiceSettings` JSON for configuration
  - Return audio file URL in job result
- [ ] Check `Personality.imageEnabled` flag
- [ ] If enabled and appropriate, generate image
  - Use `imageSettings` JSON for configuration
  - Return image URL in job result
- [ ] Update `bot-client` to post audio/images to Discord

**Tracking:** Create GitHub Issue `#TBD - Implement voice and image generation`

---

## Tier 6: Robustness & Monitoring (Ongoing) 🛡️

**Goal:** Improve stability, performance, observability, and developer experience.

### 6.1 Enhanced Input Validation

**Tasks:**
- [ ] Validate all `api-gateway` request bodies with Zod
- [ ] Validate job data in `ai-worker` before processing
- [ ] Validate Discord command inputs in `bot-client`
- [ ] Provide clear error messages for validation failures
- [ ] Log validation errors for monitoring

**Tracking:** Create GitHub Issue `#TBD - Add comprehensive input validation`

---

### 6.2 LLM Output Parsing

**Current:** Basic response handling

**Improvements:**
- [ ] Use LangChain output parsers for structured data
- [ ] Handle malformed JSON gracefully
- [ ] Detect refusals/safety blocks
- [ ] Implement retry logic for parse failures
- [ ] Add fallback responses for unparseable output

**Tracking:** Create GitHub Issue `#TBD - Improve LLM output parsing`

---

### 6.3 Rate Limiting & Cost Control

**Tasks:**
- [ ] Add rate limiting middleware to `api-gateway`
  - Per IP address
  - Per user ID
  - Per channel
- [ ] Track token usage per user (from 5.2)
- [ ] Enforce user-defined budgets (if BYOK)
- [ ] Return 429 Too Many Requests with retry-after

**Tracking:** Create GitHub Issue `#TBD - Implement rate limiting`

---

### 6.4 Monitoring & Logging

**Current:** Basic Pino logging

**Enhancements:**
- [ ] Add correlation IDs (requestId) across all services
  - Generate in `api-gateway`
  - Pass through BullMQ job data
  - Include in all log statements
- [ ] Add structured metrics:
  - Queue lengths (BullMQ)
  - Job durations
  - Token usage rates
  - API latencies
  - Error rates by type
- [ ] Consider Prometheus + Grafana for visualization
- [ ] Set up alerts for critical errors

**Tracking:** Create GitHub Issue `#TBD - Enhance logging and monitoring`

---

### 6.5 Resilience Improvements

**Tasks:**
- [ ] Handle Qdrant unavailability gracefully
  - Retry with exponential backoff
  - Circuit breaker pattern
  - Fall back to `PendingMemory` table
- [ ] Handle Postgres unavailability
  - Retry transient errors
  - Fail fast for permanent errors
- [ ] Handle LLM API failures
  - Retry with backoff
  - Fall back to simpler models
  - Return user-friendly error messages

**Tracking:** Create GitHub Issue `#TBD - Add resilience patterns`

---

### 6.6 API Gateway Async Pattern

**Current:** `/ai/generate?wait=true` holds HTTP connection

**Problem:** Can timeout for long jobs (Railway 5min limit)

**Solution:** Webhook callbacks

**Tasks:**
- [ ] Add optional `callbackUrl` to request body
- [ ] If provided, don't wait for job completion
- [ ] Return 202 Accepted with job ID
- [ ] When job completes, POST result to callback URL
- [ ] Handle callback failures (retry, dead letter queue)

**Tracking:** Create GitHub Issue `#TBD - Implement webhook callbacks`

---

### 6.7 Avatar Storage Evaluation

**Current:** Base64 in database + filesystem cache

**Problem:** Inefficient for large images; bloats database

**Alternatives:**
- Cloudflare R2 (S3-compatible)
- AWS S3
- Railway persistent volumes

**Tasks:**
- [ ] Evaluate storage costs and access patterns
- [ ] If migrating, implement upload to external storage
- [ ] Store URL reference in database instead of base64
- [ ] Update avatar serving endpoint
- [ ] Migrate existing avatars

**Tracking:** Create GitHub Issue `#TBD - Evaluate avatar storage options`

---

## Advanced Features (Future)

These require a solid foundation from Tiers 1-3 before implementation.

### Canon / Pantheon / Personality Relationships

**Concept:** Personalities aware of each other; share context via relationships

**Data Model:**
```prisma
model CanonGroup {
  id          String @id
  name        String @unique
  type        String  // 'narrative_universe', 'pantheon', 'friend_group'
  memberships PersonalityCanonMembership[]
  relationships PersonalityRelationship[]
}

model PersonalityCanonMembership {
  personalityId String
  personality   Personality @relation(...)
  canonGroupId  String
  canonGroup    CanonGroup @relation(...)
  roleInGroup   String?
  @@id([personalityId, canonGroupId])
}

model PersonalityRelationship {
  id                 String
  fromPersonalityId  String
  toPersonalityId    String
  relationshipType   String  // 'couple', 'family', 'rival'
  canonGroupId       String?
  rules              Json?   // {"shareDirectInteractions": true, "shareAs": "witnessed"}
}
```

**Memory Propagation:**
1. User A talks to Personality B (direct interaction)
2. Check B's relationships for sharing rules
3. If B → C relationship with `shareDirectInteractions: true`
4. Create "witnessed" memory for Personality C
5. When C talks to User A, retrieve witnessed memories
6. Format as: "You observed User A telling Personality B about X"

**Tasks (Future):**
- [ ] Implement schema
- [ ] Create canon/relationship management commands
- [ ] Update `MemoryStorer` for propagation
- [ ] Update `MemoryRetriever` to fetch different interaction types
- [ ] Update `PromptBuilder` to format witnessed/gossip memories

**Tracking:** Create GitHub Issue `#TBD - Implement canon and personality relationships`

---

### Free Will Feature

**Concept:** Personalities proactively join conversations when relevant

**Approach:** Multi-stage LLM decision process via BullMQ

**Workflow:**
```
User message in channel
  ↓
Job 1: Triage (cheap LLM)
  → Should ANY personality respond?
  ↓
Job 2: Speaker Selection (smart LLM)
  → WHICH personality should speak?
  ↓
Job 3: Generate Response
  → Create normal /ai/generate job
```

**Governance:**
- Toggleable at personality level
- Toggleable at channel/server level
- Toggleable at user preference level
- Cooldown between proactive responses
- Respect user blocks/mutes

**Cost Model:**
- Jobs 1 & 2: Owner's API key (orchestration cost)
- Job 3: TBD - Owner's key OR user who enabled free will

**Tasks (Future):**
- [ ] Add database fields for free will toggles
- [ ] Implement triage job processor
- [ ] Implement speaker selection processor
- [ ] Add governance checks
- [ ] Decide on cost attribution
- [ ] Create configuration commands

**Tracking:** Create GitHub Issue `#TBD - Implement Free Will feature`

---

### Memory Consistency & Cleanup

**Problem:** LLMs hallucinate; bad info gets stored and compounds

**Solutions:**
1. **Source Confidence Metadata**
   - `personality_canon` = high confidence
   - `user_fact` = high confidence
   - `URP` = medium
   - `conversation_chunk` = medium-low
   - `verbatim_turn` = low

2. **Consistency Checks**
   - During summarization/URP update
   - Prompt LLM to identify contradictions
   - Flag for review

3. **User Feedback**
   - `/memory flag <id>` - Mark as questionable
   - `/memory correct <id> <text>` - Suggest correction

4. **Cleanup Script**
   - Fetch recent memories + URP
   - Use capable LLM to identify contradictions
   - Log findings for manual review
   - Eventually: Automate simple fixes

**Tasks (Future):**
- [ ] Add confidence metadata to memories
- [ ] Implement contradiction detection in summarizer
- [ ] Create memory flagging system
- [ ] Build cleanup analysis script
- [ ] Create review workflow

**Tracking:** Create GitHub Issue `#TBD - Implement memory consistency tools`

---

## Implementation Guidelines

### Working with Claude Code

**Documentation:**
- All docs go in `docs/` with logical subdirectories
- Architecture → `docs/architecture/`
- Features → `docs/features/`
- Guides → `docs/guides/`
- Database → `docs/database/`
- Ask Claude Code to update EXISTING docs instead of creating new ones

**Scripts:**
- Reusable utilities → `packages/common-types/src/utils/` OR `scripts/lib/`
- One-off migrations → `scripts/migrations/`
- Analysis scripts → `scripts/analysis/`
- Push back on one-off scripts for recurring tasks

**Feature Development:**
- Use GitHub Issues for tracking
- One issue per feature/task
- Link PRs to issues (`Fixes #123`)
- Use labels: `feature`, `bug`, `refactor`, `LTM`, `BYOK`, etc.
- Use milestones for grouping (e.g., "v3.1 Core Features")

### Vertical Slice Development

**Instead of:** Implementing all of canon relationships at once

**Do:** Start with one simple slice
1. Create basic `CanonGroup` table
2. Add personalities to a group
3. Store ONE type of shared memory (witnessed)
4. Retrieve and display it
5. Test end-to-end

**Then:** Add complexity (relationship types, rules, gossip, etc.)

### Feature Flags

Use simple flags to merge code without exposing unstable features:

```typescript
// In getConfig()
const ENABLE_SUMMARIZATION = process.env.ENABLE_SUMMARIZATION === 'true';
const ENABLE_FREE_WILL = process.env.ENABLE_FREE_WILL === 'true';
const ENABLE_CANON_SHARING = process.env.ENABLE_CANON_SHARING === 'true';
```

### User Story Format

When creating GitHub Issues, use user story format:

```
As a [user type]
I want [goal]
So that [benefit]

Acceptance Criteria:
- [ ] Criterion 1
- [ ] Criterion 2

Technical Notes:
- Implementation details
- Dependencies
```

**Example:**
```
As a user
I want to manage my personas
So that the AI understands different aspects of my identity

Acceptance Criteria:
- [ ] Can create persona with name and description
- [ ] Can edit existing personas
- [ ] Can set default persona
- [ ] Can view list of my personas

Technical Notes:
- Commands: /persona create, /persona edit, /persona set-default, /persona list
- Uses Discord modals for multi-field input
- Integrates with UserService (Prisma)
- Updates UserDefaultPersona table
```

### Regular Review

**Weekly:**
- Review file structure; consolidate documentation
- Identify repeated code in scripts → refactor to reusable functions
- Update this roadmap based on progress
- Check if current work aligns with tier priorities

**After Major Features:**
- Update ARCHITECTURE_DECISIONS.md
- Document any schema changes
- Update relevant READMEs

---

## Next Steps

1. **Review this roadmap** - Adjust priorities based on your goals
2. **Create GitHub Issues** - Start with Tier 1 items
3. **Set up labels & milestones** - Organize issues
4. **Start with 1.1 or 1.2** - Begin foundational work
5. **Track progress** - Update issue status as you work

**Remember:** Focus on one tier at a time. Build a solid foundation before adding complexity.
