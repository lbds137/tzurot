# OpenMemory Migration Plan

**Status:** Planning Phase → Ready for Phase 1
**Target Completion:** 6-9 weeks (full vision including Phase 9)
**Priority:** High (Major Architecture Enhancement)
**Development Strategy:** Feature freeze on `develop` branch - full focus on architecture refactor

> **Related Discussion (Archived):** [Gemini-OpenMemory\_ Cognitive AI Memory System.md](../archive/Gemini-OpenMemory_%20Cognitive%20AI%20Memory%20System.md) - Initial exploration that led to this migration. Note: Some assumptions in that chat were corrected through our own deep codebase analysis.

## Executive Summary

This document outlines the plan to migrate Tzurot's long-term memory system from pgvector to OpenMemory, a sophisticated cognitive architecture that delivers:

- **Multi-sector memory classification** (episodic, semantic, emotional, procedural, reflective) with sector-specific decay rates
- **Waypoint graph system** with associative propagation, strengthening, and decay
- **Hybrid scoring algorithm** combining similarity, token overlap, waypoints, recency, and keyword matching
- **Adaptive query expansion** that automatically uses graph connections when confidence is low
- **Multiple learning mechanisms** including retrieval reinforcement, feedback scores, and contextual propagation
- **Smart essence extraction** with sentence scoring by temporal references, actions, entities, and questions
- **Automated memory clustering** through deterministic reflection (no LLM = no NSFW censorship issues!)
- **Foundation for agentic toolbox architecture**

**Key Finding:** After deep codebase analysis, OpenMemory's architecture is genuinely sophisticated - the deterministic reflection doesn't diminish its cognitive capabilities. It's a massive upgrade from basic pgvector with manual thresholds.

## Research Findings

### OpenRouter Embeddings & SDK

**Current Status (as of 2025-11-05):**

**Embeddings API:**

- ✅ OpenRouter provides an OpenAI-compatible embeddings API
- ✅ Endpoint: `https://openrouter.ai/api/v1/embeddings`
- ✅ Available models:
  - `openai/text-embedding-3-large` ($0.13/million tokens) **← SELECTED**
  - `openai/text-embedding-3-small` (cheaper alternative)
  - `google/gemini-embedding-001` (MTEB leaderboard leader)
  - `qwen/qwen3-embedding-0.6b` (text embedding & ranking)
  - `mistralai/mistral-embed-2312` (RAG-optimized, 1024-dim)
- ✅ Can use OpenAI SDK by changing base URL
- 💡 **Decision:** Use `text-embedding-3-large` for best quality

**TypeScript SDK:**

- ✅ Official `@openrouter/ai-sdk-provider` package available
- ✅ Integrates with Vercel AI SDK
- ✅ Access to 300+ models
- ⚠️ Embeddings support unclear in SDK docs
- 💡 **Recommendation:** Use OpenAI SDK with OpenRouter base URL for embeddings

**Implementation Approach:**

```typescript
// For chat completions - use OpenRouter SDK
import OpenRouter from '@openrouter/ai-sdk-provider';

// For embeddings - use OpenAI SDK with OpenRouter endpoint
import OpenAI from 'openai';

const embeddingsClient = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    'HTTP-Referer': process.env.YOUR_SITE_URL,
    'X-Title': 'Tzurot',
  },
});
```

### Reflection System Implementation - RESEARCH UPDATE

**Initial Research (2025-11-05 morning):**

Assumed OpenMemory's reflection job would use an LLM for memory consolidation. Researched uncensored models:

**Venice Uncensored Dolphin Mistral 24B** (`venice/uncensored:free`)

- FREE via Venice/OpenRouter partnership
- 2.2% refusal rate (perfect for NSFW)
- 24B parameters

**Codebase Analysis (2025-11-05 afternoon):**

After examining the actual OpenMemory source code:

- ✅ Reflection system is **100% deterministic** (no LLM)
- ✅ Uses cosine similarity clustering on word frequency vectors
- ✅ Generates summaries via pattern matching
- ✅ No LLM configuration needed

**Decision:** No uncensored LLM needed for reflection. System works via algorithmic clustering. If we want LLM-based memory consolidation in the future, we'll build it as a Phase 9 agentic tool.

## Migration Phases

### Phase 0: Pre-Migration Research & Preparation (CURRENT)

**Tasks:**

- [x] Research OpenMemory architecture and capabilities
- [x] Research OpenRouter embeddings support
- [x] Document current Tzurot memory implementation
- [ ] Set up OpenMemory locally for testing
- [ ] Prototype simple OpenMemory integration
- [ ] Test OpenRouter embeddings API

**Deliverables:**

- This migration plan document
- Local OpenMemory development environment
- Working embeddings prototype

### Phase 1: Infrastructure Setup (2-3 days)

**Railway Services:**

1. Provision new PostgreSQL database for OpenMemory
   - Separate from Tzurot database
   - Configure pgvector extension if needed

