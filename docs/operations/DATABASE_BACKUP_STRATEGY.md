# Database Backup Strategy

## The Fear is Valid

Yes, databases are scarier than JSON files for backups. JSON files are just... files. You can `cp` them, throw them in git, whatever. Databases require actual strategy.

## Multi-Layer Backup Approach

### Layer 1: Railway Automatic Backups (Built-in)

Railway Postgres includes:

- **Automatic daily backups** (retained for 7 days on Hobby plan, 14 days on Pro)
- **Point-in-time recovery** (PITR) for Pro plans
- **One-click restore** via Railway dashboard

**Pros:**

- Zero config required
- Automatic and reliable
- Quick recovery

**Cons:**

- Limited retention (7-14 days)
- Tied to Railway platform
- No local copy

### Layer 2: Automated pg_dump to Object Storage (Critical)

**Strategy:** Daily automated exports to external storage

```bash
#!/bin/bash
# scripts/backup-database.sh

# Get database URL from Railway
DATABASE_URL=$(railway variables get DATABASE_URL)

# Backup filename with timestamp
BACKUP_FILE="tzurot-backup-$(date +%Y%m%d-%H%M%S).sql.gz"

# Create compressed backup
pg_dump "$DATABASE_URL" | gzip > "$BACKUP_FILE"

# Upload to S3/R2/Backblaze (pick one)
# Option 1: AWS S3
aws s3 cp "$BACKUP_FILE" "s3://tzurot-backups/$BACKUP_FILE"

# Option 2: Cloudflare R2 (cheaper)
rclone copy "$BACKUP_FILE" "r2:tzurot-backups/$BACKUP_FILE"

# Option 3: Backblaze B2 (cheapest)
b2 upload-file tzurot-backups "$BACKUP_FILE" "$BACKUP_FILE"

# Clean up local file
rm "$BACKUP_FILE"

# Keep last 30 backups, delete older ones
# (implementation depends on storage provider)
```

**Set up via GitHub Actions:**

```yaml
# .github/workflows/backup-database.yml
name: Daily Database Backup
on:
  schedule:
    - cron: '0 3 * * *' # 3 AM daily
  workflow_dispatch: # Manual trigger

jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install PostgreSQL client
        run: sudo apt-get install -y postgresql-client

      - name: Create backup
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        run: ./scripts/backup-database.sh
```

**Pros:**

- External storage (survives Railway issues)
- Long retention (30+ days)
- Automated
- Cheap ($0.50-1/month for storage)

**Cons:**

- Requires setup
- Additional service dependency

### Layer 3: Export to JSON (Compatibility Layer)

**Strategy:** Weekly exports to JSON format for human readability and portability

```bash
#!/bin/bash
# scripts/export-to-json.sh

# Export all personalities to JSON (like shapes.inc format)
node scripts/export-personalities-json.js

# Commit to git
git add data/backups/personalities-$(date +%Y%m%d).json
git commit -m "chore: weekly personality backup"
git push
```

**Pros:**

- Human-readable format
- Version controlled in git
- Easy to inspect/edit manually
- Can restore without database

**Cons:**

- Not a full backup (just personalities)
- Manual intervention possible

### Layer 4: Local Development Backups

**Strategy:** Developers regularly pull production data to local

```bash
# Pull latest backup from Railway
railway run pg_dump > local-backup.sql

# Restore to local database
psql -d tzurot_dev < local-backup.sql
```

**Pros:**

- Another copy of data
- Can test restores locally
- Development seed data

## Backup Retention Policy

| Backup Type       | Frequency | Retention     | Location           |
| ----------------- | --------- | ------------- | ------------------ |
| Railway automatic | Daily     | 7-14 days     | Railway            |
| pg_dump to S3/R2  | Daily     | 30 days       | External storage   |
| JSON export       | Weekly    | Forever (git) | Git repo           |
| Local dev         | On-demand | Varies        | Developer machines |

## Disaster Recovery Plan

### Scenario 1: Accidental Data Deletion (Today)

1. Check Railway automatic backups (< 7 days)
2. One-click restore from Railway dashboard
3. **Recovery time: < 5 minutes**

