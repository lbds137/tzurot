# pgvector Migration Checklist

**Migration Date:** 2025-01-31
**Reason:** Qdrant timeouts + consolidate to single database
**Status:** IN PROGRESS

---

## Pre-Migration (Completed)

- [x] Create new Railway Postgres instance with pgvector template
- [x] Enable pgvector extension (0.8.1)
- [x] Design Memory schema with vector(1536) support
- [x] Implement deterministic UUID strategy for all entities
- [x] Migrate all data from old DB to new DB with deterministic UUIDs
- [x] Create memory rebuild script from conversation_history
- [x] Create shapes.inc import script for legacy data

---

## Data Migration (In Progress)

### Phase 1: Core Data ✅

- [x] Migrate users (14 users)
- [x] Migrate personas (67 personas)
- [x] Migrate personalities (67 personalities)
- [x] Migrate conversation_history (4,364 messages)
- [x] Migrate all junction tables and configs

### Phase 2: Memory Rebuild 🔄

- [x] Rebuild ~2,000 memories from conversation_history
  - Status: 78/79 contexts complete (99%)
  - Using deterministic UUIDs
  - Generating OpenAI embeddings

### Phase 3: Legacy Import ⏳

- [ ] Import 9,364 shapes.inc legacy memories
  - 66 personalities with memory files
  - Map by personality slug
  - Map Discord IDs to personas
  - Generate new embeddings (shapes.inc used different model)

### Phase 4: Vector Index ⏳

- [ ] Create HNSW index on embeddings column
  ```sql
  CREATE INDEX idx_memories_embedding ON memories
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
  ```

---

## Code Changes

### Backend Services

#### 1. PgvectorMemoryService ⏳

- [ ] Create `packages/api-clients/src/PgvectorMemoryService.ts`
  - [ ] Implement `searchMemories(query, personaId, personalityId, limit)`
  - [ ] Implement `addMemory(persona, personality, content, metadata)`
  - [ ] Use raw SQL for vector operations with Prisma
  - [ ] Apply deterministic UUID generation

#### 2. ConversationalRAGService ⏳

- [ ] Update `services/ai-worker/src/services/ConversationalRAGService.ts`
  - [ ] Replace QdrantMemoryService with PgvectorMemoryService
  - [ ] Update constructor injection
  - [ ] Verify memory retrieval logic unchanged

#### 3. Memory Storage ⏳

- [ ] Update memory storage in ai-worker
  - [ ] Replace Qdrant upsert with pgvector insert
  - [ ] Apply deterministic UUIDs
  - [ ] Maintain same metadata structure

---

## Environment Variables

### Variables to ADD

```bash
# None - we're using existing DATABASE_URL
```

### Variables to REMOVE (After Verification)

```bash
# Qdrant-related (keep until fully migrated):
QDRANT_URL
QDRANT_API_KEY
DEV_QDRANT_URL
DEV_QDRANT_API_KEY
PROD_QDRANT_URL
PROD_QDRANT_API_KEY
```

### Shared Variables (Keep)

```bash
AI_PROVIDER=openrouter
BOT_OWNER_ID=278863839632818186
DEFAULT_AI_MODEL=anthropic/claude-haiku-4.5
EMBEDDING_MODEL=text-embedding-3-small
LOG_LEVEL=info
NODE_ENV=production
OPENAI_API_KEY=<key>
OPENROUTER_API_KEY=<key>
```

### Service-Specific (Update as Needed)

**All services now need:**

- `DATABASE_URL` (already have)
- Remove references to `QDRANT_URL` and `QDRANT_API_KEY`

---

## Database Sync Script

### Current db-sync Compatibility ⏳

- [ ] Test db-sync with new pgvector database
- [ ] Verify memory table syncs correctly
- [ ] Test DEV → PROD sync
- [ ] Test PROD → DEV sync

### Potential Issues

1. **Vector data type**: Ensure sync handles `vector(1536)` type
2. **Large memories table**: May need batching for sync
3. **Embeddings**: 1536-dim vectors are large - monitor sync performance

### Sync Script Updates Needed

```typescript
// In db-sync script, handle memories table specially:
const BATCH_SIZE = 100; // Smaller batches for large vectors

// Option 1: Exclude embeddings from initial sync, regenerate
// Option 2: Batch copy with progress logging
// Option 3: Use pg_dump for memories table separately
```

---

## Testing Checklist

### Local Testing

- [ ] Test memory search with sample queries
- [ ] Verify embedding similarity scores
- [ ] Test memory creation with new service
- [ ] Verify deterministic UUIDs work correctly

### DEV Environment

- [ ] Deploy updated services to Railway DEV
- [ ] Update DATABASE_URL in all services
- [ ] Test bot commands in Discord
- [ ] Verify memory retrieval in conversations
- [ ] Check logs for any Qdrant errors
- [ ] Monitor memory query performance

### Performance Verification

