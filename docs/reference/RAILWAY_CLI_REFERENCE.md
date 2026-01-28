# Railway CLI Reference

**Railway CLI Version**: 4.27.4
**Last Updated**: 2026-01-28
**Purpose**: Accurate command reference to prevent errors from outdated AI training data

---

## ⚠️ Critical Notes

### Variable Management Limitations

**Railway CLI CANNOT delete variables!** The `variables` command only supports:

- ✅ Viewing variables
- ✅ Setting variables
- ❌ **NO** deleting/unsetting variables

**To delete variables**: Use the Railway web dashboard.

### Rate Limiting

Railway has deployment rate limits. When setting many variables at once, you may see:

```
Service deployment rate limit exceeded
```

Wait a few minutes between bulk operations.

---

## Non-Interactive & Automation Mode

Railway CLI supports full non-interactive operation for CI/CD pipelines and AI assistants.

### JSON Output (All Commands)

**Every command** supports `--json` for machine-readable output:

```bash
# Get structured data instead of human-readable text
railway status --json
railway variables --json
railway logs --json
railway list --json
railway whoami --json

# Parse with jq
railway variables --json | jq '.DATABASE_URL'
railway list --json | jq '.[0].name'
```

### Browserless Authentication

For headless environments (CI, SSH, Codespaces):

```bash
# Returns a 4-word pairing code
railway login --browserless

# With 2FA (added in v4.27.2)
railway login --2fa-code 123456
```

**Environment variable authentication** (recommended for CI):

```bash
# Set RAILWAY_TOKEN for automated scripts
export RAILWAY_TOKEN="your-token-here"

# Token scopes:
# - Account-scoped: Full access to all projects
# - Project-scoped: Limited to specific project
```

### Confirmation Skipping

Skip interactive prompts with `--yes` or `-y`:

```bash
railway redeploy --yes
railway down --yes
railway environment delete --yes
```

### CI/CD Deployment

```bash
# Build logs only, exit when done (ideal for CI)
railway up --ci

# Detach from log stream
railway up --detach
```

### Environment Configuration (v4.27.0+)

Configure services without interactive prompts using dot-path notation:

```bash
# Create environment with service config
railway environment new --name staging --service-config "api.replicas=2"

# Edit environment config
railway environment edit --service-config "worker.memory=512Mi"
```

---

## Authentication & Project Setup

### Login

```bash
# Interactive (opens browser)
railway login

# Headless/CI environments (returns 4-word pairing code)
railway login --browserless

# With 2FA code (v4.27.2+)
railway login --2fa-code 123456

# Token-based (CI/CD) - set environment variable
export RAILWAY_TOKEN="your-token-here"
```

### Check Current User

```bash
railway whoami
# Shows logged-in user email
```

### Link Project

```bash
# Link to existing project (interactive selector)
railway link

# Link to specific project by ID
railway link <project-id>

# Check current link status
railway status
```

### Unlink Project

```bash
railway unlink
# Removes link from current directory
```

---

## Environment & Service Management

### Check Status

```bash
railway status
# Shows:
# - Project name
# - Environment (development/production)
# - Linked service
```

### Link Service

```bash
# Interactive service selector
railway service

# Link specific service by name/ID
railway service <service-name>
railway service api-gateway
railway service bot-client
railway service ai-worker
```

### Switch Environment

```bash
railway environment
# Interactive environment selector

# Link specific environment
railway environment <environment-name>
railway environment development
railway environment production
```

### Create New Environment

```bash
railway environment new
# Interactive prompts for environment name and base environment
```

### Delete Environment

```bash
railway environment delete
# Delete current environment (with confirmation)

railway environment delete <environment-name>
# Delete specific environment

railway environment remove <environment-name>
railway environment rm <environment-name>
# Aliases for delete
```

### Syncing Between Environments

**⚠️ Environment sync must be done via Railway dashboard** (no CLI support yet).

**How to Sync**:

1. Go to Railway dashboard
2. Switch to target environment (e.g., production)
3. Click **"Sync"** button
4. Select source environment (e.g., development)
5. Review diff showing:
   - New/modified/removed variables
   - Service configuration changes
   - **Shared variables** included
6. Click **"Sync"** to apply

**What Gets Synced**:

- ✅ Shared variables
- ✅ Service-specific variables
- ✅ Service configurations
- ✅ Reference variables
- ❌ Sealed variables (not shown in diff)