2. Deploy OpenMemory backend service
   - Use official `caviraoss/openmemory` Docker image
   - Configure environment variables (see Configuration section)
   - Set up Railway private networking

**Environment Variables:**

```bash
# OpenMemory Backend Service - Database Configuration
OM_METADATA_BACKEND=postgres
OM_VECTOR_BACKEND=pgvector
OM_PG_HOST=<railway-postgres-host>
OM_PG_PORT=5432
OM_PG_DB=openmemory
OM_PG_USER=<railway-postgres-user>
OM_PG_PASSWORD=<railway-postgres-password>
OM_PG_SCHEMA=public
OM_PG_SSL=require

# Performance tier - use real AI embeddings with full 1536 dimensions
OM_TIER=deep  # Options: fast, smart, deep, hybrid

# Embeddings - OpenRouter with text-embedding-3-large
OM_EMBEDDINGS=openai  # Use OpenAI-compatible API
OM_OPENAI_BASE_URL=https://openrouter.ai/api/v1  # Point to OpenRouter
OM_OPENAI_MODEL=openai/text-embedding-3-large  # Specific model
OPENAI_API_KEY=<your-openrouter-api-key>  # OpenRouter API key
OM_VEC_DIM=1536  # Full dimensions for text-embedding-3-large

# Decay configuration - mimic human REM sleep (once daily)
OM_DECAY_INTERVAL_MINUTES=1440  # Run decay once per day (default)
# Note: Decay rates per sector are hardcoded in the codebase:
#   - Episodic: 0.015 (events fade faster)
#   - Semantic: 0.005 (facts persist longer)
#   - Emotional: 0.020 (feelings fade quickly)
#   - Procedural: 0.008 (how-tos persist)
#   - Reflective: 0.001 (insights persist longest)

# Auto-Reflection - Enable deterministic memory clustering
OM_AUTO_REFLECT=true  # Enable automatic reflection
OM_REFLECT_INTERVAL=10  # Run every 10 minutes
OM_REFLECT_MIN_MEMORIES=20  # Minimum memories before reflection

# Optional: Server configuration
OM_PORT=8080
OM_API_KEY=<generate-a-secure-key>  # For API authentication
OM_LOG_AUTH=false  # Enable for debugging
```

**Tasks:**

- [ ] Create Railway service from OpenMemory Dockerfile
- [ ] Provision separate Postgres database
- [ ] Configure environment variables
- [ ] Test health endpoints
- [ ] Verify OpenMemory can connect to database
- [ ] Document Railway deployment configuration

**Deliverables:**

- Running OpenMemory service on Railway
- Documented deployment configuration
- Health check verification

### Phase 2: Code Implementation - HTTP Client (3-4 days)

**Files to Create:**

1. **`packages/common-types/src/openMemoryTypes.ts`**
   - OpenMemory request/response types
   - Memory metadata interfaces
   - Canon type definitions

2. **`services/ai-worker/src/memory/OpenMemoryAdapter.ts`**
   - HTTP client for OpenMemory API
   - Methods: `addMemory()`, `queryMemories()`, `editMemory()`, `listMemories()`
   - Error handling and retries
   - Timeout configuration

3. **`services/ai-worker/src/memory/OpenMemoryEmbeddingsProvider.ts`**
   - OpenRouter embeddings client
   - Replaces OpenAI embeddings calls
   - Model configuration (text-embedding-3-large by default)

**Files to Modify:**

1. **`services/ai-worker/src/services/ConversationalRAGService.ts`**
   - Replace `PgvectorMemoryAdapter` with `OpenMemoryAdapter`
   - Update `storeInteraction()` to call OpenMemory `/add` endpoint
   - Update `retrieveRelevantMemories()` to call `/query` endpoint
   - Add sector-specific queries (episodic vs semantic)
   - Remove manual `scoreThreshold` and `limit` logic (OpenMemory handles this)

2. **`services/ai-worker/src/services/PendingMemoryProcessor.ts`**
   - Update to use new `OpenMemoryAdapter`
   - Keep existing retry logic (still valuable)

**Tasks:**

- [ ] Create OpenMemoryAdapter with HTTP client
- [ ] Create OpenMemoryEmbeddingsProvider
- [ ] Update ConversationalRAGService
- [ ] Update PendingMemoryProcessor
- [ ] Add comprehensive error handling
- [ ] Write unit tests for new adapters

**Deliverables:**

- Working OpenMemory HTTP client
- Updated RAG service
- Test coverage for new code

### Phase 3: Data Migration (2-3 days)

**Migration Script:** `scripts/migrate-to-openmemory.ts`

**Strategy:**

1. Export existing memories from Tzurot Postgres

   ```sql
   SELECT id, content, "createdAt", "personaId", "personalityId", "guildId", "channelId"
   FROM memories
   ORDER BY "createdAt" ASC;
   ```

