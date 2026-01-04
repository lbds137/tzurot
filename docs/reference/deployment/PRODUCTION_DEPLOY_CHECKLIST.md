# Production Deploy Checklist: Develop → Main

> **Created**: 2025-11-28
> **Status**: Pre-deploy preparation
> **Commits ahead of main**: ~67

## Overview

This checklist covers deploying the Guest Mode / BYOK features from `develop` to `main` (production).

---

## 1. Pre-Deploy Verification

### 1.1 Development Environment Validation

- [ ] All tests passing on `develop` (`pnpm test`)
- [ ] Manual testing of Guest Mode complete
- [ ] Free model configs created and tested
- [ ] Verify bot is responding correctly on development Discord

### 1.2 Code Review

- [ ] Review diff: `git diff main..develop --stat`
- [ ] No hardcoded secrets or development URLs
- [ ] No debug logging left enabled

---

## 2. Database Migrations

### 2.1 Migrations to Apply (in order)

Production is currently at `20251119231105`. These 15 migrations need to run:

| Migration        | Description                                                             | Risk            |
| ---------------- | ----------------------------------------------------------------------- | --------------- |
| `20251126180629` | Add `timezone`, `superuser` to users                                    | Low             |
| `20251126181511` | **Create `user_api_keys` table**                                        | Low (new table) |
| `20251126182042` | Add `error_message`, `birthday_*` to personalities                      | Low             |
| `20251126182342` | Add `provider`, `is_global`, etc to `llm_configs`                       | Low             |
| `20251126182643` | **Create `personality_aliases` table**                                  | Low (new table) |
| `20251126182927` | **Create `usage_logs` table**                                           | Low (new table) |
| `20251126190000` | **DATA MIGRATION**: Move `custom_fields.errorMessage` → `error_message` | Medium          |
| `20251127015433` | Replace `birthday` with `birthday_month`/`birthday_day`                 | Low             |
| `20251127020000` | Recreate vector index (was accidentally dropped)                        | Low             |
| `20251127032451` | Add `usage_logs` provider index                                         | Low             |
| `20251127062900` | Add provider-only index                                                 | Low             |
| `20251127100000` | Add `usage_logs` composite index                                        | Low             |
| `20251127110000` | Add birthday check constraints                                          | Low             |
| `20251127120000` | Add `default_llm_config_id` to users                                    | Low             |
| `20251128220000` | Add `is_free_default` to `llm_configs`                                  | Low             |

### 2.2 Migration Command

```bash
# On Railway production environment
railway run npx prisma migrate deploy
```

### 2.3 Post-Migration Verification

```bash
# Check migration status
railway run npx prisma migrate status

# Verify new tables exist
railway run psql -c "\dt user_api_keys"
railway run psql -c "\dt personality_aliases"
railway run psql -c "\dt usage_logs"

# Verify new columns
railway run psql -c "\d users" | grep -E "timezone|superuser|default_llm_config"
railway run psql -c "\d llm_configs" | grep -E "provider|is_global|is_free_default"
```

---

## 3. db-sync Configuration

### 3.1 New Tables to Add to Sync Config

**File**: `services/api-gateway/src/services/sync/config/syncTables.ts`

| Table                 | Should Sync? | Reason                                             |
| --------------------- | ------------ | -------------------------------------------------- |
| `user_api_keys`       | **NO**       | Contains encrypted API keys (environment-specific) |
| `personality_aliases` | **YES**      | Aliases should be consistent across environments   |
| `usage_logs`          | **NO**       | Usage data is environment-specific                 |

### 3.2 Required Change to syncTables.ts

```typescript
// Add to SyncTableName type:
| 'personality_aliases'

// Add to SYNC_CONFIG:
personality_aliases: {
  pk: 'id',
  createdAt: 'created_at',
  uuidColumns: ['id', 'personality_id'],
  timestampColumns: ['created_at'],
},
```

### 3.3 What db-sync Already Handles

The following existing tables have new columns that db-sync will automatically copy:

