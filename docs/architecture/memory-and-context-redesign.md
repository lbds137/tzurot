# Memory and Context Window Redesign

## Issues to Address

### Issue 1: Context Window Size Should Be in LLM Config

**Current State:**

- `contextWindowSize` is on `Personality` model (hardcoded to 20)
- `AI_DEFAULTS.CONTEXT_WINDOW = 20` constant used as fallback
- All LLM configs share the same context window

**Problem:**

- Different LLM configs might need different context windows
- Claude Opus might handle 100 messages well
- GPT-3.5 might work best with 10 messages
- Users can't customize this per-config

**Solution:**
Move `contextWindowSize` from `Personality` to `LlmConfig`:

```prisma
model LlmConfig {
  // ... existing fields ...

  // Memory retrieval settings
  memoryScoreThreshold Decimal? @map("memory_score_threshold") @db.Decimal(3, 2)
  memoryLimit          Int?     @map("memory_limit")

  // NEW: Short-term memory context window
  contextWindowSize    Int      @default(20) @map("context_window_size")

  // ... rest of model ...
}

model Personality {
  // REMOVE contextWindowSize from here
  // It will be inherited from the LLM config
}
```

**Migration:**

1. Add `contextWindowSize` to `LlmConfig` (default 20)
2. Copy existing `Personality.contextWindowSize` values to their linked `LlmConfig`
3. Drop `Personality.contextWindowSize` column

---

### Issue 2: Long-Term Memory Should Be Per-Persona, Not Per-User

**Current State:**

```typescript
// Memories stored per-personality
const collectionName = `personality-${personalityId}`;

// Filtered by userId in metadata
metadata: {
  personalityId: string;
  userId?: string; // User isolation
}

// Search filters by userId
await this.qdrant.search(collectionName, {
  filter: { userId: userId }
});
```

**Problem:**

- If user has multiple personas (casual vs professional), memories are shared
- "Casual Alice" and "Professional Alice" should have completely separate memories
- Current design: memories tied to personality, filtered by user
- Better design: memories tied to persona directly

**Why This Matters:**

Imagine user Alice has two personas:

- **Casual Alice**: "She/her, loves gaming and memes, informal"
- **Professional Alice**: "She/her, software engineer, formal and technical"

When talking to WorkBot:

- With current design: Both personas see the same memories (confusing!)
- With new design: Professional Alice has work-related memories, Casual Alice has gaming memories

**Solution:**

Change Qdrant collections from personality-scoped to persona-scoped:

```typescript
// OLD (current):
const collectionName = `personality-${personalityId}`;
// Filter by userId to isolate memories

// NEW (proposed):
const collectionName = `persona-${personaId}`;
// No userId filtering needed - collection IS the isolation boundary
```

**Memory metadata changes:**

```typescript
// OLD:
metadata: {
  personalityId: string; // Which personality they were talking to
  userId?: string;       // Which user (for filtering)
  // ...
}

// NEW:
metadata: {
  personaId: string;     // Which persona this memory belongs to
  personalityId: string; // Which personality they were talking to (for context)
  // userId removed - not needed anymore
  // ...
}
```

**Benefits:**

1. ✅ Each persona has completely separate memories
2. ✅ Cleaner data model (persona IS the memory boundary)
3. ✅ No need for userId filtering (persona already scoped)
4. ✅ Supports multiple personas per user naturally
5. ✅ Aligns with semantic meaning (personas have experiences, not users)

---

## Complete Schema Changes

### Updated Prisma Schema