2. For each memory:
   - POST to OpenMemory `/add` endpoint
   - Include metadata: `persona_id`, `personality_id`, `guild_id`, `channel_id`
   - Add `source_system: "tzurot-v2-import"` tag
   - Respect rate limits (batch processing)
   - Track progress and handle errors

3. Migrate personality static data
   - Extract large text fields from `Personality` table
   - Store as semantic memories with `canon_type: "personality_fact"`
   - Tag with `personality_id`

**Tasks:**

- [ ] Write migration script
- [ ] Test on small subset (100 memories)
- [ ] Run full migration in dev environment
- [ ] Verify data integrity
- [ ] Create rollback procedure

**Deliverables:**

- Data migration script
- Migration log and verification
- Rollback procedure documentation

### Phase 4: Database Sync Strategy Update (1-2 days)

**New Sync Strategy:**

1. **Keep existing `db-sync` for Tzurot (Config) DB**
   - Personalities, Users, LlmConfigs, ActivatedChannel
   - Still needs 1:1 dev/prod sync

2. **Create `db-backup` for OpenMemory (State) DB**

   ```bash
   # Run nightly via cron or Railway scheduled job
   pg_dump $OPENMEMORY_DB_URL > backups/openmemory_$(date +%Y%m%d).sql
   # Upload to S3 or Railway volume
   ```

3. **Create `db-seed` for OpenMemory Dev**

   ```bash
   # Wipe dev database
   psql $OPENMEMORY_DEV_DB_URL -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

   # Load seed data
   psql $OPENMEMORY_DEV_DB_URL < scripts/openmemory_seed.sql
   ```

4. **Create `openmemory_seed.sql`**
   - Curated set of ~100 test memories
   - Predictable, known state for testing
   - Includes memories for COLD personality
   - Various canon types and sectors

**Tasks:**

- [ ] Update db-sync command to skip OpenMemory
- [ ] Create db-backup script
- [ ] Create db-seed script
- [ ] Generate openmemory_seed.sql
- [ ] Document new sync workflow

**Deliverables:**

- Updated sync scripts
- Seed data file
- Documentation of new workflow

### Phase 5: Personality Definition Refactoring (3-4 days)

**Goal:** Slim down personality system prompts by moving static data to OpenMemory

**Current Bloat:**

```typescript
// Personality table fields that take up massive tokens:
- characterInfo (long)
- personalityTraits (long)
- personalityLikes (long)
- personalityDislikes (long)
- conversationalExamples (very long)
```

**New Architecture:**

```typescript
// Minimal Personality table:
- id
- name
- slug
- systemPromptId (references lean core prompt)
- avatarUrl
- basic config (model, temperature, etc.)

// Everything else moved to OpenMemory as semantic memories
```

**Implementation:**

1. **Migration Script:** `scripts/migrate-personality-data.ts`

   ```typescript
   for (const personality of personalities) {
     // Store each field as separate semantic memory
     await openMemory.add({
       text: `Character Info: ${personality.characterInfo}`,
       metadata: {
         personality_id: personality.id,
         canon_type: 'personality_fact',
         source_field: 'characterInfo',
       },
       sector_override: 'semantic',
     });

     // Repeat for traits, likes, dislikes, examples
   }
   ```

2. **Update `ConversationalRAGService.buildSystemPrompt()`**
   - Query OpenMemory for personality facts

   ```typescript
   const personalityFacts = await this.memoryAdapter.queryMemories({
     query: userMessage, // Current message for relevance
     where: {
       personality_id: personality.id,
       canon_type: 'personality_fact',
     },
     sector: 'semantic',
   });

   // Inject only relevant facts into system prompt
   ```

**Tasks:**

- [ ] Create personality data migration script
- [ ] Update system prompt building logic
- [ ] Test with COLD personality
- [ ] Measure token savings
- [ ] Verify personality behavior unchanged

**Deliverables:**

- Slimmed personality definitions
- Token usage metrics (before/after)
- Updated system prompt logic

### Phase 6: Memory Management Commands (2-3 days)

**User-Facing Commands:** (Implement in `bot-client`)

1. **`/memory list [limit] [filter]`**
   - Lists recent memories for current persona
   - Shows: ID, content preview, salience, timestamp
   - Optional filters: sector, canon_type

2. **`/memory get <id>`**
   - Fetches full memory details
   - Shows metadata, salience, sector

3. **`/memory edit <id> --salience <value>`**
   - Edits memory salience (for cleanup)
   - Set to 0 to effectively "delete"

4. **`/memory search <query>`**
   - Semantic search across memories
   - Shows relevant memories

5. **`/persona set <field> <value>`**
   - Updates persona seed data
   - Triggers OpenMemory upsert

**Implementation:**

- Create command handlers in `bot-client/src/commands/memory/`
- Add permission checks (user can only manage own memories)
- Call OpenMemory API endpoints (`/query`, `/get`, `/edit`)
- Format responses with Discord embeds

**Tasks:**

- [ ] Implement memory command handlers
- [ ] Add permission checks
- [ ] Create Discord embed formatters
- [ ] Test all commands
- [ ] Document usage in /help