**Best Practice**: Always review diff before syncing to production!

---

## Variables Management

### View Variables

```bash
# View variables for currently linked service
railway variables

# View variables for specific service
railway variables --service api-gateway
railway variables --service bot-client
railway variables --service ai-worker
railway variables -s <service-name>

# View variables for specific environment
railway variables --environment production
railway variables -e production

# Output as JSON
railway variables --json

# Output as KEY=VALUE pairs
railway variables --kv
```

### Set Variables

```bash
# Set single variable (for currently linked service)
railway variables --set "KEY=value"
railway variables --set "NODE_ENV=production"

# Set multiple variables at once
railway variables --set "KEY1=value1" --set "KEY2=value2"
railway variables --set "LOG_LEVEL=debug" --set "NODE_ENV=development"

# Set variable for specific service
railway variables --service api-gateway --set "PORT=3000"
railway variables -s bot-client --set "DISCORD_TOKEN=your-token"

# Set variable with complex value (use quotes!)
railway variables --set "DATABASE_URL=postgresql://user:pass@host:port/db"
```

**⚠️ IMPORTANT**: The CLI only sets **service-specific variables**. To create **shared variables** that apply to multiple services, you MUST use the Railway dashboard:

1. Go to Project Settings → Shared Variables
2. Add variables there
3. Click "Share" button to make them available to services

See "Shared Variables" section below for details.

### ❌ DELETE Variables

**NOT SUPPORTED** via CLI. Use Railway web dashboard:

1. Go to project dashboard
2. Navigate to service
3. Click "Variables" tab
4. Click trash icon next to variable

---

## Shared Variables (Dashboard Only)

**❌ CLI CANNOT create or manage shared variables!** You must use the dashboard.

### Creating Shared Variables

1. Go to Railway project dashboard
2. Click **"Project Settings"** (gear icon)
3. Navigate to **"Shared Variables"** tab
4. Select your environment (development/production)
5. Click **"Add Variable"**
6. Enter name and value
7. Click **"Add"**

### Sharing Variables with Services

After creating shared variables:

**Method 1: From Shared Variables tab**

1. Click the **"Share"** button next to the variable
2. Select which services should have access
3. Click **"Share"**

**Method 2: From service Variables tab**

1. Go to the service's Variables tab
2. Click **"Add Shared Variable"**
3. Select the shared variable to add

### Variable References

In the dashboard, you can reference other variables:

```bash
# Reference Postgres addon (private network)
DATABASE_URL=${{Postgres.DATABASE_URL}}

# Reference Postgres addon (public TCP proxy)
DATABASE_PUBLIC_URL=${{Postgres.DATABASE_PUBLIC_URL}}

# Reference Redis addon
REDIS_URL=${{Redis.REDIS_URL}}

# Reference another service's domain
GATEWAY_URL=${{api-gateway.RAILWAY_PUBLIC_DOMAIN}}
```

**These references only work in the dashboard, NOT in local .env files!**

---

## Deployment

### Deploy Current Directory

```bash
# Deploy and stream logs (interactive)
railway up

# Deploy without watching logs
railway up --detach
railway up -d

# Deploy specific service
railway up --service api-gateway
railway up -s bot-client

# Deploy to specific environment
railway up --environment production
railway up -e production

# CI mode (build logs only, then exit)
railway up --ci
railway up -c
```

### Redeploy Latest

```bash
# Redeploy currently linked service (with confirmation)
railway redeploy

# Skip confirmation
railway redeploy --yes
railway redeploy -y

# Redeploy specific service
railway redeploy --service api-gateway
railway redeploy -s ai-worker
```

### Remove Deployment

```bash
# Remove most recent deployment
railway down
```

---

## Logs

### View Logs

```bash
# View logs for linked service (streams live)
railway logs

# View logs for specific service
railway logs --service api-gateway
railway logs -s bot-client

# View logs for specific environment
railway logs --environment production
railway logs -e production

# View deployment logs (not build logs)
railway logs --deployment
railway logs -d

# View build logs
railway logs --build
railway logs -b

# View logs for specific deployment ID
railway logs <deployment-id>

# Output as JSON
railway logs --json
```

**Common Usage**:

```bash
# Stream live logs from all services (run in separate terminals)
railway logs --service api-gateway
railway logs --service ai-worker
railway logs --service bot-client

# View last deployment logs
railway logs --deployment
```

---

## Domains

### Generate Railway Domain

```bash
# Generate Railway-provided domain for linked service
railway domain

# Generate for specific service
railway domain --service bot-client
railway domain -s api-gateway

# Specify port
railway domain --port 3000
railway domain -p 8080 --service api-gateway
```

### Add Custom Domain

```bash
# Add custom domain and get DNS records
railway domain yourdomain.com --service api-gateway

# With specific port
railway domain yourdomain.com --port 3000 --service bot-client

# Output DNS records as JSON
railway domain yourdomain.com --json
```

**Note**: Railway provides max 1 free `.up.railway.app` domain per service.

---

## Database Operations

### Connect to Database Shell

```bash
# Connect to PostgreSQL (psql)
railway connect

# Connect to specific database service
railway connect Postgres
railway connect Redis

# For MongoDB
railway connect MongoDB  # Opens mongosh
```

### Run Commands with Environment Variables

```bash
# Run local command with Railway variables injected
railway run <command>

# Examples:
railway run npm run dev
railway run prisma migrate dev
railway run psql  # If DATABASE_URL is set
railway run node scripts/seed.js

# Open subshell with Railway variables
railway shell
# Now all commands have Railway env vars available
```

### Database Backup and Replication

**Dump and restore between environments** (e.g., dev → prod):

```bash
# Step 1: Dump development database
railway environment development
railway run pg_dump > tzurot-dev-backup.sql

# Step 2: Restore to production
railway environment production
railway run psql < tzurot-dev-backup.sql
```

**Full clean restore** (drops existing tables first):

```bash
# Step 1: Dump with --clean flag (drops tables before restore)
railway environment development
railway run pg_dump --clean --if-exists > tzurot-full-backup.sql

# Step 2: Restore to production
railway environment production
railway run psql < tzurot-full-backup.sql
```

**Schema-only dump** (no data):

```bash
railway environment development
railway run pg_dump --schema-only > schema.sql

railway environment production
railway run psql < schema.sql
```

**Data-only dump** (no schema):

```bash
railway environment development
railway run pg_dump --data-only > data.sql

railway environment production
railway run psql < data.sql
```

**Dump specific tables**:

```bash
railway environment development
railway run pg_dump --table=users --table=personalities > specific-tables.sql
```

**Compress large dumps**:

```bash
# Dump and compress
railway environment development
railway run pg_dump | gzip > backup.sql.gz

# Decompress and restore
railway environment production
gunzip -c backup.sql.gz | railway run psql
```

### Database Migration Workflow

**Before deploying to production**:

```bash
# 1. Verify development database is clean
railway environment development
railway run psql -c "SELECT COUNT(*) FROM users;"
railway run psql -c "SELECT COUNT(*) FROM personalities;"

# 2. Create timestamped backup
DATE=$(date +%Y%m%d-%H%M%S)
railway run pg_dump > backups/tzurot-dev-$DATE.sql

# 3. Switch to production and backup existing data (if any)
railway environment production
railway run pg_dump > backups/tzurot-prod-$DATE-before-restore.sql

# 4. Restore development data to production
railway run psql < backups/tzurot-dev-$DATE.sql

# 5. Verify production data
railway run psql -c "SELECT COUNT(*) FROM users;"
railway run psql -c "SELECT COUNT(*) FROM personalities;"
```

### Important Notes

⚠️ **Always backup production before restoring**:

```bash
railway environment production
railway run pg_dump > prod-backup-$(date +%Y%m%d-%H%M%S).sql
```

⚠️ **Use --clean --if-exists for clean slate**:

- Drops existing tables before restoring
- Prevents conflicts with existing data
- Safest option for full replication

⚠️ **Database URLs**:

- `railway run` automatically uses `DATABASE_URL` from environment
- No need to specify connection string manually
- Works with both private network and public proxy URLs

### Troubleshooting: Version Mismatch Issues

**Problem**: `pg_dump: error: aborting because of server version mismatch`

**Cause**: Railway runs PostgreSQL 17.x, but your local `pg_dump` is an older version (e.g., 16.x). `pg_dump` requires the client version to match or be newer than the server version.

**Common on**: Steam Deck (SteamOS), older Linux distributions, systems with outdated PostgreSQL packages.