```prisma
model LlmConfig {
  id          String  @id @default(uuid()) @db.Uuid
  name        String  @db.VarChar(255)
  description String? @db.Text

  ownerId  String? @map("owner_id") @db.Uuid
  owner    User?   @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  isGlobal Boolean @default(false) @map("is_global")

  // LLM parameters
  model             String   @db.VarChar(255)
  visionModel       String?  @map("vision_model") @db.VarChar(255)
  temperature       Decimal? @db.Decimal(3, 2)
  topP              Decimal? @map("top_p") @db.Decimal(3, 2)
  topK              Int?     @map("top_k")
  frequencyPenalty  Decimal? @map("frequency_penalty") @db.Decimal(3, 2)
  presencePenalty   Decimal? @map("presence_penalty") @db.Decimal(3, 2)
  repetitionPenalty Decimal? @map("repetition_penalty") @db.Decimal(3, 2)
  maxTokens         Int?     @map("max_tokens")

  // Memory settings (LTM and STM)
  memoryScoreThreshold Decimal? @map("memory_score_threshold") @db.Decimal(3, 2)
  memoryLimit          Int?     @map("memory_limit")
  contextWindowSize    Int      @default(20) @map("context_window_size") // NEW: STM window

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([ownerId])
  @@index([isGlobal])
  @@map("llm_configs")
}

model Personality {
  id          String  @id @default(uuid()) @db.Uuid
  name        String  @db.VarChar(255)
  displayName String? @map("display_name") @db.VarChar(255)
  slug        String  @unique @db.VarChar(255)
  avatarUrl   String? @map("avatar_url") @db.Text

  systemPromptId String?       @map("system_prompt_id") @db.Uuid
  systemPrompt   SystemPrompt? @relation(fields: [systemPromptId], references: [id], onDelete: SetNull)

  // Character definition
  characterInfo          String  @map("character_info") @db.Text
  personalityTraits      String  @map("personality_traits") @db.Text
  personalityTone        String? @map("personality_tone") @db.VarChar(500)
  personalityAge         String? @map("personality_age") @db.VarChar(100)
  personalityLikes       String? @map("personality_likes") @db.Text
  personalityDislikes    String? @map("personality_dislikes") @db.Text
  conversationalGoals    String? @map("conversational_goals") @db.Text
  conversationalExamples String? @map("conversational_examples") @db.Text
  customFields           Json?   @map("custom_fields")

  voiceEnabled  Boolean @default(false) @map("voice_enabled")
  voiceSettings Json?   @map("voice_settings")

  imageEnabled  Boolean @default(false) @map("image_enabled")
  imageSettings Json?   @map("image_settings")

  memoryEnabled Boolean @default(true) @map("memory_enabled")
  // REMOVED: contextWindowSize (moved to LlmConfig)

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([slug])
  @@map("personalities")
}
```

---

## Qdrant Migration Strategy

### Current Collections

```
personality-{lilithId}/
  ├─ vectors for User A (filtered by userId in metadata)
  ├─ vectors for User B (filtered by userId in metadata)
  └─ vectors for User C (filtered by userId in metadata)
```

### New Collections

```
persona-{aliceCasualId}/
  └─ vectors for Alice's casual persona memories

persona-{aliceProfessionalId}/
  └─ vectors for Alice's professional persona memories

persona-{bobDefaultId}/
  └─ vectors for Bob's default persona memories
```

### Migration Script