**Deliverables:**

- Working memory management commands
- User documentation
- Permission system

### Phase 7: Testing & Verification (3-4 days)

**Test Plan:**

1. **Unit Tests**
   - OpenMemoryAdapter methods
   - OpenMemoryEmbeddingsProvider
   - Error handling and retries

2. **Integration Tests**
   - Full conversation flow with memory storage/retrieval
   - Personality fact injection
   - Memory management commands

3. **Manual Testing**
   - Long conversations with COLD personality
   - Verify memory relevance
   - Test token savings
   - Verify LLM output quality unchanged or improved

4. **Performance Testing**
   - Response time comparison (before/after)
   - Token usage metrics
   - OpenMemory API latency

5. **Edge Cases**
   - Empty memory responses
   - OpenMemory service downtime
   - Invalid memory IDs
   - Rate limiting

**Tasks:**

- [ ] Write comprehensive test suite
- [ ] Run integration tests in dev
- [ ] Perform manual testing
- [ ] Document any issues
- [ ] Fix bugs found in testing

**Deliverables:**

- Test suite with high coverage
- Performance metrics
- Bug fixes

### Phase 8: Production Deployment (1-2 days)

**Deployment Checklist:**

- [ ] Verify all tests passing
- [ ] Review Railway service configuration
- [ ] Check environment variables
- [ ] Create production database backup
- [ ] Deploy OpenMemory service to prod
- [ ] Run data migration in prod
- [ ] Deploy updated ai-worker
- [ ] Monitor logs for errors
- [ ] Test core functionality in prod
- [ ] Create GitHub Release with migration notes

**Rollback Plan:**

1. Revert ai-worker to previous version
2. Restore from database backup if needed
3. Keep OpenMemory service running (no harm)

**Tasks:**

- [ ] Execute deployment checklist
- [ ] Monitor production for 24 hours
- [ ] Address any issues
- [ ] Document lessons learned

**Deliverables:**

- Successful production deployment
- Monitoring data
- Release notes

## Phase 9: Advanced Features (Future Work)

These are post-migration enhancements unlocked by the new architecture:

### 9.0: Design Pattern Reference - LangChain DeepAgents

**Context (2025-11-06):** LangChain released DeepAgents, a Python library for building autonomous, long-running agents inspired by Claude Code, Deep Research, and similar tools.

**Why it's relevant:** While the library itself is Python-only (incompatible with our TypeScript stack), the architectural patterns are exactly what we want for Phase 9.

**Key DeepAgents Concepts to Steal:**

1. **Planning Tool (Todo Lists for Agent Focus):**
   - DeepAgents uses a `write_todos` tool that helps agents break down complex tasks
   - Functions as "context engineering" to maintain focus during long operations
   - **Our implementation:** Personalities can create internal todo lists when tackling multi-step requests

2. **File System for Context Management:**
   - Agents use a shared workspace to store notes and offload large context
   - Prevents context window overflow with variable-length tool results
   - **Our implementation:** Use OpenMemory sectors (episodic, semantic, procedural) as our "file system"

3. **Subagent Spawning:**
   - Specialized agents handle individual tasks for better context isolation
   - Enables parallel processing and domain-specific expertise
   - **Our implementation:** "Free Will" system (9.2) where personalities compete for salience match

4. **Detailed System Prompts with Examples:**
   - Long, detailed prompts with behavioral examples for various scenarios
   - **Our implementation:** Already doing this with personality definitions

**What We Already Have:**

OpenMemory includes LangChain/LangGraph integration:

- MCP (Model Context Protocol) tools in `backend/src/ai/mcp.ts`
- LangGraph integration in `backend/src/ai/graph.ts`
- Built-in tool system

**Implementation Strategy:**

- Use DeepAgents' architecture as inspiration for our TypeScript implementation
- Build our own agent harness integrated with Discord personalities
- Leverage OpenMemory's existing MCP tools as foundation
- Keep it personality-aware (tools available per personality config)

**Reference:**

- GitHub: https://github.com/langchain-ai/deepagents
- Blog: https://blog.langchain.com/deep-agents/

### 9.1: Agentic Toolbox (3-5 days)

**Refactor ConversationalRAGService → Agent Executor:**

- Move from static pipeline to dynamic tool selection
- LLM decides which tools to use

**Tools to Implement:**

1. **Memory Tools:**
   - `openmemory_query` - Query memories
   - `openmemory_store` - Store new memories
   - `openmemory_reinforce` - Boost memory salience

2. **Web Tools:**
   - `web_search` - Search the web (Tavily/SerpAPI)
   - `browse_url` - Fetch and parse URL content

3. **Creative Tools:**
   - `generate_image` - DALL-E/Midjourney integration
   - `synthesize_voice` - Text-to-speech for personalities