**Why Railway CLI doesn't help**: `railway run pg_dump` executes pg_dump **locally** with Railway environment variables injected. It does NOT run the command on Railway's servers. Therefore, you still need compatible local PostgreSQL tools.

#### Workaround: CSV Export/Import Method

When you can't upgrade local PostgreSQL to match Railway's version, use CSV export/import:

**Step 1: Deploy Schema to Production (using Prisma)**

```bash
# Switch to production environment
railway environment production
railway service Postgres

# Get production public database URL
PROD_DB_URL=$(railway variables --kv | grep DATABASE_PUBLIC_URL | cut -d'=' -f2)

# Deploy schema using Prisma (uses public URL to avoid .railway.internal)
DATABASE_URL="$PROD_DB_URL" npx prisma migrate deploy
```

**Step 2: Export Development Data as CSV**

```bash
# Switch to development environment
railway environment development
railway service Postgres

# Get development public database URL
DEV_DB_URL=$(railway variables --kv | grep DATABASE_PUBLIC_URL | cut -d'=' -f2)

# Create backups directory
mkdir -p backups/csv

# Export all tables as CSV
# Note: Adjust table list based on your schema
psql "$DEV_DB_URL" << 'EOF'
\copy users TO 'backups/csv/users.csv' CSV HEADER
\copy personalities TO 'backups/csv/personalities.csv' CSV HEADER
\copy personas TO 'backups/csv/personas.csv' CSV HEADER
\copy system_prompts TO 'backups/csv/system_prompts.csv' CSV HEADER
\copy llm_configs TO 'backups/csv/llm_configs.csv' CSV HEADER
\copy personality_owners TO 'backups/csv/personality_owners.csv' CSV HEADER
\copy user_personality_settings TO 'backups/csv/user_personality_settings.csv' CSV HEADER
\copy activated_channels TO 'backups/csv/activated_channels.csv' CSV HEADER
\copy conversation_history TO 'backups/csv/conversation_history.csv' CSV HEADER
EOF

# Verify exports
ls -lh backups/csv/
```

**Step 3: Import to Production (with Foreign Key Constraints Handled)**

```bash
# Switch to production environment
railway environment production
railway service Postgres

# Get production public database URL
PROD_DB_URL=$(railway variables --kv | grep DATABASE_PUBLIC_URL | cut -d'=' -f2)

# Import with constraints temporarily disabled
psql "$PROD_DB_URL" << 'EOF'
-- Disable foreign key checks to handle circular dependencies
SET session_replication_role = replica;

-- Clear existing data (if any)
TRUNCATE users, personalities, personas, system_prompts, llm_configs,
         personality_owners, user_personality_settings, activated_channels,
         conversation_history CASCADE;

-- Import in order (base tables first, then dependent tables)
\copy system_prompts FROM 'backups/csv/system_prompts.csv' CSV HEADER
\copy llm_configs FROM 'backups/csv/llm_configs.csv' CSV HEADER
\copy users FROM 'backups/csv/users.csv' CSV HEADER
\copy personalities FROM 'backups/csv/personalities.csv' CSV HEADER
\copy personas FROM 'backups/csv/personas.csv' CSV HEADER
\copy personality_owners FROM 'backups/csv/personality_owners.csv' CSV HEADER
\copy user_personality_settings FROM 'backups/csv/user_personality_settings.csv' CSV HEADER
\copy activated_channels FROM 'backups/csv/activated_channels.csv' CSV HEADER
\copy conversation_history FROM 'backups/csv/conversation_history.csv' CSV HEADER

-- Re-enable foreign key checks
SET session_replication_role = DEFAULT;

-- Verify counts
SELECT 'users' as table, COUNT(*) as count FROM users
UNION ALL SELECT 'personalities', COUNT(*) FROM personalities
UNION ALL SELECT 'personas', COUNT(*) FROM personas
UNION ALL SELECT 'conversation_history', COUNT(*) FROM conversation_history;
EOF
```

**Step 4: Verify Data Integrity**