```typescript
/**
 * Migrate Qdrant collections from personality-scoped to persona-scoped
 *
 * Steps:
 * 1. For each existing user, get their default persona
 * 2. For each personality collection, get all points
 * 3. Group points by userId
 * 4. Create new persona-{personaId} collection for each user
 * 5. Copy vectors to new collections with updated metadata
 * 6. Verify all data migrated
 * 7. Delete old personality-{personalityId} collections (backup first!)
 */

async function migrateQdrantCollections() {
  // 1. Get all users and their default personas
  const users = await prisma.user.findMany({
    include: {
      defaultPersonaLink: {
        include: { persona: true },
      },
    },
  });

  // 2. Get all personality collections
  const collections = await qdrant.getCollections();
  const personalityCollections = collections.collections.filter(c =>
    c.name.startsWith('personality-')
  );

  for (const collection of personalityCollections) {
    console.log(`Migrating collection: ${collection.name}`);

    // 3. Get all points from this collection
    const points = await qdrant.scroll(collection.name, {
      limit: 10000, // Adjust if you have more
      with_payload: true,
      with_vector: true,
    });

    // 4. Group by userId
    const pointsByUser = new Map<string, any[]>();
    for (const point of points.points) {
      const userId = point.payload?.userId as string;
      if (!userId) continue; // Skip points without userId

      if (!pointsByUser.has(userId)) {
        pointsByUser.set(userId, []);
      }
      pointsByUser.get(userId)!.push(point);
    }

    // 5. For each user, create persona collection and copy points
    for (const [userId, userPoints] of pointsByUser) {
      const user = users.find(u => u.id === userId);
      if (!user?.defaultPersonaLink?.persona) {
        console.warn(`User ${userId} has no default persona, skipping`);
        continue;
      }

      const personaId = user.defaultPersonaLink.persona.id;
      const newCollectionName = `persona-${personaId}`;

      // Create collection if doesn't exist
      await ensureCollection(newCollectionName);

      // Copy points with updated metadata
      const newPoints = userPoints.map(point => ({
        id: point.id,
        vector: point.vector,
        payload: {
          ...point.payload,
          personaId: personaId,
          // Remove userId (no longer needed)
          userId: undefined,
        },
      }));

      await qdrant.upsert(newCollectionName, {
        points: newPoints,
      });

      console.log(`Migrated ${newPoints.length} points for user ${userId} to ${newCollectionName}`);
    }
  }

  console.log('Migration complete! Verify before deleting old collections.');
}
```

### Backup Strategy

Before running migration:

```bash
# 1. Export all collections (Qdrant Cloud has backup feature)
# Or manually snapshot each collection

# 2. Document collection names and point counts
./scripts/list-qdrant-collections.sh > qdrant-backup-manifest.txt

# 3. Run migration script

# 4. Verify new collections have same point counts

# 5. Keep old collections for 1 week before deleting (safety)
```

---

## QdrantMemoryService Changes

```typescript
export class QdrantMemoryService {
  /**
   * Search for relevant memories for a persona
   *
   * OLD: searchMemories(personalityId, query, { userId })
   * NEW: searchMemories(personaId, query, options)
   */
  async searchMemories(
    personaId: string, // Changed from personalityId
    query: string,
    options: MemorySearchOptions = {}
  ): Promise<Memory[]> {
    const {
      limit = 10,
      scoreThreshold = 0.7,
      excludeNewerThan,
      personalityId, // NEW: optional filter by personality
    } = options;

    try {
      // Collection is now per-persona
      const collectionName = `persona-${personaId}`;
      await this.ensureCollection(collectionName);

      // Generate query embedding
      const queryEmbedding = await this.getEmbedding(query);

      // Build filter conditions (optional personality filter)
      const filter = personalityId
        ? {
            must: [{ key: 'personalityId', match: { value: personalityId } }],
          }
        : undefined;

      // Search in Qdrant
      const searchResults = await this.qdrant.search(collectionName, {
        vector: queryEmbedding,
        limit,
        score_threshold: scoreThreshold,
        filter,
        with_payload: true,
      });

      return searchResults.map(result => ({
        id: result.id.toString(),
        content: (result.payload?.content as string) || '',
        metadata: {
          personaId: (result.payload?.personaId as string) || '',
          personalityId: (result.payload?.personalityId as string) || '',
          // userId removed
          sessionId: result.payload?.sessionId as string | undefined,
          createdAt: (result.payload?.createdAt as number) || Date.now(),
          // ... other metadata
        },
        score: result.score,
      }));
    } catch (error) {
      logger.error({ err: error }, `Failed to search memories for persona ${personaId}`);
      return [];
    }
  }

  /**
   * Add a memory for a persona
   *
   * OLD: addMemory(personalityId, content, { userId })
   * NEW: addMemory(personaId, content, metadata)
   */
  async addMemory(
    personaId: string, // Changed from personalityId
    content: string,
    metadata: {
      personalityId: string; // Which personality conversation was with
      sessionId?: string;
      channelId?: string;
      // userId removed
    }
  ): Promise<void> {
    const collectionName = `persona-${personaId}`;
    await this.ensureCollection(collectionName);

    const embedding = await this.getEmbedding(content);

    await this.qdrant.upsert(collectionName, {
      points: [
        {
          id: uuidv4(),
          vector: embedding,
          payload: {
            content,
            personaId,
            personalityId: metadata.personalityId,
            sessionId: metadata.sessionId,
            channelId: metadata.channelId,
            createdAt: Date.now(),
          },
        },
      ],
    });

    logger.debug(`Added memory to persona ${personaId}`);
  }
}
```

