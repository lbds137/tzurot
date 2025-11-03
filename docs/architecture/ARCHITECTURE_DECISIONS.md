# Architecture Decisions from Gemini Consultation

> This document captures the key architectural decisions and design principles from the initial planning conversation with Gemini AI that shaped the tzurot v3 architecture.

**Date:** 2025-10-02
**Source:** Initial Gemini planning conversation
**Status:** Foundational decisions implemented in v3

---

## Core Architectural Principles

### 1. Monorepo Architecture

- **Decision:** Use a TypeScript monorepo with pnpm workspaces
- **Rationale:**
  - Simplified dependency management
  - Atomic commits across services
  - Easy code sharing via `packages/`
  - Railway has excellent monorepo support
- **Implementation:** Services in `services/`, shared code in `packages/`

### 2. Microservices Separation

- **Decision:** Split into 3 core services: bot-client, api-gateway, ai-worker
- **Rationale:**
  - **bot-client**: Stateless Discord.js interface
  - **api-gateway**: HTTP router and job queue manager
  - **ai-worker**: Heavy AI processing with job queue
- **Key Benefit:** Scalability, clear separation of concerns

### 3. Asynchronous Task Queue

- **Decision:** Use BullMQ with Redis for job processing
- **Rationale:**
  - Discord bot stays responsive (no blocking on slow AI calls)
  - Job polling pattern for async AI generation
  - Can scale workers independently
- **Implementation:** API Gateway creates jobs, AI Worker processes them

---

## AI & Memory Architecture

### 4. LangChain.js Integration

- **Decision:** Use LangChain for AI orchestration instead of manual API calls
- **Rationale:**
  - Built-in RAG (Retrieval-Augmented Generation) support
  - Standardized LLM wrappers (works with OpenRouter)
  - Memory management primitives
  - Agent/tool capabilities for future features
- **Key Components:**
  - `ChatOpenAI` for OpenRouter integration
  - `ConversationBufferMemory` for short-term memory
  - `RetrievalChain` for long-term memory (RAG)

### 5. Vector Database for Long-Term Memory

- **Decision:** Use managed vector DB (Pinecone recommended) for personality memory
- **Rationale:**
  - Semantic search for relevant past conversations
  - Scalable memory without code complexity
  - LangChain has native integrations
- **Implementation:** Text → Embeddings → Vector Store → RAG

### 6. Multi-Scoped Memory System

**Decision:** Three layers of memory with metadata filtering

**Global Canon (Universal Truth):**

- Foundational personality traits
- Metadata: `{ "canonScope": "global", "personalityId": "..." }`
- Read-only baseline for all interactions

**Personal Canon (User-Specific):**

- Individual relationship history per user
- Metadata: `{ "canonScope": "personal", "personalityId": "...", "userId": "..." }`
- User A's experience ≠ User B's experience

**Session Canon (Roleplay Bubbles):**

- Temporary shared universes for multi-user roleplay
- Metadata: `{ "canonScope": "session", "sessionId": "..." }`
- Isolated from personal canons unless reconciled

**Benefits:**

- Private roleplays stay private
- Shared universes are opt-in
- Organic relationship evolution without chaos

---

## Advanced Features (Planned)

### 7. Personality "Free Will" System

**Decision:** Proactive multi-agent system using LangGraph

**Architecture:**

- **Triage Node:** Fast/cheap model decides if conversation is interesting
- **Context Gathering:** Fetch recent messages, URPs, available personalities
- **Speaker Selection:** High-reasoning LLM chooses best personality to respond
- **Governance Check:** Permissions/cooldowns/user preferences
- **Invocation:** Trigger personality if approved

**Cost Model:**

- Orchestrator uses bot owner's API key (observation is your cost)
- Executor uses end-user's API key (conversation is their cost)

### 8. Bring-Your-Own-Key (BYOK) System

**Decision:** User-managed API credentials with optional sharing

**Security:**

- Encrypted storage (AES-256-GCM)
- Master key in Railway environment variables
- DM-only/ephemeral slash commands for key management

**Sharing Model:**

- Users can share their API keys with friends
- Usage tracking for transparency
- Owner can revoke access anytime

**Commands:**

- `/keys set provider:<name> key:<key>`
- `/keys list`
- `/keys remove provider:<name>`

### 9. User Relationship Profiles (URPs)

**Decision:** Living documents that summarize personality-user relationships

**Content:**

- Key facts about the user
- Relationship tone and dynamics
- Inside jokes and shared history
- Boundaries and privacy preferences

**Update Mechanism:**

- Background agent runs periodically
- Analyzes recent conversations
- Uses high-reasoning LLM to update profile
- Stored as special document in vector DB: `{ "type": "URP", "personalityId": "...", "userId": "..." }`