4. **Knowledge Tools:**
   - `ingest_document` - Process .txt/.pdf uploads
   - `calculate_gematria` - Existing custom tool
   - `draw_tarot_card` - Tarot readings
   - `get_astrology_chart` - Astrological analysis

5. **Admin Tools:**
   - `timeout_user` - Safe moderation (no kick/ban)

### 9.2: "Free Will" Feature (4-5 days)

**Proactive Agent System:**

- Background job checks active channels every 5 minutes
- Fetches last 10 messages (STM) for each active channel
- Queries OpenMemory for each personality with STM as query
- Personality with highest salience match (>0.85) "wins"
- That personality proactively chimes in

**Implementation:**

1. Create `ProactiveAgentJob` in ai-worker
2. Query `ActivatedChannel` table for potential speakers
3. Fetch recent channel history
4. Run OpenMemory queries for each personality
5. Compare salience scores
6. Trigger response for "winning" personality

### 9.3: Intelligent Memory Management (2-3 days)

**Agentic Memory Skills:**

- Personalities can recognize important information
- Call `openmemory_reinforce` when user says "remember this!"
- Detect contradictions and ask for clarification
- Update memories via `openmemory_edit`
- Promote memories by changing metadata

### 9.4: STM Reduction (1 day)

**Optimize Context Window:**

- Reduce STM from 30 → 10 messages
- Rely on OpenMemory's sector search for facts
- Measure token savings (expect 50-60% reduction)
- Verify LLM repetition issues resolved

## Configuration Reference

### OpenMemory Environment Variables

```bash
# Required - Database backends
OM_METADATA_BACKEND=postgres
OM_VECTOR_BACKEND=postgres
OM_DB_PATH=postgresql://user:pass@host:port/openmemory

# Performance tier - use real AI embeddings
OM_PERFORMANCE_TIER=deep  # Options: fast (synthetic), smart (hybrid), deep (AI)

# Decay configuration - mimic human REM sleep (once daily)
OM_DECAY_INTERVAL_MINUTES=1440  # Run decay once per day (24 hours)
OM_DECAY_LAMBDA=0.05  # Conservative decay rate (slower fading than default 0.1)
OM_DECAY_RATIO=0.3   # Gentler decay reduction (vs default 0.5)

# Reflection LLM - Venice Uncensored via OpenRouter
OPENROUTER_API_KEY=<your-openrouter-key>
# Note: May need to configure OpenMemory to use venice/uncensored:free
# Check OpenMemory docs or source for LLM model configuration

# Embeddings - OpenRouter with text-embedding-3-large
# OpenMemory will use OPENROUTER_API_KEY for embeddings
# Model: openai/text-embedding-3-large ($0.13/million tokens)
```

### Railway Services Architecture

```
Tzurot v3 (After Migration)
├── bot-client (existing)
├── api-gateway (existing)
├── ai-worker (existing, heavily modified)
├── tzurot-postgres (existing - config DB)
├── redis (existing)
├── openmemory-backend (NEW)
└── openmemory-postgres (NEW - memory DB)
```

## Additional Considerations & Open Questions

### 1. Sector Classification Accuracy

**Concern:** Will OpenMemory correctly classify NSFW/RP content into sectors?

**Known:** Classification uses regex patterns in `hsg.ts` for:

- Episodic (events/conversations)
- Semantic (facts/rules)
- Emotional (feelings)
- Procedural (how-tos)
- Reflective (meta-cognition)

**Action Items:**

- Test classification with real RP conversation data
- May need to fork OpenMemory to adjust sector regex patterns for NSFW context
- Can use `sector_override` parameter to manually specify sector if needed

### 2. OpenMemory Architecture - THOROUGHLY EVALUATED ✅

**Deep Codebase Analysis (2025-11-05):**

After thoroughly examining the OpenMemory source code (hsg.ts, reflect.ts, graph.ts, decay.ts), here's what we found:

**Reflection System:**

- ✅ Deterministic (no LLM) - uses cosine similarity clustering on word frequency vectors
- ✅ Smart cluster detection (>0.8 similarity threshold)
- ✅ Multi-factor salience calculation (60% cluster size, 30% recency, 10% emotional)
- ✅ **NO CENSORSHIP ISSUES** - huge win for NSFW/RP content!

**Core Architecture (Actually Sophisticated!):**

- ✅ Multi-sector vector embeddings with sector-specific decay rates
- ✅ Waypoint graph system with strengthening, decay, and associative propagation
- ✅ Hybrid scoring (60% similarity, 20% token overlap, 15% waypoints, 5% recency)
- ✅ Adaptive query expansion (automatically uses graph when confidence <0.55)
- ✅ Multiple learning mechanisms (feedback scores, retrieval reinforcement, contextual propagation)
- ✅ Smart essence extraction (scores sentences by dates, actions, entities, questions)
- ✅ Z-score normalization for final ranking
- ✅ Multi-layer caching (query cache, vector cache, salience cache, segment cache)

**Sector-Specific Decay Rates:**