---

## Application Code Updates

### ConversationalRAGService

```typescript
// OLD:
const memories = await this.memoryService.searchMemories(personalityId, query, {
  userId: userId,
  limit: memoryLimit,
});

// NEW:
const memories = await this.memoryService.searchMemories(
  personaId, // Pass persona instead of personality
  query,
  {
    personalityId: personalityId, // Optional filter
    limit: memoryLimit,
  }
);
```

### AIJobProcessor

Need to resolve persona before calling memory service:

```typescript
// 1. Get user's persona (default or personality-specific override)
const userConfig = await prisma.userPersonalityConfig.findUnique({
  where: {
    userId_personalityId: { userId, personalityId },
  },
  include: { persona: true },
});

const persona =
  userConfig?.persona ||
  (await getUserDefaultPersona(userId)) ||
  (await createDefaultPersona(userId));

// 2. Use persona for memory retrieval
const memories = await memoryService.searchMemories(persona.id, query, {
  personalityId,
  limit: llmConfig.memoryLimit,
});

// 3. Use persona for context building
const context = await contextBuilder.buildGroupContext(
  channelId,
  personalityId,
  systemPrompt,
  llmConfig.contextWindowSize // From LLM config now!
);
```

---

## Implementation Checklist

### Phase 1: Schema Migration (Postgres)

- [ ] Move `contextWindowSize` from `Personality` to `LlmConfig`
- [ ] Create `UserDefaultPersona` table
- [ ] Create `PersonalityDefaultConfig` table
- [ ] Rename `UserPersonalitySettings` → `UserPersonalityConfig`
- [ ] Make `Persona.ownerId` NOT NULL
- [ ] Add `LlmConfig.ownerId` (nullable for global configs)
- [ ] Migrate existing data to new tables
- [ ] Drop old columns

### Phase 2: Qdrant Migration

- [ ] Backup all existing Qdrant collections
- [ ] Write migration script (personality → persona collections)
- [ ] Run migration in development
- [ ] Verify point counts match
- [ ] Test memory retrieval with new structure
- [ ] Run migration in production
- [ ] Keep old collections as backup for 1 week

### Phase 3: Application Code

- [ ] Update `QdrantMemoryService` (personaId instead of userId)
- [ ] Update `ConversationalRAGService` (resolve persona before memory search)
- [ ] Update `AIJobProcessor` (pass persona to memory service)
- [ ] Update all memory-related code to use persona-scoped collections
- [ ] Use `llmConfig.contextWindowSize` instead of personality or constant

### Phase 4: Testing

- [ ] Test persona-scoped memories (create multiple personas for one user)
- [ ] Test memory isolation (persona A shouldn't see persona B's memories)
- [ ] Test context window variations (different LLM configs)
- [ ] Test group conversations with multiple users/personas

---

## Benefits Summary

### Context Window in LLM Config

✅ Different models can have different context windows
✅ Users can customize per-config
✅ Better token management
✅ More flexible system

### Persona-Scoped Memories

✅ Complete memory isolation per persona
✅ Users can have multiple personas with separate experiences
✅ Cleaner data model (no userId filtering needed)
✅ Scales naturally with multiple personas
✅ Aligns with semantic meaning (personas have memories, not users)

---

## Open Question

**Collection naming**: Should we keep `persona-{uuid}` or use something more readable?

**Option A**: `persona-{uuid}` (current proposal)

- Pro: Guaranteed unique, works with UUIDs
- Con: Hard to debug/inspect

**Option B**: `user-{userId}-persona-{personaName}`

- Pro: Human-readable
- Con: Need to handle name changes, special characters
- Con: Longer names

**Recommendation**: Stick with `persona-{uuid}` for simplicity and reliability.
