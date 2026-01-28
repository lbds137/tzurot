# Railway Operations Guide

**Last Updated**: 2026-01-28
**Purpose**: Operational guide for deploying and managing Tzurot v3 on Railway

> **For CLI command syntax**: See `docs/reference/RAILWAY_CLI_REFERENCE.md`

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Initial Deployment](#initial-deployment)
3. [Environment Variables](#environment-variables)
4. [Database Operations](#database-operations)
5. [Volume Setup (Avatars)](#volume-setup-avatars)
6. [IDE Database Access](#ide-database-access)
7. [CI/CD Integration](#cicd-integration)
8. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

Tzurot v3 is a monorepo with 3 microservices deployed to Railway:

| Service         | Purpose                       | Port |
| --------------- | ----------------------------- | ---- |
| **bot-client**  | Discord bot (Discord.js)      | -    |
| **api-gateway** | HTTP API (Express)            | 3000 |
| **ai-worker**   | AI processing + vector memory | 3001 |

### Required Railway Services

| Service        | Purpose                    | Auto-configured |
| -------------- | -------------------------- | --------------- |
| **PostgreSQL** | Relational data + pgvector | `DATABASE_URL`  |
| **Redis**      | BullMQ job queue + caching | `REDIS_URL`     |

**Note**: pgvector is included in Railway's PostgreSQL addon - no separate vector database needed.

### Private Networking

Services communicate via Railway's private network:

```
bot-client → http://api-gateway.railway.internal:3000
api-gateway → http://ai-worker.railway.internal:3001
```

---

## Initial Deployment

### 1. Connect Repository

1. Go to Railway dashboard → "New Project"
2. Select "Deploy from GitHub repo"
3. Choose your `tzurot` repository

### 2. Add Database Services

1. Click "+ New Service" → "Database" → "Add PostgreSQL"
2. Click "+ New Service" → "Database" → "Add Redis"

### 3. Deploy Application Services

Railway auto-detects services from `railway.json`. If not:

1. Click "+ New Service" → "Empty Service"
2. Set root directory (e.g., `services/bot-client`)
3. Railway auto-detects Dockerfiles (uses `turbo prune` for dependencies)

### 4. Configure Environment Variables

See [Environment Variables](#environment-variables) section below.

### 5. Verify Deployment

**Check service health**:

```bash
curl https://api-gateway-development-83e8.up.railway.app/health
```

**Expected startup logs**:

```
[BotClient] Connected to Discord as YourBot#1234
[APIGateway] Server listening on port 3000
[AIWorker] BullMQ worker started, pgvector connection: OK
```

---

## Environment Variables

### Quick Setup (Recommended)

```bash
# Preview what will be set
pnpm ops deploy:setup-vars --env dev --dry-run

# Apply to development
pnpm ops deploy:setup-vars --env dev

# Apply to production
pnpm ops deploy:setup-vars --env prod
```

The script reads from your `.env` file and sets variables in Railway.

### Variable Categories

**Shared (all services)**:

| Variable                | Description                               |
| ----------------------- | ----------------------------------------- |
| `DATABASE_URL`          | PostgreSQL connection (includes pgvector) |
| `REDIS_URL`             | Redis connection                          |
| `AI_PROVIDER`           | AI provider (e.g., `openrouter`)          |
| `OPENROUTER_API_KEY`    | OpenRouter API key                        |
| `OPENAI_API_KEY`        | OpenAI key (for Whisper transcription)    |
| `DEFAULT_AI_MODEL`      | Default model                             |
| `WHISPER_MODEL`         | Audio transcription (`whisper-1`)         |
| `VISION_FALLBACK_MODEL` | Image analysis model                      |
| `NODE_ENV`              | Environment (`production`/`development`)  |
| `LOG_LEVEL`             | Logging verbosity                         |

**bot-client only**:

| Variable            | Description            |
| ------------------- | ---------------------- |
| `DISCORD_TOKEN`     | Discord bot token      |
| `DISCORD_CLIENT_ID` | Discord application ID |

**api-gateway only**:

| Variable | Description                 |
| -------- | --------------------------- |
| `PORT`   | Listen port (default: 3000) |

**ai-worker only**:

| Variable             | Description                       |
| -------------------- | --------------------------------- |
| `WORKER_CONCURRENCY` | Concurrent jobs (default: 5)      |
| `PORT`               | Health check port (default: 3001) |

### Database URL Strategy

Railway provides two PostgreSQL connection types:

| Type        | Use For                           | URL Format                |
| ----------- | --------------------------------- | ------------------------- |
| **Private** | Service-to-service (faster, free) | `*.railway.internal:5432` |
| **Public**  | External access (IDE, local dev)  | `*.proxy.rlwy.net:<port>` |

**For Railway services**: Use `${{Postgres.DATABASE_URL}}` (private network)

**For local development**: Use `DATABASE_PUBLIC_URL` (TCP proxy)

### Managing Variables

```bash
# List variables (use --json for parsing)
railway variables --service api-gateway
railway variables --json

# Set variable
railway variables --set "KEY=value" --service api-gateway

# Delete variable - USE DASHBOARD (CLI cannot delete!)
# Go to: Railway Dashboard → Service → Variables → Delete
```

### Setting Up Shared Variables in Dashboard

1. Go to Project Settings → Shared Variables
2. Select environment (development/production)
3. Add each shared variable
4. Click "Share" button → Select all services

### Syncing to Production

1. Switch to production environment in dashboard
2. Click "Sync" → Select "development" as source
3. Review diff carefully
4. Adjust production-specific values:
   - `NODE_ENV=production`
   - `LOG_LEVEL=info`
5. Click "Sync" to apply

---

## Database Operations

### Using pnpm ops (Recommended)

```bash
# Check migration status
pnpm ops db:status --env dev
pnpm ops db:status --env prod

# Run pending migrations
pnpm ops db:migrate --env dev
pnpm ops db:migrate --env prod --force  # Prod requires --force

# Open Prisma Studio
pnpm ops run --env dev npx prisma studio

# Run any script with Railway credentials
pnpm ops run --env dev tsx scripts/src/db/some-script.ts
```

### Migration Safety

> **CRITICAL**: Prisma migrations use your LOCAL `prisma/migrations/` folder!

Before running migrations:

1. Checkout the branch that matches deployed code
2. Verify migrations: `ls prisma/migrations/`
3. Confirm production code supports all schema changes

**See postmortem**: 2026-01-17 Wrong Branch Migration Deployment

---

## Volume Setup (Avatars)

Personality avatars are stored in a Railway volume mounted to api-gateway.

### Configuration

| Setting         | Value               |
| --------------- | ------------------- |
| **Service**     | api-gateway         |
| **Volume Name** | tzurot-avatars      |
| **Mount Path**  | /data               |
| **Size**        | 1GB (~2000 avatars) |
| **Cost**        | ~$0.25/GB/month     |

### Setup Steps

1. Navigate to api-gateway service in Railway
2. Go to "Volumes" tab → "New Volume"
3. Configure: Name=`tzurot-avatars`, Path=`/data`, Size=1GB
4. Click "Add Volume"

### Verify Setup

```bash
# Check volume is mounted
railway run --service api-gateway sh -c "ls -la /data"

# Create avatars directory
railway run --service api-gateway sh -c "mkdir -p /data/avatars"

# Check health endpoint
curl https://api-gateway-xxx.up.railway.app/health | jq '.avatars'
```

### Backup and Recovery

```bash
# Download all avatars
railway volume download tzurot-avatars --output ./avatars-backup

# Restore from backup
railway volume upload tzurot-avatars --source ./avatars-backup
```

---

## IDE Database Access

### JetBrains IDE Setup

1. **Get public URL**:

   ```bash
   railway environment development
   railway variables --json | jq -r '.DATABASE_PUBLIC_URL'
   ```

2. **In IDE** (WebStorm, IntelliJ):
   - Open Database tool window
   - Click + → Data Source → PostgreSQL
   - Enter: Host, Port, Database (`railway`), User (`postgres`), Password
   - Enable SSL: SSH/SSL tab → Use SSL: `require`
   - Test Connection → OK

3. **Pro tips**:
   - Create separate connections for dev and prod
   - Color-code production RED to avoid accidents
   - Name clearly: "Tzurot Dev", "Tzurot Prod"

### Enabling TCP Proxy

If `DATABASE_PUBLIC_URL` isn't available:

1. Go to Postgres service in Railway dashboard
2. Settings → Networking → Enable TCP Proxy
3. Railway generates `DATABASE_PUBLIC_URL`

---

## CI/CD Integration

### GitHub Actions Example

```yaml
- name: Setup Railway Variables
  run: pnpm ops deploy:setup-vars --env dev --yes
  env:
    RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
    OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
    DISCORD_TOKEN: ${{ secrets.DISCORD_TOKEN }}
```

### Token Authentication

```bash
# Set token for CI/CD (no browser login needed)
export RAILWAY_TOKEN="your-token-here"

# Or use browserless login
railway login --browserless
```

---

## Troubleshooting

### Common Issues

| Symptom            | Check                 | Solution                  |
| ------------------ | --------------------- | ------------------------- |
| Service crashed    | `railway logs -n 100` | Check missing env vars    |
| Slow responses     | Logs for duration     | Check DB/Redis connection |
| Bot not responding | bot-client logs       | Verify DISCORD_TOKEN      |
| Migration failed   | `pnpm ops db:status`  | Apply with `db:migrate`   |

### Service Won't Start

1. Check logs: `railway logs --service <name> -n 100`
2. Verify env vars: `railway variables --service <name> --json`
3. Confirm DATABASE_URL and REDIS_URL are set

### Services Not Communicating

- Use Railway's internal networking (`.railway.internal`)
- Don't use public URLs for service-to-service calls
- Check PORT matches what service listens on

### Avatar Issues

**Volume not accessible** (`avatarStorage: false`):

```bash
railway run --service api-gateway sh -c "mount | grep /data"
railway run --service api-gateway sh -c "mkdir -p /data/avatars"
```

**404 on avatars**:

```bash
railway run --service api-gateway sh -c "ls -la /data/avatars"
```

### Rollback

1. Go to Deployments tab in Railway
2. Click on last working deployment
3. Click "Redeploy"

Or revert the git commit and push.

---

## Security Notes

- Never commit `.env` to git
- Railway variables are encrypted at rest
- Limit who has Railway project access
- Use strong passwords (Railway generates good defaults)
- Rotate compromised credentials immediately
- TCP proxy + SSL is safe for hobby-to-production projects

---

## References

- **CLI Reference**: `docs/reference/RAILWAY_CLI_REFERENCE.md`
- **Railway Docs**: https://docs.railway.com
- **Railway Volumes**: https://docs.railway.com/guides/volumes
