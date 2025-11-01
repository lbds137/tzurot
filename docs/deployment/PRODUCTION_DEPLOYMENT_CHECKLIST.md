# Production Deployment Checklist - v3.0.0-alpha.15

**Date**: 2025-10-31
**PR**: #190
**Critical Changes**: Database migration, Qdrant removal, migration system overhaul

---

## ⚠️ CRITICAL: Data Migration Required

This deployment involves:
- Migrating from old Postgres to new pgvector database
- Migrating memories from Qdrant to pgvector
- Cannot rollback without data loss - must succeed on first try

---

## Pre-Deployment Checklist

### 1. Backup Everything

- [ ] **Backup production Postgres database**
  ```bash
  RAILWAY_ENVIRONMENT=production railway service Postgres
  PROD_DB_URL=$(railway variables --kv | grep DATABASE_PUBLIC_URL | cut -d'=' -f2)
  pg_dump "$PROD_DB_URL" > backups/prod-postgres-$(date +%Y%m%d-%H%M%S).sql
  ```

- [ ] **Backup production Qdrant data** (if not already done)
  - Export all collections to JSON
  - Store in `backups/qdrant-prod-$(date +%Y%m%d-%H%M%S)/`

- [ ] **Verify backups are valid**
  ```bash
  # Check backup file size
  ls -lh backups/prod-postgres-*.sql

  # Verify backup can be read
  head -100 backups/prod-postgres-*.sql
  ```

### 2. Create Production pgvector Database

- [ ] **Add pgvector template to production Railway**
  ```bash
  RAILWAY_ENVIRONMENT=production railway add
  # Select: Database > PostgreSQL with pgvector
  # Name: pgvector
  ```

- [ ] **Install pgvector in template1** (CRITICAL!)
  ```bash
  RAILWAY_ENVIRONMENT=production railway service pgvector
  PGVECTOR_URL=$(railway variables --kv | grep DATABASE_PUBLIC_URL | cut -d'=' -f2)

  # Install in template1 to enable shadow database for migrations
  psql "$PGVECTOR_URL" -d template1 -c "CREATE EXTENSION IF NOT EXISTS vector;"
  ```

- [ ] **Verify extension installed**
  ```bash
  psql "$PGVECTOR_URL" -d template1 -c "\dx vector"
  # Should show vector extension
  ```

### 3. Verify Dev Deployment is Stable

- [ ] **Check dev Railway deployment status**
  ```bash
  RAILWAY_ENVIRONMENT=development railway status
  ```

- [ ] **Verify all dev services are healthy**
  ```bash
  curl https://api-gateway-development-83e8.up.railway.app/health
  # Should return 200 OK
  ```

- [ ] **Test core functionality in dev**
  - [ ] Send message to bot
  - [ ] Verify response includes memory context
  - [ ] Check voice transcription works
  - [ ] Verify image processing works

- [ ] **Check dev logs for errors**
  ```bash
  RAILWAY_ENVIRONMENT=development railway logs --service ai-worker | tail -50
  RAILWAY_ENVIRONMENT=development railway logs --service api-gateway | tail -50
  RAILWAY_ENVIRONMENT=development railway logs --service bot-client | tail -50
  ```

---

## Deployment Steps

### Phase 1: Set Up Production Database

- [ ] **Run Prisma migrations on new pgvector database**
  ```bash
  RAILWAY_ENVIRONMENT=production railway service pgvector
  DATABASE_URL=$(railway variables --kv | grep DATABASE_PUBLIC_URL | cut -d'=' -f2)

  # Deploy migrations
  DATABASE_URL="$DATABASE_URL" npx prisma migrate deploy

  # Verify migration status
  DATABASE_URL="$DATABASE_URL" npx prisma migrate status
  ```

- [ ] **Verify schema is correct**
  ```bash
  psql "$DATABASE_URL" -c "\dt"  # List tables
  psql "$DATABASE_URL" -c "\d memories"  # Check memories table has vector column
  ```

### Phase 2: Migrate Production Data

- [ ] **Copy data from old Postgres to new pgvector**
  ```bash
  # Get old database URL
  RAILWAY_ENVIRONMENT=production railway service Postgres
  OLD_DB_URL=$(railway variables --kv | grep DATABASE_PUBLIC_URL | cut -d'=' -f2)

  # Get new database URL
  RAILWAY_ENVIRONMENT=production railway service pgvector
  NEW_DB_URL=$(railway variables --kv | grep DATABASE_PUBLIC_URL | cut -d'=' -f2)

  # Use existing migration script (if available)
  # OR use pg_dump/pg_restore:
  pg_dump "$OLD_DB_URL" --data-only --no-owner --no-acl > /tmp/prod-data.sql
  psql "$NEW_DB_URL" < /tmp/prod-data.sql
  ```

- [ ] **Verify data copied correctly**
  ```bash
  # Check row counts match
  psql "$OLD_DB_URL" -c "SELECT COUNT(*) FROM users;"
  psql "$NEW_DB_URL" -c "SELECT COUNT(*) FROM users;"

  psql "$OLD_DB_URL" -c "SELECT COUNT(*) FROM personalities;"
  psql "$NEW_DB_URL" -c "SELECT COUNT(*) FROM personalities;"

  psql "$OLD_DB_URL" -c "SELECT COUNT(*) FROM conversation_history;"
  psql "$NEW_DB_URL" -c "SELECT COUNT(*) FROM conversation_history;"
  ```