- [ ] Memory search latency < 200ms
- [ ] Bot response time similar to before
- [ ] No timeout errors
- [ ] Database connection pool stable

---

## Deployment Steps

### Phase 1: Deploy to DEV ⏳

1. [ ] Update .env with new DATABASE_URL
2. [ ] Build all services: `pnpm build`
3. [ ] Deploy bot-client to Railway DEV
4. [ ] Deploy api-gateway to Railway DEV
5. [ ] Deploy ai-worker to Railway DEV
6. [ ] Monitor logs for 30 minutes

### Phase 2: Verify DEV ⏳

1. [ ] Test basic bot commands (`/ping`, `/help`)
2. [ ] Test personality interaction with memory retrieval
3. [ ] Verify memory creation in new conversations
4. [ ] Check database for new memories
5. [ ] Confirm no Qdrant errors in logs

### Phase 3: Deploy to PROD ⏳

1. [ ] Sync DEV database to PROD (including memories)
2. [ ] Update PROD environment variables
3. [ ] Deploy services to PROD
4. [ ] Monitor logs closely
5. [ ] Test with production bot

---

## Rollback Plan

### If Migration Fails

1. Keep old database instance active (don't delete yet)
2. Revert DATABASE_URL to old instance
3. Redeploy previous code version
4. Keep Qdrant Cloud subscription active

### Rollback Commands

```bash
# Revert Railway environment variables
railway variables set DATABASE_URL="<OLD_DB_URL>" --service api-gateway
railway variables set DATABASE_URL="<OLD_DB_URL>" --service ai-worker
railway variables set DATABASE_URL="<OLD_DB_URL>" --service bot-client

# Redeploy previous version
git revert HEAD
git push origin develop
```

---

## Post-Migration Cleanup

### Immediate Cleanup (After 7 Days Stable)

- [ ] Cancel Qdrant Cloud subscription
- [ ] Delete old Railway Postgres instance (nozomi.proxy.rlwy.net:48102)
- [ ] Remove Qdrant variables from Railway
- [ ] Remove Qdrant code from codebase (see below)

### Code Cleanup Tasks

- [ ] Delete `QdrantMemoryService.ts`
- [ ] Delete `QdrantMemoryAdapter.ts`
- [ ] Delete Qdrant sync scripts:
  - `scripts/sync-qdrant-bidirectional.ts`
  - `scripts/test-qdrant-connection.ts`
  - Any other Qdrant-related scripts
- [ ] Remove Qdrant dependencies from package.json:
  - `@qdrant/js-client` (if present)
- [ ] Update documentation to remove Qdrant references
- [ ] Remove Qdrant-related environment variables from .env.example

### Documentation Updates

- [ ] Update ARCHITECTURE.md to reflect pgvector
- [ ] Update DEPLOYMENT.md with new setup
- [ ] Update README.md if it mentions Qdrant
- [ ] Delete this migration doc after completion (git history preserves it)

---

## Monitoring Post-Migration

### Metrics to Watch (First 7 Days)

- [ ] Memory query latency (target: < 200ms)
- [ ] Database connection errors
- [ ] Memory insertion success rate
- [ ] Bot response time
- [ ] API Gateway /health endpoint
- [ ] OpenAI API usage (embeddings)

### Success Criteria

- ✅ Bot responds to all commands
- ✅ Memory retrieval works in conversations
- ✅ New memories are created and stored
- ✅ No Qdrant timeout errors
- ✅ Database performance stable
- ✅ No increase in error rates

---

## Risk Assessment

### High Risk Items ⚠️

1. **Memory search performance**: HNSW index must be created AFTER bulk insert
2. **Database connection pooling**: pgvector queries may hold connections longer
3. **Embedding generation cost**: Re-embedding 9K+ memories = OpenAI API cost

### Medium Risk Items

1. **Bot downtime during deployment**: Keep old DB active during transition
2. **Memory deduplication**: Deterministic UUIDs should prevent, but verify
3. **Missing memories**: Verify count matches before/after

### Low Risk Items

1. **Code compatibility**: Minimal changes to existing logic
2. **Schema migration**: Using Prisma for safety
3. **Railway deployment**: Standard process

---

## Contact & Support

**Migration Lead:** User (with Claude Code assistance)
**Backup Plan:** Keep old infrastructure active for 7 days
**Emergency Rollback:** See Rollback Plan section above

---

## Notes

- Old DB: `postgresql://postgres:WuKBVblJOTDcuPULuPAeuDXstDMaFxid@nozomi.proxy.rlwy.net:48102/railway`
- New DB: `postgresql://postgres:p0i0ex358ntfvkxzbirx0k451uzpqjyx@mainline.proxy.rlwy.net:42326/railway`
- Qdrant Cloud: `https://01b8a4c0-61e2-412c-980c-709e41b1ce3e.us-east-1-1.aws.cloud.qdrant.io:6333`
- Migration scripts in `scripts/`: `rebuild-memories-from-history.ts`, `import-shapes-inc-memories.ts`
