# Qdrant Migration Guide
## Migrating from Qdrant Cloud to Railway Qdrant

**Last Updated**: 2025-10-31

**Status**: Ready for use

---

## Overview

This guide covers migrating Qdrant vector database from qdrant.io cloud to Railway-hosted Qdrant. The migration uses the same bidirectional sync tooling as database sync (`/admin qdrant-sync`).

## Why Migrate to Railway?

**Benefits:**
- ✅ All services in one network (faster, no external connectivity issues)
- ✅ Reduced latency (same data center as bot/API/database)
- ✅ Lower costs (no qdrant.io subscription)
- ✅ Unified logging and monitoring
- ✅ Better debugging (all Railway logs in one place)

**Considerations:**
- Railway Qdrant is self-hosted (you manage backups)
- Need to configure environment variables

---

## Prerequisites

- [ ] Railway CLI installed and authenticated
- [ ] Access to qdrant.io cloud dashboard (for API key)
- [ ] Bot owner permissions (for `/admin` commands)

---

## Migration Steps

### 1. Set Up Railway Qdrant

**Create Qdrant service:**
```bash
railway service create --name qdrant
```

**Deploy Qdrant using Docker:**
1. Go to Railway dashboard → your project → qdrant service
2. Set deployment to use Docker image: `qdrant/qdrant:latest`
3. Add port mapping: `6333` (REST API)
4. Deploy

**Get connection details:**
```bash
# Internal URL (for services within Railway)
qdrant.railway.internal:6333

# External URL (for management/testing)
railway domain  # Get the external domain
```

**Set API key (recommended):**
```bash
railway variables set QDRANT__SERVICE__API_KEY=<generate-secure-key> --service qdrant
```

---

### 2. Configure Environment Variables

You'll need **4 Qdrant URLs** configured for the migration:

```bash
# OPTION A: Migrate from qdrant.io cloud → Railway
railway variables set DEV_QDRANT_URL="https://<your-cluster>.cloud.qdrant.io:6333" --service api-gateway
railway variables set DEV_QDRANT_API_KEY="<qdrant-cloud-key>" --service api-gateway
railway variables set PROD_QDRANT_URL="http://qdrant.railway.internal:6333" --service api-gateway
railway variables set PROD_QDRANT_API_KEY="<railway-key-or-empty>" --service api-gateway

# OPTION B: Keep using qdrant.io cloud but set up dev/prod separation
railway variables set DEV_QDRANT_URL="https://<dev-cluster>.cloud.qdrant.io:6333" --service api-gateway
railway variables set DEV_QDRANT_API_KEY="<dev-key>" --service api-gateway
railway variables set PROD_QDRANT_URL="https://<prod-cluster>.cloud.qdrant.io:6333" --service api-gateway
railway variables set PROD_QDRANT_API_KEY="<prod-key>" --service api-gateway
```

**For ongoing dev ↔ prod sync (after migration):**
```bash
# Both environments use Railway Qdrant, just different instances
railway variables set DEV_QDRANT_URL="http://qdrant-dev.railway.internal:6333" --service api-gateway
railway variables set PROD_QDRANT_URL="http://qdrant-prod.railway.internal:6333" --service api-gateway
```

---

### 3. Test Configuration (Dry Run)

**In Discord (as bot owner):**
```
/admin qdrant-sync --dry-run: True
```

This will:
- ✅ Connect to both Qdrant instances
- ✅ List all collections found
- ✅ Show point counts to be synced
- ✅ Identify any conflicts (based on timestamps)
- ❌ **NOT** actually copy any data

**Expected output:**
```
🔍 Qdrant Sync Preview (Dry Run)

Total Collections: 67
Total Points Synced: 12,543

Sync Statistics:
persona-3bd86394-20d8-5992-8201-e621856e9087: 145 dev→prod, 0 prod→dev
persona-a1b2c3d4-e5f6-7890-abcd-ef1234567890: 87 dev→prod, 0 prod→dev
...

*Run without --dry-run to apply these changes.*
```

---

### 4. Run the Migration

**⚠️ IMPORTANT CHECKS BEFORE RUNNING:**
- [ ] Dry run completed successfully
- [ ] Point counts look correct
- [ ] Dev environment is using qdrant.io cloud
- [ ] Prod environment is using Railway Qdrant
- [ ] Railway Qdrant is running and accessible

**In Discord:**
```
/admin qdrant-sync
```

**Monitor progress:**
```bash
railway logs --service api-gateway
```

