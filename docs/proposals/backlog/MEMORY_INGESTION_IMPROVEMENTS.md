# Memory Ingestion Improvements

## Current Issues

### 1. Missing Knowledge Ingestion

- **Problem**: Only memories are ingested to Qdrant, knowledge items are ignored
- **Files**: `*_knowledge.json` contains 10 reference items (poems, writings) not ingested
- **Impact**: Missing personality-wide reference material

### 2. Metadata Issues

**Current metadata structure lacks context:**

```javascript
{
  personalityId: "uuid",
  personalityName: "Lilith",
  summaryType: "automatic",
  content: "Lila is anxious about...",  // Names without ID context
  metadata: {
    senders: ["user-uuid"],  // UUID not linked to persona
    start_ts: 1741064226,
    end_ts: 1741091211,
    msg_ids: [...]
  }
}
```

**Problems:**

- Names in content ("Lila", "Lilith") without ID references
- User UUID in senders not linked to persona record
- No `userPersonaId` field
- Duplicate data (messageIds in two places)
- Missing type classification (memory vs knowledge)

### 3. Memory vs Knowledge Distinction

**Memories** (user-specific):

- Generated summaries of conversations
- Should filter by userId/senders
- Scope: personal

**Knowledge** (personality-wide):

- Reference material, lore, poems
- Available to all users
- Scope: global

## Proposed Improvements

### 1. Add Knowledge Ingestion

```javascript
async function ingestKnowledge(knowledgeItems, personalityId, personalityName) {
  const knowledgePoints = knowledgeItems
    .filter(k => !k.deleted)
    .map(k => ({
      id: uuidv5(k.id, NAMESPACE),
      vector: await generateEmbedding(k.content),
      payload: {
        type: 'knowledge',
        scope: 'global',
        personalityId,
        personalityName,
        content: k.content,
        storyType: k.story_type,
        originUrl: k.origin_url,
        createdAt: k.created_ts
      }
    }));

  await upsertMemories(qdrant, collectionName, knowledgePoints);
}
```

### 2. Improve Memory Metadata

**Minimal improvement:**

```javascript
{
  type: 'memory',
  scope: 'personal',
  personalityId,
  personalityName,
  userId: senders[0],
  userPersonaId,  // NEW - fetch from user.globalPersonaId
  summaryType,
  content,
  startTs: metadata.start_ts,
  endTs: metadata.end_ts,
  createdAt: metadata.created_at,
  messageIds: metadata.msg_ids,
  channelId: metadata.discord_channel_id || null,
  guildId: metadata.discord_guild_id || null,
}
```

**Better improvement (contextualized content):**

```javascript
{
  // ... same as above ...
  content: `[Conversation between ${userDisplayName} and ${personalityName}]\n${originalContent}`,
  // Or add separate contextual wrapper field
}
```

**Future enhancements:**

```javascript
{
  // ... existing fields ...
  importanceScore: 0.5,  // For LTM prioritization
  tags: ['work', 'anxiety', 'ritual'],  // Auto-generated categories
  emotionalTone: 'supportive',  // Detected sentiment
}
```

### 3. Update Vector Memory Queries

**Current**: Queries don't distinguish memory types
**Needed**: Filter by type and scope

```typescript
// For retrieval
async queryMemories(query: string, options: {
  personalityId: string,
  userId?: string,  // Optional for knowledge-only queries
  includeKnowledge: boolean,
  includeMemories: boolean
}) {
  const filters = {
    personalityId: options.personalityId
  };

  if (options.includeMemories && options.userId) {
    // Include user-specific memories
    filters.OR = [
      { type: 'knowledge' },
      { type: 'memory', userId: options.userId }
    ];
  } else if (options.includeKnowledge) {
    filters.type = 'knowledge';
  }

  return await qdrant.search(collectionName, query, filters);
}
```

## Implementation Steps

1. **Phase 1: Knowledge ingestion**
   - [ ] Add `ingestKnowledge()` function
   - [ ] Call it after memory ingestion
   - [ ] Add `type: 'knowledge'` to payload

2. **Phase 2: Metadata improvements**
   - [ ] Add `type`, `scope`, `userId`, `userPersonaId` fields
   - [ ] Fetch userPersonaId from database during ingestion
   - [ ] Clean up duplicate fields

3. **Phase 3: Content contextualization**
   - [ ] Add user/personality context to content
   - [ ] Consider separate contextual wrapper field

4. **Phase 4: Query updates**
   - [ ] Update VectorMemoryManager to filter by type
   - [ ] Add knowledge/memory toggles to retrieval options

## Files to Update

- `scripts/ingest-shapes-inc.cjs` - Add knowledge ingestion
- `services/ai-worker/src/memory/VectorMemoryManager.ts` - Update queries
- `services/ai-worker/src/memory/QdrantMemoryAdapter.ts` - Support type filtering

## Related Documentation

- See Gemini conversation about LTM strategy (in core v3 docs)
- Memory importance scoring will be needed for LTM eviction
- User timezone support will help with temporal context
