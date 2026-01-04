# Migration Template - [Brief Description]

**Created**: YYYY-MM-DD
**Author**: [Your Name]
**Risk Level**: 🔴 High / 🟡 Medium / 🟢 Low
**Estimated Downtime**: [None / X minutes]

---

## Overview

**Problem**: [What bug/issue are we fixing?]

**Solution**: [High-level description of the migration]

**Risk**: [What could go wrong? What's at stake?]

---

## Pre-Migration Checklist

- [ ] Migration tested in local development
- [ ] Migration tested in Railway development environment
- [ ] Database backup created
- [ ] Migration script is idempotent (can run multiple times)
- [ ] Rollback plan documented and tested
- [ ] Team notified (if applicable)
- [ ] Low-traffic window scheduled (if needed)

---

## Migration Steps

### Step 1: Backup

```bash
# Create timestamped backup
railway run --environment production pg_dump > backups/backup-$(date +%Y%m%d-%H%M%S).sql

# Verify backup size
ls -lh backups/backup-*.sql

# Test restore on development (optional but recommended)
railway run --environment development psql < backups/backup-*.sql
```

### Step 2: [First Migration Step]

**What it does**: [Clear explanation]

**SQL/Command**:

```bash
# Your command here
```

**Expected output**:

```
[What you should see]
```

**Verification**:

```bash
# How to verify this step worked
```

### Step 3: [Second Migration Step]

[Repeat for each step...]

### Step N: Final Verification

```bash
# Comprehensive checks to ensure migration succeeded
```

---

## Rollback Plan

### If Migration Fails at Step 1

```bash
# Specific rollback commands
```

### If Migration Fails at Step 2

```bash
# Specific rollback commands
```

### Nuclear Option (Restore from Backup)

```bash
# Drop and restore entire database
railway run --environment production psql < backups/backup-[timestamp].sql

# Mark Prisma migrations as rolled back
npx prisma migrate resolve --rolled-back [migration-name]
```

---

## Post-Migration Verification

### Database Checks

```sql
-- Verify schema changes
\d [table_name]

-- Verify data integrity
SELECT
  COUNT(*) as total_rows,
  COUNT(DISTINCT [key_column]) as unique_values,
  COUNT(*) FILTER (WHERE [key_column] IS NULL) as null_values
FROM [table_name];
```

### Application Checks

- [ ] All services restarted successfully
- [ ] No errors in logs (check last 100 lines)
- [ ] Test basic user flow (e.g., send message, get response)
- [ ] Test edge cases affected by migration
- [ ] Monitor for 24 hours for issues

### Monitoring Commands

```bash
# Check service health
railway logs --service [service] --tail 100

# Check for errors
railway logs --service [service] | grep -i error

# Monitor database connections
railway run psql -c "SELECT * FROM pg_stat_activity WHERE datname = 'railway';"
```

---

## Troubleshooting

### Issue: [Common problem 1]

**Symptoms**: [What you'll see]

**Diagnosis**:

```bash
# How to check if this is the problem
```

**Fix**:

```bash
# How to fix it
```

### Issue: [Common problem 2]

[Repeat for each common issue...]

---

## Migration Log

Record what actually happened during the migration:

**Date**: YYYY-MM-DD HH:MM
**Environment**: production
**Database Size Before**: [X GB]
**Rows Affected**: [X rows]
**Duration**: [X minutes]
**Issues Encountered**: [None / List issues]
**Rollback Required**: [Yes/No]

**Notes**:

- [Any observations]
- [Unexpected behavior]
- [Performance impact]

---

## Files Changed

- `prisma/migrations/[timestamp]_[name]/migration.sql` - [Description]
- `scripts/[script-name].ts` - [Description]
- [Other files...]

---

## References

- Related Issue: #[number]
- Related PR: #[number]
- Commit: [hash]
- Related Docs: [links]