**Expected behavior:**
- Creates collections in Railway Qdrant (if they don't exist)
- Copies all points in batches of 100
- Shows progress for large collections
- Reports completion stats

**Time estimate:**
- ~1,000 points: 1-2 minutes
- ~10,000 points: 5-10 minutes
- ~50,000 points: 20-30 minutes

---

### 5. Verify Migration

**Check Railway Qdrant:**
```bash
# Using Qdrant API directly
curl http://qdrant.railway.internal:6333/collections
```

**Compare collection counts:**
```bash
# Qdrant.io cloud
curl https://<your-cluster>.cloud.qdrant.io:6333/collections \
  -H "api-key: <cloud-key>"

# Railway Qdrant
curl http://qdrant.railway.internal:6333/collections \
  -H "api-key: <railway-key>"
```

**Test bot functionality:**
1. Send a message to a personality
2. Verify LTM context is working
3. Check logs for Qdrant operations

---

### 6. Switch Production to Railway Qdrant

**Update active services to use Railway Qdrant:**
```bash
# ai-worker is the service that uses Qdrant
railway variables set QDRANT_URL="http://qdrant.railway.internal:6333" --service ai-worker
railway variables set QDRANT_API_KEY="<railway-key>" --service ai-worker

# Redeploy ai-worker
railway up --service ai-worker
```

**Verify it's working:**
```bash
railway logs --service ai-worker | grep Qdrant
# Should show: "Qdrant Memory Service initialized"
```

---

### 7. Clean Up

**Once migration is verified working:**

1. **Cancel qdrant.io subscription** (or downgrade to free tier as backup)
2. **Remove old credentials:**
```bash
railway variables unset DEV_QDRANT_URL --service api-gateway
railway variables unset DEV_QDRANT_API_KEY --service api-gateway
```

3. **Update sync config for ongoing dev ↔ prod sync:**
```bash
railway variables set DEV_QDRANT_URL="http://qdrant-dev.railway.internal:6333" --service api-gateway
railway variables set PROD_QDRANT_URL="http://qdrant-prod.railway.internal:6333" --service api-gateway
```

---

## Ongoing Sync (Dev ↔ Prod)

After migration, use `/admin qdrant-sync` for regular dev ↔ prod synchronization:

**Use cases:**
- Testing changes in dev before deploying to prod
- Syncing production data back to dev for debugging
- Disaster recovery (restore from backup)

**Recommended workflow:**
1. Make changes in dev environment
2. Run `/admin qdrant-sync --dry-run: True` to preview
3. Review changes
4. Run `/admin qdrant-sync` to sync
5. Test in prod

---

## Troubleshooting

### Migration Fails with Timeout

**Symptom:** Collections with thousands of points timeout during sync

**Solution:**
1. Check Railway Qdrant is running: `railway status`
2. Increase timeout in QdrantSyncService (default: 30s)
3. Run sync multiple times (it's idempotent - safe to re-run)

### Collection Count Mismatch

**Symptom:** Railway has fewer collections than qdrant.io

**Solution:**
1. Check for empty collections (0 points) - these are skipped
2. Verify DEV_QDRANT_URL points to correct cluster
3. Re-run sync (safe to run multiple times)

### Vector Dimension Mismatch

**Symptom:** Error about vector size incompatibility

**Solution:**
1. Check embedding model matches (should be `text-embedding-3-small` = 1536 dimensions)
2. Verify collection configs match between old and new
3. Recreate collection in Railway with correct dimensions

### Points Missing After Sync

**Symptom:** Some points didn't copy over

**Solution:**
1. Check timestamps - only points with valid `createdAt` metadata sync
2. Look for points with malformed payloads
3. Check Railway logs for specific errors

---

## Rollback Plan

If migration fails and you need to roll back:

1. **Keep qdrant.io running** (don't cancel subscription until verified)
2. **Revert environment variables:**
```bash
railway variables set QDRANT_URL="https://<cloud>.qdrant.io:6333" --service ai-worker
railway variables set QDRANT_API_KEY="<cloud-key>" --service ai-worker
railway up --service ai-worker
```

3. **Delete failed Railway Qdrant collections** (optional):
```bash
curl -X DELETE http://qdrant.railway.internal:6333/collections/<name> \
  -H "api-key: <railway-key>"
```

---

## Performance Tips

**For large datasets (>10k points):**
- Run migration during low-traffic hours
- Monitor Railway resource usage
- Consider upgrading Railway Qdrant resources temporarily

**For fastest migration:**
- Use Railway's internal network URLs (not external domains)
- Ensure both services are in same region
- Run from api-gateway service (same network as destination)

---

## Next Steps

After successful migration:
- [ ] Document Railway Qdrant backup strategy
- [ ] Set up monitoring/alerts for Qdrant
- [ ] Test disaster recovery (restore from backup)
- [ ] Update deployment docs with new Qdrant setup

---

## Related Documentation

- [Qdrant Sync Service Code](../../services/api-gateway/src/services/QdrantSyncService.ts)
- [Database Sync Guide](../../CLAUDE.md#git-workflow) (similar pattern)
- [Railway Deployment Guide](../deployment/DEPLOYMENT.md)
