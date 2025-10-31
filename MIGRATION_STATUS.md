# pgvector Migration Status

**Date:** 2025-01-31
**Bot Status:** 🔴 OFFLINE (24+ hours)
**Goal:** Get bot back online with pgvector replacing Qdrant

---

## ✅ COMPLETED (Data Layer)

### Database Setup
- [x] Created new Railway Postgres instance with pgvector
- [x] Enabled pgvector extension (0.8.1)
- [x] Created Memory schema with vector(1536)
- [x] Migrated all data with deterministic UUIDs:
  - 14 users
  - 67 personalities
  - 67 personas
  - 4,364 conversation messages
  - All config tables

### Memory Population
- [x] Rebuilt 2,170 memories from conversation_history
  - All with OpenAI embeddings
  - All with deterministic UUIDs
  - Only 1 OpenAI API error (403)
- [x] Created HNSW vector index (m=16, ef_construction=64)
- [x] Attempted shapes.inc import (0 imported - all users unmapped, expected)

**Database is ready! ✅**

---

## 🔄 IN PROGRESS (Code Layer)

### Step 1: Create Pgvector Memory Adapter
**File:** `services/ai-worker/src/memory/PgvectorMemoryAdapter.ts`

**Interface to implement** (same as QdrantMemoryAdapter):
```typescript
class PgvectorMemoryAdapter {
  async queryMemories(query: string, options: MemoryQueryOptions): Promise<MemoryDocument[]>
  async addMemory(data: { text: string; metadata: MemoryMetadata }): Promise<void>
  async healthCheck(): Promise<boolean>
}
```

**Implementation details:**
- Use Prisma for database access
- Generate embeddings with OpenAI
- Use raw SQL for vector similarity search:
  ```sql
  SELECT *, embedding <=> $1::vector AS distance
  FROM memories
  WHERE persona_id = $2
    AND (personality_id = $3 OR $3 IS NULL)
    AND created_at < $4
  ORDER BY distance
  LIMIT $5
  ```
- Apply deterministic UUIDs on addMemory

**Estimated time:** 30 minutes

---

### Step 2: Update ai-worker to use Pgvector
**Files to modify:**
1. `services/ai-worker/src/services/ConversationalRAGService.ts`
   - Replace `QdrantMemoryAdapter` import with `PgvectorMemoryAdapter`
   - Update constructor
2. `services/ai-worker/src/index.ts` or wherever adapter is instantiated
   - Same replacement

**Estimated time:** 15 minutes

---

### Step 3: Deploy to Railway
**Steps:**
1. Update .env locally to confirm everything works
2. Build all services: `pnpm build`
3. Push to develop: `git add . && git commit && git push`
4. Railway auto-deploys
5. Monitor logs: `railway logs --service ai-worker`

**Estimated time:** 10 minutes + monitoring

---

## 📋 TODO AFTER BOT IS ONLINE

### Verification (First Hour)
- [ ] Test `/ping` command
- [ ] Test personality interaction with memory retrieval
- [ ] Verify memory creation in new conversations
- [ ] Check logs for any Qdrant errors (should be zero)
- [ ] Monitor database connection pool

### Environment Variables Cleanup
**Remove from Railway (after 7 days stable):**
```bash
QDRANT_URL
QDRANT_API_KEY
DEV_QDRANT_URL
DEV_QDRANT_API_KEY
PROD_QDRANT_URL
PROD_QDRANT_API_KEY
```

### Code Cleanup (after 7 days stable)
- [ ] Delete `services/ai-worker/src/memory/QdrantMemoryAdapter.ts`
- [ ] Delete `services/api-gateway/src/services/QdrantSyncService.ts`
- [ ] Delete `packages/common-types/src/services/QdrantMemoryService.ts`
- [ ] Delete all Qdrant sync scripts in `scripts/`
- [ ] Remove Qdrant from package.json dependencies

### Database Sync Script Updates
**File:** `services/api-gateway/src/services/DatabaseSyncService.ts`

**Add to SYNC_CONFIG:**
```typescript
memories: {
  pk: 'id',
  createdAt: 'created_at',
  // No updatedAt - append-only
  uuidColumns: ['id', 'persona_id', 'personality_id'],
  // Special handling needed for vector column
},
```

**Considerations:**
- Vector embeddings are large (1536 dims * 4 bytes = 6KB each)
- 2,170 memories * 6KB = ~13MB just for vectors
- May need batching or parallel sync
- Consider regenerating embeddings on target DB instead of copying

### Infrastructure Decommission (after 7 days stable)
- [ ] Cancel Qdrant Cloud subscription ($25/month saved)
- [ ] Delete old Railway Postgres instance
- [ ] Update documentation to remove Qdrant references
- [ ] Archive migration docs to `docs/archive/`

---

## 🎯 CRITICAL PATH TO GET BOT ONLINE

**Total estimated time: ~1 hour**

1. **Implement PgvectorMemoryAdapter** (~30 min)
2. **Wire it into ai-worker** (~15 min)
3. **Test locally** (~10 min)
4. **Deploy to Railway** (~10 min)
5. **Monitor & verify** (~ongoing)

---

## 📊 Migration Metrics

**Database:**
- Old: PostgreSQL + Qdrant Cloud (~131 collections before consolidation)
- New: PostgreSQL with pgvector (single database)

**Memory Counts:**
- conversation_history: 4,364 messages
- Memories built: 2,170 (from recent conversations)
- shapes.inc legacy: 0 (all users unmapped - expected)

**Performance Targets:**
- Memory query latency: < 200ms
- Bot response time: similar to before
- No timeout errors
- No Qdrant-related errors in logs

**Cost Savings:**
- Qdrant Cloud: -$25/month
- Simpler architecture: less maintenance overhead
- Single database: easier backups and migrations

---

## 🚨 ROLLBACK PLAN

**If things go wrong:**

1. Keep old DB active (don't delete yet) ✅
2. Revert DATABASE_URL in Railway:
   ```bash
   railway variables set DATABASE_URL="<OLD_URL>" --service ai-worker
   ```
3. Redeploy previous git commit
4. Keep Qdrant subscription active

**Old DB URL** (for emergency):
```
postgresql://postgres:WuKBVblJOTDcuPULuPAeuDXstDMaFxid@nozomi.proxy.rlwy.net:48102/railway
```

---

##  Questions?

**Me:** Ready to implement PgvectorMemoryAdapter?
**You:** Say "yes" and I'll create it now!