---

## Memory Sharing & Relationships

### 10. Social Graph for Personality Relationships

**Decision:** Define relationships between personalities via configuration

**Example Structure:**

```json
{
  "graphs": {
    "hazbin_hotel": {
      "type": "narrative_universe",
      "relationships": [
        {
          "from": "charlie",
          "to": "vaggie",
          "type": "couple",
          "rules": ["share_all_direct_user_interactions", "gossip_about_others"]
        }
      ]
    },
    "abrahamic_pantheon": {
      "rules": {
        "propagate_all_user_interactions": { "to": "all_members", "as": "witnessed" }
      }
    }
  }
}
```

**Memory Propagation:**

- Single conversation creates multiple vector entries
- Metadata tracks `interactionType`: `direct`, `shared`, `witnessed`
- Metadata tracks `sharedFrom`: which personality shared it
- Enables realistic "gossip" and omniscient deity behavior

### 11. Privacy & Contextual Discretion

**Decision:** Two-layer privacy system

**Hard Rules (Metadata Filtering):**

- `contextType`: `dm`, `private_channel`, `public_channel`
- Public channels can't retrieve DM memories
- Enforced at database query level

**Soft Rules (Agentic Reasoning):**

- "Discretion Node" in LangGraph
- LLM evaluates: "Is this memory appropriate to share right now?"
- Can self-censor based on social context

---

## Data Migration & Integration

### 12. ETL Pipeline for Legacy Data

**Decision:** Dedicated `importer-service` for one-time migrations

**Extract:**

- Shapes.inc: Undocumented UI APIs with session cookie
- SpicyChat: Chrome DevTools JSON exports

**Transform:**

- Map personality definitions to new schema
- Convert chat histories to vector-ready documents
- Rich metadata: `userId`, `personalityId`, `sourcePlatform`, `timestamp`, etc.

**Load:**

- Batch upload to vector database
- Bootstrap URPs using LLM to summarize entire chat histories
- Preserve relationship context from day one

---

## Technology Stack

### Core Technologies

- **Language:** TypeScript
- **Monorepo:** pnpm workspaces
- **Discord:** discord.js v14
- **API Gateway:** Fastify (modern, performant)
- **Task Queue:** BullMQ + Redis
- **AI Framework:** LangChain.js
- **Vector DB:** Pinecone (managed) or Qdrant (self-hosted)
- **Database:** PostgreSQL (relational data, encrypted credentials)
- **Deployment:** Railway

### LangChain Components

- `ChatOpenAI` - OpenRouter integration
- `ConversationBufferMemory` - Short-term memory
- `PineconeStore` - Vector storage integration
- `RetrievalChain` - RAG implementation
- `AgentExecutor` - Basic agents
- `LangGraph` - Complex agent workflows

---

## Design Philosophy

### Avoid Shapes.inc Mistakes

1. **No monolithic architecture** - Use microservices
2. **User-funded costs** - BYOK model
3. **Robust memory** - Multi-scoped, filterable
4. **Privacy by design** - Hard + soft rules
5. **Relationship awareness** - Social graphs, URPs
6. **Scalable from start** - Async job queue, vector DB

### When to Use What

- **Simple agents:** LangChain `AgentExecutor`
- **Complex workflows:** LangGraph (moderation, free will)
- **Short-term memory:** `ConversationBufferMemory` (per channel/personality)
- **Long-term memory:** Vector DB with metadata filtering
- **Relationship tracking:** URPs + Social Graph
- **Cost management:** BYOK + hybrid orchestrator/executor model

---

## Future Enhancements

### LangGraph Use Cases

1. **Moderation Agent:** Multi-step reasoning with human approval
2. **Free Will Agent:** Proactive conversation participation
3. **Canon Reconciliation:** Update personal/global canons from roleplay events
4. **Discretion Agent:** Contextual privacy decisions

### Advanced Memory Features

1. **Organic relationship evolution:** Background agents update relationship profiles
2. **Multi-user roleplay:** Session canons with reconciliation
3. **Fandom universes:** Character-aware memory sharing (e.g., Hazbin Hotel cast)
4. **Spiritual pantheons:** Omniscient deity behavior with witnessed memories

---

## Key Takeaways

1. **Start simple, layer complexity:** Basic LangChain → Advanced agents → LangGraph
2. **Memory is everything:** Multi-scoped, filtered, relationship-aware
3. **Privacy is non-negotiable:** Encryption, metadata filtering, agentic discretion
4. **Cost sustainability:** BYOK model with strategic sharing
5. **User experience focus:** Proactive agents, persistent relationships, context-aware responses

This architecture provides the foundation to build AI personalities that feel truly alive, aware, and personal - far superior to anything Shapes.inc achieved.