- Episodic: 0.015 (events fade faster)
- Semantic: 0.005 (facts persist longer)
- Procedural: 0.008 (skills persist)
- Emotional: 0.020 (feelings fade quickly)
- Reflective: 0.001 (insights persist longest)

**Verdict:** OpenMemory's architecture is genuinely sophisticated - not marketing BS. The deterministic reflection doesn't diminish the system's cognitive capabilities because:

1. Cluster detection is smart (cosine similarity >0.8)
2. Salience calculation considers multiple factors
3. Reflections get full multi-sector embedding treatment
4. All learning/reinforcement mechanisms still apply
5. No LLM = no censorship issues for NSFW content

**Configuration:**

```bash
OM_AUTO_REFLECT=true  # Enable automatic reflection clustering
OM_REFLECT_INTERVAL=10  # Run every 10 minutes (default)
OM_REFLECT_MIN_MEMORIES=20  # Minimum memories before reflection
```

**Decision:** Use OpenMemory as-is - it's excellent! Way better than current pgvector setup. If we want LLM-based memory consolidation later, we can build it as a Phase 9 agentic tool.

---

## Key Advantages Discovered During Architecture Review

### 1. No NSFW Censorship Issues ✅

Unlike initially planned LLM-based reflection (Venice Uncensored), the deterministic approach has **zero** censorship concerns:

- No LLM refusing to process vampire sex roleplay
- No "I cannot assist with that content" errors
- No worrying about model updates changing behavior
- **Reflection works perfectly for ANY content**

### 2. Learning & Self-Improvement 🧠

OpenMemory isn't static - it learns from usage:

- **Feedback scores:** Exponential moving average of query performance
- **Retrieval reinforcement:** Memories gain salience when accessed
- **Associative propagation:** Connected memories strengthen together
- **Co-activation buffering:** Memories retrieved together link automatically
- **Waypoint decay:** Unused connections weaken over time

Result: The system gets smarter the more you use it!

### 3. Sophisticated Retrieval Beyond Simple Similarity 🎯

Current Tzurot uses basic cosine similarity with manual threshold. OpenMemory uses:

- **Multi-sector weighted scoring** (60% similarity, 20% overlap, 15% waypoints, 5% recency)
- **Adaptive expansion** (automatically follows graph connections when needed)
- **Z-score normalization** (proper statistical ranking)
- **Keyword boosting** (hybrid tier)
- **Sector-aware queries** (can search episodic vs semantic vs emotional)

Result: Way more relevant results than just "similar embeddings."

### 4. Cognitive Realism 🧠

The sector-specific decay rates mimic actual human memory:

- Facts (semantic) persist longest (0.005 decay)
- Events (episodic) fade moderately (0.015 decay)
- Feelings (emotional) fade quickly (0.020 decay)
- Insights (reflective) persist nearly forever (0.001 decay)

Result: Personalities will naturally "forget" unimportant details while retaining core knowledge.

### 5. Smart Essence Extraction 📝

Instead of storing full conversation dumps, OpenMemory scores and extracts key sentences:

- Temporal references (dates, times) +5
- Named entities (proper nouns) +3
- Action verbs (bought, visited, learned) +4
- Questions (who, what, when, where, why) +2
- First-person pronouns +1

Result: More efficient storage, better recall of important details.

### 6. Graph-Based Association 🕸️

Memories don't exist in isolation - they form a graph:

- **Cross-sector waypoints:** Same memory accessible via different cognitive sectors
- **Inter-memory waypoints:** Similar memories link together
- **Contextual waypoints:** Co-retrieved memories strengthen connections
- **Temporal decay:** Connections weaken based on time since co-activation

Result: Natural memory associations like human cognition.

### 7. Performance Tiers for Different Use Cases ⚡

- **deep (our choice):** Full 1536-dim embeddings, maximum cognitive features
- **smart:** Hybrid approach, good balance
- **fast:** Synthetic embeddings for speed
- **hybrid:** Adds keyword boosting on top of deep

Result: We get the full cognitive architecture with configurable performance.

---

### 3. Embeddings Cost Monitoring

**Concern:** Multi-vector system means 2-5x embedding costs per memory

**Mitigation:**

- Monitor embedding API usage closely in dev environment
- Track cost per memory added
- If costs become problematic:
  - Switch to text-embedding-3-small (cheaper)
  - Use OpenMemory's "smart" tier (hybrid synthetic + semantic)
  - Optimize memory storage frequency

### 4. Persona Seed Update Implementation

**Question:** How to handle persona seed updates when user runs `/persona set`?

**Proposed Approach:**

```typescript
// Query with specific field identifier
const existing = await openmemory.query({
  query: '',
  where: {
    persona_id: personaId,
    canon_type: 'user_fact',
    field_name: 'self_description', // Unique identifier
  },
});

// Update if found, create if not
if (existing.length > 0) {
  await openmemory.edit(existing[0].id, { text: newText });
} else {
  await openmemory.store({
    text: newText,
    metadata: {
      persona_id: personaId,
      canon_type: 'user_fact',
      field_name: 'self_description',
    },
  });
}
```