- [ ] **Migrate Qdrant memories to pgvector**
  - [ ] Run memory rebuild script (if exists)
  - [ ] OR manually migrate using existing dev process
  - [ ] Verify memory count matches

### Phase 3: Update Production Services

- [ ] **Merge PR to main branch**
  ```bash
  gh pr merge 190 --rebase
  ```

- [ ] **Update production service variables**
  ```bash
  RAILWAY_ENVIRONMENT=production railway service api-gateway
  railway variables --set "DATABASE_URL=${{pgvector.DATABASE_URL}}"

  RAILWAY_ENVIRONMENT=production railway service ai-worker
  railway variables --set "DATABASE_URL=${{pgvector.DATABASE_URL}}"

  RAILWAY_ENVIRONMENT=production railway service bot-client
  railway variables --set "DATABASE_URL=${{pgvector.DATABASE_URL}}"
  ```

- [ ] **Remove Qdrant variables** (since we deleted Qdrant)
  ```bash
  # Note: Railway CLI can't delete variables, use web dashboard
  # Remove from all services:
  # - QDRANT_URL
  # - QDRANT_API_KEY
  # - PROD_QDRANT_URL
  # - PROD_QDRANT_API_KEY
  # - DEV_QDRANT_URL
  # - DEV_QDRANT_API_KEY
  ```

- [ ] **Trigger production deployment**
  ```bash
  # Railway auto-deploys from main branch
  # OR manually trigger:
  RAILWAY_ENVIRONMENT=production railway up
  ```

### Phase 4: Verification

- [ ] **Wait for all services to deploy**
  ```bash
  RAILWAY_ENVIRONMENT=production railway status
  # All services should show "SUCCESS"
  ```

- [ ] **Check health endpoint**
  ```bash
  curl https://api-gateway-production.up.railway.app/health
  # Should return 200 OK
  ```

- [ ] **Verify bot is online in Discord**
  - Check bot status in production server

- [ ] **Test core functionality**
  - [ ] Send message to bot
  - [ ] Verify response (should work)
  - [ ] Check if bot remembers previous conversations (memory test)
  - [ ] Test voice message transcription
  - [ ] Test image processing

- [ ] **Check production logs for errors**
  ```bash
  RAILWAY_ENVIRONMENT=production railway logs --service api-gateway | grep ERROR
  RAILWAY_ENVIRONMENT=production railway logs --service ai-worker | grep ERROR
  RAILWAY_ENVIRONMENT=production railway logs --service bot-client | grep ERROR
  ```

- [ ] **Monitor for 30 minutes**
  - Watch logs for unexpected errors
  - Test various bot commands
  - Verify memory retrieval works correctly

### Phase 5: Cleanup (After Confirming Success)

⚠️ **WAIT 24-48 HOURS** before cleanup to ensure stability!

- [ ] **Remove old Postgres service**
  ```bash
  # Use Railway dashboard to delete "Postgres" service
  # This cannot be undone!
  ```

- [ ] **Remove Qdrant service** (if still exists)
  ```bash
  # Use Railway dashboard to delete "Qdrant" service
  ```

- [ ] **Archive backups**
  ```bash
  # Move backups to long-term storage
  # Keep for at least 30 days
  ```

---

## Rollback Plan

If deployment fails:

### Immediate Rollback (If Services Won't Start)

1. **Revert DATABASE_URL to old Postgres**
   ```bash
   RAILWAY_ENVIRONMENT=production railway service api-gateway
   railway variables --set "DATABASE_URL=${{Postgres.DATABASE_URL}}"
   # Repeat for ai-worker and bot-client
   ```

2. **Re-add Qdrant variables** (from backup)

3. **Redeploy previous version**
   ```bash
   git revert <commit-hash>
   git push origin main
   ```

### Data Recovery (If Data Lost)

1. **Restore from backup**
   ```bash
   psql "$OLD_DB_URL" < backups/prod-postgres-TIMESTAMP.sql
   ```

2. **Restore Qdrant collections** (if needed)

---

## Common Issues

### Issue: Migration fails with "relation already exists"

**Cause**: Tables already exist from data copy

**Fix**:
```bash
npx prisma migrate resolve --applied 20250131000000_init
```

### Issue: "type vector does not exist"

**Cause**: pgvector not installed in template1

**Fix**:
```bash
psql "$PGVECTOR_URL" -d template1 -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

### Issue: Memory count doesn't match

**Cause**: Qdrant → pgvector migration incomplete

**Fix**: Re-run memory rebuild script with verification

---

## Success Criteria

✅ All services deployed and healthy
✅ Health endpoint returns 200
✅ Bot responds to messages
✅ Bot retrieves memories from previous conversations
✅ Voice and image processing work
✅ No errors in logs for 30+ minutes
✅ Data counts match between old and new databases

---

## Notes

- **Estimated downtime**: 5-10 minutes (during service redeployment)
- **Point of no return**: After deleting old Postgres service
- **Critical window**: First 30 minutes after deployment
- **Backup retention**: Keep for 30 days minimum

---

## Contact Info

If issues arise:
- Check Railway dashboard: https://railway.app
- Review logs via CLI: `railway logs --service <name>`
- Check GitHub Actions: https://github.com/lbds137/tzurot/actions