```bash
# Check foreign key relationships are intact
psql "$PROD_DB_URL" -c "
SELECT
  'users with personas' as check,
  COUNT(*) as count
FROM users u
JOIN personas p ON u.global_persona_id = p.id
UNION ALL
SELECT
  'personalities with configs',
  COUNT(*)
FROM personalities per
JOIN system_prompts sp ON per.system_prompt_id = sp.id
JOIN llm_configs llm ON per.llm_config_id = llm.id
UNION ALL
SELECT
  'conversation history with users',
  COUNT(*)
FROM conversation_history ch
JOIN users u ON ch.user_id = u.id;
"
```

#### Why This Workaround Works

1. **Prisma handles schema**: Uses Prisma migrations to create tables (version-independent)
2. **CSV format is universal**: Works across PostgreSQL versions
3. **psql has broader compatibility**: Can connect to newer servers than pg_dump can dump from
4. **Constraint handling**: Temporarily disabling foreign keys handles circular dependencies (users ↔ personas)
5. **Public URL**: Bypasses `.railway.internal` hostname issues when running locally

#### Important Notes

⚠️ **Circular Dependencies**: Some schemas have circular foreign keys (e.g., users reference personas, personas reference users). The `SET session_replication_role = replica` trick disables constraint checking during import.

⚠️ **Import Order Matters**: Import base tables before dependent tables when possible, but circular dependencies require constraint disabling anyway.

⚠️ **Verify After Import**: Always verify foreign key relationships are intact after re-enabling constraints.

⚠️ **This is a Workaround**: The proper solution is upgrading local PostgreSQL to match Railway's version. But if that's not possible (Steam Deck, corporate environments, etc.), this CSV method works reliably.

⚠️ **psql vs pg_dump versions**: `psql` (for queries/imports) has better backward compatibility than `pg_dump` (for exports). Hence why `psql` works but `pg_dump` fails with version mismatches.

#### Long-term Fix

Install PostgreSQL 17 client tools to match Railway's server version:

```bash
# Arch Linux (if available)
sudo pacman -S postgresql

# Ubuntu/Debian
sudo apt install postgresql-client-17

# macOS (Homebrew)
brew install postgresql@17

# Or use Docker/Podman with PostgreSQL 17 image
docker run --rm postgres:17 pg_dump --version
```

On Steam Deck specifically, you may encounter keyring/signature issues. See the "Error Messages & Solutions" section for fixes.

---

## Project Management

### List Projects

```bash
railway list
# Shows all projects in your account
```

### Create New Project

```bash
railway init
# Interactive project creation
```

### Open Dashboard

```bash
# Open current project in browser
railway open

# Open specific service
railway open --service api-gateway
```

### View Documentation

```bash
railway docs
# Opens Railway docs in browser
```

---

## Volumes

```bash
railway volume --help
# Manage persistent volumes for services
```

---

## SSH Access

```bash
# SSH into running service container
railway ssh

# SSH into specific service
railway ssh --service api-gateway
```

---

## Completion

```bash
# Generate shell completion scripts
railway completion bash
railway completion zsh
railway completion fish
```

---

## Common Workflows

### Setup New Service

```bash
# 1. Link to project
railway link

# 2. Link to service
railway service api-gateway

# 3. Set variables
railway variables --set "PORT=3000" --set "NODE_ENV=development"

# 4. Deploy
railway up
```

### Check Service Health

```bash
# 1. Check status
railway status

# 2. View recent logs
railway logs --deployment

# 3. Open dashboard if issues
railway open
```

### Update Environment Variables

```bash
# 1. Set new variables
railway variables --set "NEW_VAR=value"

# 2. Services auto-redeploy (Railway triggers automatically)

# OR manually redeploy
railway redeploy --yes
```

### Deploy to Production

```bash
# 1. Switch to production environment
railway environment production

# 2. Verify you're in production
railway status

# 3. Deploy
railway up --ci  # CI mode for production

# 4. Watch logs
railway logs
```

### Sync Development Changes to Production

```bash
# 1. Test changes in development first
railway environment development
railway status
# Make changes, test...

# 2. Use dashboard to sync (CLI can't do this)
# - Go to Railway dashboard
# - Switch to production environment
# - Click "Sync" → Select "development"
# - Review diff carefully
# - Click "Sync" to apply

# 3. Adjust production-specific variables in dashboard
# - Change NODE_ENV=production
# - Change LOG_LEVEL=info
# - Update any dev-specific credentials

# 4. Verify production deployment
railway environment production
railway logs
```

### Debug Deployment Issues