### 5. Railway Private Networking

**Action Item:** Research Railway service discovery and private networking

**Questions:**

- Can ai-worker communicate with openmemory-backend via service name?
- Do we need special configuration for Railway private network?
- What's the hostname format? `openmemory-backend:PORT` or different?

### 6. Database Growth Monitoring

**Action Items:**

- Monitor OpenMemory database size growth in dev
- Estimate production growth rate
- Plan for database scaling if needed
- Consider archival strategy for very old memories

### 7. Testing with "Living" Database

**Solution:**

- Use deterministic seed data for tests
- Disable background jobs in test environment (`OM_DECAY_INTERVAL_MINUTES=999999`)
- Mock OpenMemory API for unit tests
- Use separate test database we control fully

## Risks & Mitigation

### Risk 1: OpenMemory Service Instability

**Impact:** Memory operations fail, affecting all AI responses
**Mitigation:**

- Implement robust error handling in OpenMemoryAdapter
- Add circuit breaker pattern
- Fall back to "no memory" mode if OpenMemory down
- Monitor service health with alerts

### Risk 2: Increased Latency

**Impact:** Slower response times due to HTTP calls
**Mitigation:**

- Use Railway private networking (low latency)
- Implement request timeouts
- Cache frequently accessed memories
- Monitor and optimize query patterns

### Risk 3: Data Migration Issues

**Impact:** Lost or corrupted memories during migration
**Mitigation:**

- Test migration on small subset first
- Keep old pgvector data intact during migration
- Implement idempotent migration (can re-run)
- Verify data integrity after migration

### Risk 4: OpenRouter Embeddings Reliability

**Impact:** Embedding generation fails, blocking memory operations
**Mitigation:**

- Keep OpenAI as fallback option
- Implement retry logic with exponential backoff
- Monitor embedding API latency and errors
- Consider using OpenMemory's "fast" tier as emergency fallback

### Risk 5: Loss of Dev/Prod Parity

**Impact:** Harder to debug production issues in dev
**Mitigation:**

- Create comprehensive seed data that covers edge cases
- Document process for creating prod-like test scenarios
- Keep ability to restore prod backup to dev if critical debugging needed
- Use feature flags to test new memory features safely

## Success Criteria

### Phase 1-8 (Core Migration)

- [ ] OpenMemory service running stably on Railway
- [ ] All existing memories migrated successfully
- [ ] Personality definitions slimmed down
- [ ] Token usage reduced by 40-60% in prompts
- [ ] LLM response quality maintained or improved
- [ ] No degradation in response time
- [ ] All tests passing
- [ ] Memory management commands working
- [ ] Documentation updated

### Phase 9 (Advanced Features)

- [ ] Agentic toolbox implemented
- [ ] "Free will" feature working
- [ ] Personalities can manage their own memories
- [ ] STM reduced to 10 messages
- [ ] LLM repetition issues resolved

## Timeline Estimate

**Estimated in Work Sessions (AI-Assisted Development):**

The real bottlenecks are your available time for review/testing, Railway deploy cycles, and validation - not coding speed (AI assistance handles that quickly).

**Phase Breakdown:**

| Phase                         | Focused Sessions   | Description                                                     |
| ----------------------------- | ------------------ | --------------------------------------------------------------- |
| 1. Infrastructure Setup       | 1-2 sessions       | Deploy OpenMemory to Railway, configure env vars, verify health |
| 2. HTTP Client Implementation | 2-3 sessions       | Write OpenMemoryAdapter, update RAG service, test locally       |
| 3. Data Migration             | 1-2 sessions       | Write migration script, test subset, run full migration         |
| 4. DB Sync Strategy           | 1 session          | Update sync scripts, create seed data                           |
| 5. Personality Refactoring    | 2-3 sessions       | Move static data to semantic memory, test behavior              |
| 6. Memory Commands            | 1-2 sessions       | Implement /memory commands in bot-client                        |
| 7. Testing & Validation       | 2-3 sessions       | Write tests, manual testing, fix issues                         |
| 8. Production Deployment      | 1-2 sessions       | Deploy to prod, monitor, address issues                         |
| **Phases 1-8 Total**          | **10-15 sessions** | Core migration complete                                         |
| 9. Agentic Features           | 5-8 sessions       | Toolbox, "free will", intelligent memory management             |
| **Full Vision Total**         | **15-23 sessions** | Complete transformation                                         |

**Calendar Time Translation:**

- **2-3 sessions per week (aggressive):** Phases 1-8 in 4-6 weeks, Phase 9 adds 2-4 weeks → **6-10 weeks total**
- **1-2 sessions per week (realistic):** Phases 1-8 in 6-10 weeks, Phase 9 adds 4-6 weeks → **10-16 weeks total**
- **Focused sprint (3-4 sessions per week):** Phases 1-8 in 3-4 weeks, Phase 9 adds 2-3 weeks → **5-7 weeks total**

