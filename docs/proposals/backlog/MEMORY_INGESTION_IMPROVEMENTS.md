# Memory Ingestion Improvements

> **Status**: Backlog (Concepts Valid, Implementation TBD)
> **Created**: 2025-11-xx (original)
> **Updated**: 2026-01-17 (rewritten for pgvector architecture)
> **Priority**: Medium
> **Related**: Memory Management Commands (Phase 3+)

## Overview

This proposal addresses gaps in how memories are categorized, stored, and retrieved. The core insight is distinguishing between **user-specific memories** and **personality-wide knowledge**.

---

## Current State

### What We Have

- Memories stored in PostgreSQL with pgvector embeddings
- User-scoped memories (each user's conversations stored separately)
- Basic metadata: `personalityId`, `personaId`, `content`, `createdAt`
- `isLocked` flag for core memory protection
- Semantic search via pgvector cosine similarity

### What's Missing

1. **No Knowledge Items**: Personality-wide reference material (lore, backstory, poems) isn't supported
2. **No Type/Scope Fields**: Can't distinguish memory types in queries
3. **Limited Context in Content**: Names appear without relationship context

---

## Proposed Improvements

### 1. Knowledge vs Memory Distinction

**Memories** (user-specific):

- Generated summaries of conversations
- Filtered by userId when retrieving
- Scope: `personal`

**Knowledge** (personality-wide):

- Reference material, lore, poems, backstory
- Available to ALL users talking to that personality
- Scope: `global`

**Use Case**: Lilith has poems and backstory. Any user talking to her should be able to trigger retrieval of that content, not just the person who originally discussed it.

### 2. Schema Changes

Add fields to the Memory model:

```prisma
model Memory {
  // ... existing fields ...

  // Type classification
  type        String   @default("memory")  // "memory" | "knowledge"
  scope       String   @default("personal") // "personal" | "global"

  // Future enhancements (optional)
  importanceScore  Float?   @map("importance_score")  // 0.0-1.0 for prioritization
  tags             String[] @default([])              // Auto-generated categories
  emotionalTone    String?  @map("emotional_tone")    // Detected sentiment
}
```

### 3. Improved Metadata

**Current content** (lacks context):

```
"Lila is anxious about the upcoming meeting..."
```

**Improved content** (contextualized):

```
"[Conversation between Lila and Lilith] Lila is anxious about the upcoming meeting..."
```

This helps the LLM understand WHO the memory is about when retrieved.

### 4. Smarter Retrieval Queries

Update `MemoryRetriever` to filter by type and scope:

```typescript
interface MemoryQueryOptions {
  personalityId: string;
  userId?: string;
  includeKnowledge?: boolean;  // Default: true
  includeMemories?: boolean;   // Default: true
  onlyGlobal?: boolean;        // For knowledge-only queries
}

async queryMemories(query: string, options: MemoryQueryOptions) {
  const where: Prisma.MemoryWhereInput = {
    personalityId: options.personalityId,
    deletedAt: null,
  };

  if (options.onlyGlobal) {
    where.scope = 'global';
  } else {
    // Include user's personal memories AND global knowledge
    where.OR = [
      { scope: 'global' },
      { scope: 'personal', personaId: options.userId }
    ];
  }

  // ... pgvector similarity search with filters
}
```

---

## Implementation Phases

### Phase 1: Schema & Type Field

- [ ] Add `type` and `scope` fields to Memory model
- [ ] Migration to add columns with defaults
- [ ] Update memory creation to set type/scope

### Phase 2: Knowledge Ingestion

- [ ] Create `/admin/knowledge` API routes for CRUD
- [ ] Admin command to add knowledge items
- [ ] Generate embeddings for knowledge content

### Phase 3: Query Updates

- [ ] Update `MemoryRetriever` to filter by type/scope
- [ ] Include knowledge in RAG retrieval by default
- [ ] Add toggle to exclude knowledge if needed

### Phase 4: Content Contextualization (Optional)

- [ ] Add participant context prefix to memory content
- [ ] Or add separate `contextualContent` field
- [ ] Update embedding generation to use contextualized content

### Phase 5: Advanced Metadata (Future)

- [ ] Importance scoring for retrieval prioritization
- [ ] Auto-tagging via LLM classification
- [ ] Emotional tone detection

---

## Files to Update

| File                                         | Changes                          |
| -------------------------------------------- | -------------------------------- |
| `prisma/schema.prisma`                       | Add type, scope fields to Memory |
| `ai-worker/services/MemoryStorageService.ts` | Set type/scope on creation       |
| `ai-worker/services/MemoryRetriever.ts`      | Filter by type/scope in queries  |
| `api-gateway/routes/admin/`                  | Add knowledge CRUD routes        |
| `bot-client/commands/admin/`                 | Add `/admin knowledge` command   |

---

## Open Questions

1. **How to add knowledge?** Admin command? Import from file? Web UI?
2. **Should knowledge have versions?** (Update backstory over time)
3. **Per-server knowledge?** Some lore might be server-specific
4. **Knowledge size limits?** Large documents might need chunking

---

## Success Metrics

- Knowledge items retrievable by any user
- Clear distinction between personal memories and global knowledge
- No regression in memory retrieval quality
- Admin can manage knowledge without code changes