- `users` → `timezone`, `superuser`, `default_llm_config_id`
- `llm_configs` → `provider`, `is_global`, `context_window_tokens`, `is_free_default`, etc.
- `personalities` → `error_message`, `birthday_month`, `birthday_day`

**db-sync copies all columns** from source to target, so new columns are handled automatically.

---

## 4. Data Sync Strategy

### 4.1 Option A: Run db-sync After Deploy (Recommended)

1. Deploy code to production (auto-deploys on merge to main)
2. Wait for services to restart
3. Run migrations: `railway run npx prisma migrate deploy`
4. Run db-sync from development → production:
   ```bash
   # On bot-client production
   /admin db-sync direction:development_to_production
   ```

### 4.2 Option B: Fresh Production Data

If production data can be reset:

1. Deploy code
2. Run migrations
3. Manually insert required LlmConfig records via SQL
4. No sync needed

---

## 5. LlmConfig Records Needed

### 5.1 Free Model Configs for Guest Mode

Production needs at least one LlmConfig with `is_free_default = true`:

```sql
-- Verify free default exists after sync
SELECT id, name, model, is_free_default
FROM llm_configs
WHERE is_free_default = true;
```

If missing after sync, create via:

- `/admin llm-config create` command, OR
- Direct SQL insert, OR
- db-sync from development

---

## 6. Deployment Steps (In Order)

### Phase 1: Prepare

- [ ] 1. Verify all tests pass on `develop`
- [ ] 2. Create PR: `develop` → `main`
- [ ] 3. Review PR diff carefully
- [ ] 4. **Update syncTables.ts** to include `personality_aliases` (if not done)

### Phase 2: Deploy

- [ ] 5. Merge PR to `main` (triggers auto-deploy)
- [ ] 6. Wait for Railway deploy to complete (~2-5 min)
- [ ] 7. Verify services are healthy: `curl https://api-gateway-production.../health`

### Phase 3: Database

- [ ] 8. Run migrations: `railway run npx prisma migrate deploy`
- [ ] 9. Verify migrations applied: `railway run npx prisma migrate status`
- [ ] 10. Verify new tables exist (see 2.3)

### Phase 4: Data

- [ ] 11. Run db-sync: `/admin db-sync direction:development_to_production`
- [ ] 12. Verify free model configs synced: Check `is_free_default` column
- [ ] 13. Verify personalities synced: Check count matches development

### Phase 5: Validate

- [ ] 14. Test Guest Mode on production Discord
- [ ] 15. Test BYOK flow: `/wallet set` with test key
- [ ] 16. Test `/model set` shows free models for guest
- [ ] 17. Monitor logs for errors: `railway logs --service bot-client`

---

## 7. Rollback Plan

### If Migrations Fail

```bash
# Check which migration failed
railway run npx prisma migrate status

# Migrations cannot be easily rolled back - fix forward
# If critical, restore from database backup
```

### If Code Has Issues

```bash
# Revert merge commit
git revert -m 1 <merge-commit-hash>
git push origin main

# Railway will auto-deploy the revert
```

### Database Backup

- [ ] Ensure Railway automatic backups are enabled
- [ ] Note backup timestamp before starting deploy

---

## 8. Post-Deploy Monitoring

### First Hour

- [ ] Watch for error spikes in Railway logs
- [ ] Monitor Discord bot responsiveness
- [ ] Check `/admin usage` for any anomalies

### First Day

- [ ] Verify Guest Mode working for new users
- [ ] Confirm existing users unaffected
- [ ] Check memory/CPU usage in Railway dashboard

---

## Notes

### Why Not Sync user_api_keys?

- Contains encrypted API keys
- Encryption keys may differ between environments
- Users should set their own keys in each environment

### Why Not Sync usage_logs?

- Usage data is environment-specific
- Would inflate production metrics with development usage
- Each environment tracks its own API costs

### Vector Index

- Migration `20251127020000` recreates the vector index
- This was accidentally dropped and needed restoration
- Index creation may take a few seconds on large tables