```bash
# 1. View build logs
railway logs --build

# 2. View deployment logs
railway logs --deployment

# 3. Check variables are set
railway variables

# 4. SSH into container if running
railway ssh
```

---

## Error Messages & Solutions

### "Not linked to a Railway project"

```bash
# Solution: Link to project
railway link
```

### "Service deployment rate limit exceeded"

```bash
# Solution: Wait 2-5 minutes, then try again
# Railway limits how often services can redeploy
```

### "Railway CLI is not installed"

```bash
# Solution: Install Railway CLI
npm install -g @railway/cli
# Or using other package managers (see Railway docs)
```

### Variables Not Taking Effect

```bash
# Solution: Railway auto-redeploys when variables change
# Check deployment logs:
railway logs --deployment

# Or manually trigger redeploy:
railway redeploy --yes
```

---

## Important Railway Concepts

### Service References

In Railway dashboard, you can reference other services:

```bash
# Reference another service's URL
GATEWAY_URL=${{api-gateway.RAILWAY_PUBLIC_DOMAIN}}

# Reference database addon variables
DATABASE_URL=${{Postgres.DATABASE_URL}}  # Private network (recommended)
DATABASE_PUBLIC_URL=${{Postgres.DATABASE_PUBLIC_URL}}  # TCP proxy (external access)

# Reference Redis addon
REDIS_URL=${{Redis.REDIS_URL}}
```

**Important**:

- These references work in the dashboard but NOT in local .env files!
- `DATABASE_URL` from Postgres addon uses the **private network** (`.railway.internal`)
- `DATABASE_PUBLIC_URL` uses the **TCP proxy** for external access

### Private vs Public Networking

**Private Network** (`.railway.internal`):

- Free, no egress charges
- Only accessible within Railway project
- Example: `api-gateway.railway.internal`

**Public Network** (TCP Proxy/Domains):

- Accessible from internet
- Egress charges apply for databases
- Example: `nozomi.proxy.rlwy.net:48102`

### Environment Inheritance

- Variables set in "Shared" apply to all services
- Service-specific variables override shared ones
- Environment-specific variables override both

---

## CLI vs Dashboard

### What CLI Can Do ✅

- View variables
- Set variables (service-specific only)
- Deploy services
- View logs
- Link/unlink projects and services
- Generate domains
- Create/delete environments
- Switch between environments

### What CLI Cannot Do ❌

- Create/manage shared variables (use dashboard)
- Delete variables (use dashboard)
- Sync environments (use dashboard)
- Modify service configuration (use dashboard)
- Access billing (use dashboard)
- Configure networking details (use dashboard)
- Manage team members (use dashboard)

**When in doubt, use the dashboard!**

---

## Reference Links

- **Railway Docs**: https://docs.railway.com
- **CLI GitHub**: https://github.com/railwayapp/cli
- **Community**: https://help.railway.com

---

## Version History

| Date       | CLI Version | Changes                                        |
| ---------- | ----------- | ---------------------------------------------- |
| 2026-01-28 | 4.27.4      | Added non-interactive/automation section       |
|            |             | Added --json flag documentation (all commands) |
|            |             | Added --browserless, --2fa-code, --yes flags   |
|            |             | Added environment config subcommand            |
| 2025-10-23 | 4.5.3       | Initial comprehensive reference created        |

---

## Notes for AI Assistants

**Before running ANY Railway command**:

1. Consult this reference first
2. Use exact syntax shown here
3. If unsure, use `railway <command> --help`
4. Remember: CLI cannot delete variables!
5. Check for rate limiting after bulk operations
6. **Use `--json` for parsing output** - all commands support it

**Common Mistakes to Avoid**:

- ❌ `railway variables --unset KEY` (doesn't exist!)
- ❌ `railway service list` (doesn't exist!)
- ❌ `railway restart` (doesn't exist - use `redeploy`)
- ❌ `railway logs --tail N` (use `-n N` instead)
- ❌ `railway variables set KEY=value` (use `--set "KEY=value"`)
- ❌ Assuming commands from other CLIs work the same
- ❌ Not checking `--help` when uncertain

**Best Practices for Automation**:

- ✅ Use `--json` flag and parse with `jq`
- ✅ Use `RAILWAY_TOKEN` env var for CI/CD
- ✅ Use `--yes` to skip confirmation prompts
- ✅ Use `--ci` with `railway up` for build-only output