### Scenario 2: Railway Platform Issue

1. Grab latest pg_dump from S3/R2
2. Spin up new Postgres (Railway, Supabase, anywhere)
3. `psql -d new_db < backup.sql`
4. Update DATABASE_URL
5. **Recovery time: < 30 minutes**

### Scenario 3: Database Corruption

1. Stop all services
2. Restore from most recent clean backup
3. Replay recent transactions from conversation logs if available
4. **Recovery time: < 1 hour**

### Scenario 4: Total Data Loss (Catastrophic)

1. Latest pg_dump from S3/R2
2. Latest JSON export from git
3. Rebuild database from JSON if needed
4. **Recovery time: 2-4 hours**

## Testing Backup Restoration

**Monthly drill:**

```bash
# 1. Download latest backup
aws s3 cp s3://tzurot-backups/latest.sql.gz .

# 2. Create test database
psql -c "CREATE DATABASE tzurot_restore_test;"

# 3. Restore
gunzip latest.sql.gz
psql -d tzurot_restore_test < latest.sql

# 4. Verify data
psql -d tzurot_restore_test -c "SELECT COUNT(*) FROM personalities;"

# 5. Clean up
psql -c "DROP DATABASE tzurot_restore_test;"
```

## Monitoring & Alerts

**Set up alerts for:**

- Backup job failures (GitHub Actions email)
- S3/R2 upload failures (webhook to Discord)
- Railway backup age > 2 days
- Database disk usage > 80%

## Cost Estimate

| Service          | Cost            | Notes                   |
| ---------------- | --------------- | ----------------------- |
| Railway Postgres | $5/month        | Hobby plan              |
| Cloudflare R2    | $0.50/month     | 10GB storage, no egress |
| GitHub Actions   | Free            | 2000 minutes/month      |
| **Total**        | **$5.50/month** |                         |

## Implementation Checklist

- [ ] Enable Railway automatic backups (enabled by default)
- [ ] Set up S3/R2/B2 bucket for external backups
- [ ] Create backup script with compression
- [ ] Set up GitHub Action for daily backups
- [ ] Create JSON export script for weekly dumps
- [ ] Document restore procedures
- [ ] Test restore process (do this BEFORE you need it!)
- [ ] Set up monitoring/alerts
- [ ] Schedule monthly backup drills

## JSON Files vs Database: The Real Comparison

| Aspect                | JSON Files        | Postgres + Backups        |
| --------------------- | ----------------- | ------------------------- |
| **Simplicity**        | ✅ Just files     | ⚠️ Requires strategy      |
| **Version Control**   | ✅ Native git     | ⚠️ Requires export        |
| **Backup**            | ✅ `cp` works     | ⚠️ Multiple layers needed |
| **Restore**           | ✅ `cp` back      | ⚠️ pg_restore             |
| **Concurrent Access** | ❌ File locks     | ✅ ACID transactions      |
| **Relationships**     | ❌ Manual         | ✅ Foreign keys           |
| **Query Performance** | ❌ Load all       | ✅ Indexed                |
| **Schema Evolution**  | ❌ Migration hell | ✅ ALTER TABLE            |
| **Data Integrity**    | ❌ Hope for best  | ✅ Constraints            |

## The Reality

**JSON files are simpler... until they're not.**

Once you need:

- Multiple users editing same personality
- Transactional updates
- Complex queries
- Data relationships
- Schema evolution

...you need a database. The backup complexity is worth it.

## Quick Win: Start Simple

**Phase 1 (Day 1):**

- Use Railway automatic backups only
- **This is already better than JSON files** (automatic, tested, reliable)

**Phase 2 (Week 1):**

- Add S3/R2 daily dumps
- Sleep better at night

**Phase 3 (Month 1):**

- Add JSON exports for compatibility
- Test restore process
- Set up monitoring

You don't need perfect backups on day one. Railway's automatic backups are already solid.

## Emergency Contacts

- Railway Support: https://railway.app/help
- Postgres Recovery Docs: https://www.postgresql.org/docs/current/backup.html
- Your own sanity: Take backups seriously, but don't let perfect be the enemy of good