**What Constitutes a "Focused Session":**

- 2-4 hours of dedicated work time
- Deploy → test → fix cycle
- Review + decision-making included

**Key Advantages of AI-Assisted Development:**

- ✅ Code generation is near-instant
- ✅ Can parallelize research and implementation
- ✅ No context-switching fatigue
- ✅ Can draft next phase while you test current phase
- ✅ Instant codebase search and analysis
- ⚠️ Still constrained by: your availability, Railway deploy times, manual validation needs

**Recommended Approach:**

- Start with Phase 1 (infrastructure) to validate feasibility
- Proceed phase-by-phase with testing at each stage
- Don't rush - validate each phase before moving forward
- Phase 9 can be deferred to v3.1 or v4.0 if needed
- Real timeline will be determined by your schedule, not coding complexity

## Decision Log

**2025-11-05 - Initial Planning:**

- Decision: Proceed with OpenMemory migration
- Rationale: Addresses core memory sophistication pain points, enables agentic architecture
- Trade-offs accepted: Loss of dev/prod memory mirroring, increased DB size, additional Railway costs

**2025-11-05 - Finalized Configuration:**

1. **Memory Decay:** Enable with daily settings (1440 min interval, sector-specific lambda)
   - Rationale: Mimic human REM sleep pruning mechanism, essential to cognitive architecture
   - Alternative considered: Disable decay entirely (rejected - breaks how system is designed)
   - Note: Lambda values are hardcoded per sector (episodic 0.015, semantic 0.005, etc.)

2. **Reflection System:** Deterministic (no LLM needed!)
   - Rationale: After codebase analysis, reflection is deterministic clustering - no LLM configuration needed
   - **HUGE WIN:** No censorship issues for NSFW/RP content!
   - Alternative considered: Venice Uncensored LLM (not needed - reflection doesn't use LLMs)
   - Future option: Build custom LLM-based consolidation as Phase 9 agentic tool if desired

3. **Embeddings Model:** OpenRouter text-embedding-3-large ($0.13/million tokens)
   - Rationale: Highest quality, cost acceptable for project scale
   - Configuration: `OM_OPENAI_BASE_URL=https://openrouter.ai/api/v1`
   - Alternative considered: text-embedding-3-small (rejected - want best quality)

4. **Fallback Strategy:** All-in on OpenMemory, no pgvector fallback
   - Rationale: Railway infrastructure is all-or-nothing, single point of failure already
   - Alternative considered: Keep pgvector read-only (rejected - adds complexity)

5. **Development Approach:** Commit to full vision (Phases 1-9)
   - Rationale: Huge change, may as well get all benefits immediately
   - Consequence: Feature freeze on `develop` branch during 6-9 week refactor
   - Alternative considered: Defer Phase 9 to v3.1 (rejected - want agentic features now)

**2025-11-05 - Architecture Validation:**

After deep analysis of OpenMemory source code:

- ✅ **Architecture is genuinely sophisticated** - not marketing BS
- ✅ **Waypoint graph system** with associative propagation and learning
- ✅ **Hybrid scoring** with 5+ factors intelligently combined
- ✅ **Adaptive query expansion** and Z-score normalization
- ✅ **Multiple learning mechanisms** on every retrieval
- ✅ **Deterministic reflection is fine** - cluster detection is smart, no censorship concerns
- ✅ **Massive upgrade** from current basic pgvector implementation

**Decision:** Proceed with OpenMemory migration with high confidence.

## Next Steps

1. **Immediate (This Week):**
   - [ ] Set up local OpenMemory for testing
   - [ ] Prototype OpenRouter embeddings
   - [ ] Create proof-of-concept OpenMemoryAdapter

2. **Short Term (Next 2 Weeks):**
   - [ ] Deploy OpenMemory to Railway dev environment
   - [ ] Implement Phase 2 (HTTP client)
   - [ ] Test with small memory dataset

3. **Medium Term (Next Month):**
   - [ ] Complete Phases 1-6
   - [ ] Run comprehensive testing
   - [ ] Prepare for production deployment

## References

- [OpenMemory GitHub Repository](https://github.com/caviraoss/openmemory)
- [Gemini Analysis Document](../Gemini-OpenMemory_%20Cognitive%20AI%20Memory%20System.md)
- [OpenRouter API Documentation](https://openrouter.ai/docs)
- [OpenRouter Embeddings Models](https://openrouter.ai/models?category=embeddings)

---

**Document Version:** 3.0 (Architecture Validated)
**Last Updated:** 2025-11-05
**Author:** Nyx (Claude Code) & Lila
**Status:** Planning Complete - Architecture Validated - Ready for Phase 1 (Infrastructure Setup)
**Development Strategy:** Feature freeze on `develop` - full commitment to Phases 1-9
**Confidence Level:** HIGH - Deep codebase analysis confirms OpenMemory delivers on its promises
