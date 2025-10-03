# shapes.inc Migration Strategy

## Overview

This document outlines the strategy for migrating personality data from shapes.inc format to Tzurot v3's database architecture.

## File Structure Analysis

Each personality in shapes.inc has multiple JSON files:

```
personality-slug/
├── personality-slug.json              # Core config (403 lines)
├── personality-slug_chat_history.json # Raw conversations (40K lines)
├── personality-slug_memories.json     # LTM summaries (231K lines!)
├── personality-slug_knowledge.json    # Background lore/docs (111 lines)
└── personality-slug_user_personalization.json  # Per-user overrides (19 lines)
```

## Storage Architecture

### PostgreSQL (Relational Data)
- Core personality configuration
- UUID-based identity system
- User ownership (many-to-many via `personality_owners`)
- Per-user personality customization
- Activated channels
- Persistent conversation history
- Voice/image generation settings

### ChromaDB (Vector/Semantic Data)
- Long-term memories (LTM) with embeddings
- Knowledge documents
- Historical chat for RAG retrieval
- Semantic search capabilities

### In-Memory (Ephemeral)
- Recent conversation context (last N messages)
- Active sessions

## Migration Phases

### Phase 1: Core Data (Postgres) - Immediate
1. **Personality Core**
   - Import main personality config
   - Generate UUIDs for personalities without them
   - Map shapes.inc fields to Tzurot schema

2. **User & Ownership Model**
   - Import user records (UUID-based)
   - Create ownership relationships
   - Import per-user personalization settings

3. **Conversation Persistence**
   - Replace in-memory conversation manager
   - Store last N messages per channel+personality in DB
   - Add TTL/cleanup policies

4. **Channel Activation**
   - Import activated channel settings
   - Auto-respond configuration

### Phase 2: Vector Storage (ChromaDB) - Later
1. **Memory Import**
   - Index existing LTM summaries
   - Generate embeddings for RAG
   - Set up semantic search

2. **Knowledge Base**
   - Import knowledge documents
   - Create personality-specific collections
   - Enable contextual retrieval

3. **Chat History Processing**
   - See "LTM Decision" section below

## Critical Decision: LTM/Chat History Handling

### The Problem

shapes.inc exports contain:
- **Chat History**: Raw conversation messages (40K lines)
- **Memories**: AI-generated LTM summaries (231K lines)
- **Relationship**: Memories have UUIDs linking to chat messages they summarize

We need to decide: **Trust existing LTM or regenerate from chat history?**

### Option A: Trust Existing LTM (Fast, Preserves Context)

**Approach:**
- Import memories as-is
- Ignore chat history entirely
- Assume shapes.inc LTM generation was sufficient

**Pros:**
- Faster migration
- Preserves exact historical context
- No re-processing overhead
- Maintains continuity with shapes.inc experience

**Cons:**
- shapes.inc LTM quality unknown
- May use different summarization prompts
- Can't improve summary quality
- Locked into their chunking/timing decisions

### Option B: Regenerate LTM (Slow, Higher Quality)

**Approach:**
- Cross-reference memories ↔ chat history
- Identify which messages already have summaries
- Regenerate LTM using Tzurot's own prompts/chunking
- Potentially better quality with modern models

**Pros:**
- Consistent LTM quality across all personalities
- Use better models (Gemini 2.5 vs whatever shapes.inc used)
- Control over chunking/summarization strategy
- Opportunity to improve on original summaries

**Cons:**
- Extremely expensive (40K messages × API cost)
- Time-consuming processing
- May lose nuance from original summaries
- Risk of generating inferior summaries

### Option C: Hybrid Approach (Selective Regeneration)

**Approach:**
- Import existing memories for bulk of history
- Identify gaps where chat exists but no LTM
- Only regenerate for:
  - Missing summaries
  - Low-quality summaries (if detectable)
  - Recent conversations (last N months)

**Pros:**
- Balance of speed and quality
- Fill gaps in historical data
- Improve recent history with better models
- Reduce API costs

**Cons:**
- More complex logic
- Inconsistent LTM quality across timeline
- Still significant processing for gaps

### Recommendation: **Option A (Initially), then Option C**

**Phase 1 Migration:**
- Import existing LTM as-is for immediate functionality
- Trust shapes.inc summarization quality
- Get personalities working quickly

**Phase 2 Enhancement:**
- Analyze LTM quality (sample random summaries)
- Identify patterns in shapes.inc chunking
- Implement selective regeneration for:
  - Conversations from last 3-6 months (most relevant)
  - Any gaps in LTM coverage
  - Summaries that seem low-quality

**Rationale:**
- Users want their personalities working ASAP
- Historical context is better than no context
- Can always improve quality later
- Reduces initial migration complexity

## Implementation Notes

### UUID Mapping
```typescript
interface ShapesIncPersonality {
  id: string;                    // UUID from shapes.inc
  user_id: string[];             // Array of owner UUIDs
  duplicate_shape_ids: string[]; // Related personality variants
}

// Map to Tzurot schema
interface TzurotPersonality {
  id: string;                    // Keep shapes.inc UUID
  ownedBy: string[];             // user_id array
  // ... rest of fields
}
```

### Memory Structure
```typescript
interface ShapesIncMemory {
  id: string;                    // Composite: msgId1/msgId2
  shape_id: string;              // Personality UUID
  senders: string[];             // Participant UUIDs
  result: string;                // LTM summary text
  metadata: {
    msg_ids: string[];           // Source message UUIDs
    start_ts: number;
    end_ts: number;
    discord_channel_id?: string;
  };
}
```

### Data Mapping Priorities

**High Priority (Phase 1):**
- Core personality config
- User ownership
- User personalization
- Voice settings (for future)

**Medium Priority (Phase 2):**
- LTM memories
- Knowledge documents
- Image generation settings

**Low Priority (Later):**
- X/Twitter integration
- Custom HTML/CSS
- Discovery/search tags
- Credits/usage tracking

## Open Questions

1. **Voice Integration**: shapes.inc uses ElevenLabs - do we want to support that or abstract it?
2. **Image Generation**: shapes.inc uses various models - same question
3. **User UUIDs**: Generate fresh UUIDs for Tzurot users or import shapes.inc user IDs?
4. **Conversation Chunking**: What's shapes.inc's LTM chunking strategy? (appears to be ~5 messages)
5. **Free Will System**: shapes.inc has "free_will_level" - relevant for Tzurot?

## References

- Example personality: `/tzurot-legacy/data/personalities/lilith-tzel-shani/`
- Main config: 403 lines, extensive jailbreak/prompts
- Memories: 231K lines, ~36MB
- Chat history: 40K lines, ~7MB
- Knowledge: 111 lines, background documents
