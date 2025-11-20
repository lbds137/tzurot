---
name: tzurot-deployment
description: Railway deployment operations for Tzurot v3 - Service management, log analysis, environment variables, health checks, and troubleshooting. Use when deploying, debugging production issues, or managing Railway infrastructure.
lastUpdated: '2025-11-19'
---

# Deployment Skill - Tzurot v3

> **Critical Context**: Tzurot v3 is deployed on Railway in development environment for private testing. NOT open to public yet (requires BYOK implementation).

## 🎯 Use This Skill When

- Deploying changes to Railway
- Checking service logs
- Managing environment variables
- Debugging production issues
- Verifying service health
- Rolling back deployments
- Managing Railway infrastructure

## 🚂 Railway CLI Reference

> **IMPORTANT**: Always consult `docs/reference/RAILWAY_CLI_REFERENCE.md` before running Railway commands. AI training data may be outdated for Railway CLI 4.5.3.

## Core Deployment Operations

### 1. Service Status Checks

```bash
# Check all services status
railway status

# Check specific service
railway status --service api-gateway
railway status --service ai-worker
railway status --service bot-client

# Check deployment history
railway deploy --service api-gateway
```

### 2. Viewing Logs

**Pattern**: Always use correlation IDs to trace requests across services.

```bash
# Tail logs for a service (last 50 lines, follow mode)
railway logs --service api-gateway --tail 50

# Tail logs for ai-worker
railway logs --service ai-worker --tail 50

# Tail logs for bot-client
railway logs --service bot-client --tail 50

# Search logs for specific pattern
railway logs --service api-gateway | grep "ERROR"

# Find logs with correlation ID (trace request across services)
railway logs --service api-gateway | grep "requestId:abc123"
railway logs --service ai-worker | grep "requestId:abc123"
```

**Log Analysis Tips**:

- Look for correlation IDs to trace requests end-to-end
- Check for ERROR level logs first
- Use timestamps to correlate events across services
- See `tzurot-observability` skill for log structure details

### 3. Environment Variables

**Pattern**: Use Railway dashboard for sensitive values, CLI for non-sensitive.

```bash
# List all environment variables for a service
railway variables --service api-gateway

# Set environment variable
railway variables set OPENROUTER_API_KEY=sk-or-v1-... --service ai-worker

# Set multiple variables
railway variables set \
  AI_PROVIDER=openrouter \
  LOG_LEVEL=info \
  --service ai-worker

# Delete environment variable
railway variables delete OLD_VAR_NAME --service ai-worker
```

**Security Reminder**: See `tzurot-security` skill for secret management best practices.

### 4. Health Checks

```bash
# API Gateway health endpoint
curl https://api-gateway-development-83e8.up.railway.app/health

# Expected response:
# {
#   "status": "healthy",
#   "timestamp": "2025-11-19T14:30:00.000Z",
#   "services": {
#     "database": "connected",
#     "redis": "connected"
#   }
# }
```

**Troubleshooting Unhealthy Services**:

1. Check logs: `railway logs --service <service-name> --tail 100`
2. Verify environment variables: `railway variables --service <service-name>`
3. Check database/Redis connectivity
4. Review recent deployments: `railway status --service <service-name>`

### 5. Deployment Workflow

**Standard Deployment Process**:

1. **Merge PR to develop** (Railway auto-deploys):

   ```bash
   gh pr merge <PR-number> --rebase
   ```

2. **Verify deployment started**:

   ```bash
   railway status --service api-gateway
   # Look for "Deploying" status
   ```

3. **Monitor deployment logs**:

   ```bash
   railway logs --service api-gateway --tail 100
   # Watch for "Server started" or deployment errors
   ```

4. **Verify health endpoint**:

   ```bash
   curl https://api-gateway-development-83e8.up.railway.app/health
   ```

5. **Check all services are healthy**:
   ```bash
   railway status  # Should show all services as "Running"
   ```

**Auto-Deploy Configuration**:

- **Branch**: `develop` (feature branches do NOT auto-deploy)
- **Trigger**: Push to `develop` branch on GitHub
- **Services**: All 3 services (bot-client, api-gateway, ai-worker) deploy independently

### 6. Rolling Back Deployments

**If deployment breaks production**:

```bash
# 1. Check deployment history
railway status --service api-gateway

# 2. Identify last known good commit
git log --oneline -10

# 3. Revert to previous commit (creates new commit)
git revert HEAD
git push origin develop

# 4. Railway will auto-deploy the revert

# OR: Force deploy a specific commit (use with caution)
# See docs/reference/RAILWAY_CLI_REFERENCE.md for correct syntax
```

**Alternative**: Use GitHub to revert the PR merge commit and push to `develop`.

### 7. Manual Deployments

**When auto-deploy fails or you need to redeploy**:

```bash
# Redeploy without code changes (useful for env var updates)
railway up --service api-gateway

# Deploy from current branch (use with caution - usually deploy from develop)
railway up --service ai-worker
```

**⚠️ Warning**: Manual deployments from feature branches can cause inconsistencies. Always deploy from `develop` in production.

## Common Operations

### Restarting a Service

```bash
# Restart a service (useful for picking up new env vars)
railway restart --service bot-client
```

**When to restart**:

- After changing environment variables
- Service is stuck (check logs first!)
- Memory leak suspected (check metrics)

### Database Operations

```bash
# Connect to PostgreSQL database
railway run psql

# Run Prisma migrations
railway run npx prisma migrate deploy

# Generate Prisma client (after schema changes)
railway run npx prisma generate

# View database in Prisma Studio (local only, connects to Railway DB)
npx prisma studio
```

### Redis Operations

```bash
# Connect to Redis CLI (if Redis CLI is installed)
railway run redis-cli

# Common Redis commands:
# - PING (test connection)
# - KEYS * (list all keys - don't use in production!)
# - GET key_name
# - DEL key_name
# - FLUSHDB (clear all keys - DANGEROUS!)
```

## Troubleshooting Guide

### Service Won't Start

**Symptoms**: Service shows "Crashed" or "Failed" status

**Steps**:

1. Check logs for errors:

   ```bash
   railway logs --service <service-name> --tail 100
   ```

2. Common issues:
   - **Missing environment variables**: Check `railway variables --service <service-name>`
   - **Database connection failed**: Verify `DATABASE_URL` is set
   - **Redis connection failed**: Verify `REDIS_URL` is set
   - **Port already in use**: Check for duplicate deployments
   - **Build failed**: Check build logs for TypeScript/dependency errors

3. Verify environment variables are set:
   ```bash
   railway variables --service <service-name> | grep -E "(DATABASE_URL|REDIS_URL|DISCORD_TOKEN)"
   ```

### Slow Response Times

**Symptoms**: API responses taking >5 seconds, timeouts

**Steps**:

1. Check service logs for slow operations:

   ```bash
   railway logs --service api-gateway | grep "duration"
   ```

2. Check database query performance:

   ```bash
   railway logs --service ai-worker | grep "prisma"
   ```

3. Check BullMQ job processing times:

   ```bash
   railway logs --service ai-worker | grep "job completed"
   ```

4. Verify Railway service resources (use Railway dashboard):
   - CPU usage
   - Memory usage
   - Active connections

### Discord Bot Not Responding

**Symptoms**: Bot appears online but doesn't respond to commands

**Steps**:

1. Check bot-client logs:

   ```bash
   railway logs --service bot-client --tail 50
   ```

2. Verify webhook creation (should see "Webhook created" in logs)

3. Check API Gateway is reachable:

   ```bash
   curl https://api-gateway-development-83e8.up.railway.app/health
   ```

4. Verify Discord token is set:

   ```bash
   railway variables --service bot-client | grep DISCORD_TOKEN
   ```

5. Check if bot has proper permissions in Discord server

### Database Migrations Failed

**Symptoms**: Service crashes after deployment with Prisma errors

**Steps**:

1. Check migration status:

   ```bash
   railway run npx prisma migrate status
   ```

2. Apply missing migrations:

   ```bash
   railway run npx prisma migrate deploy
   ```

3. If migrations are corrupted, see `docs/migration/` for recovery procedures

### Memory Leaks

**Symptoms**: Service memory usage gradually increases, eventual crash

**Steps**:

1. Monitor memory usage in Railway dashboard

2. Check for unclosed connections:

   ```bash
   railway logs --service ai-worker | grep "connection"
   ```

3. Look for growing caches or queues:

   ```bash
   railway logs --service bot-client | grep "cache"
   ```

4. Temporary fix: Restart service

   ```bash
   railway restart --service <service-name>
   ```

5. Long-term fix: Investigate code for resource leaks

## Railway-Specific Patterns

### Private Networking

Railway services communicate via private networking (no public internet):

```typescript
// ✅ CORRECT - Use Railway-provided URLs (internal networking)
const GATEWAY_URL = process.env.GATEWAY_URL; // e.g., "http://api-gateway.railway.internal"

// ❌ WRONG - Don't use public URLs for internal communication
const GATEWAY_URL = 'https://api-gateway-development-83e8.up.railway.app';
```

### Environment Variable Injection

Railway automatically injects service URLs:

```typescript
// Railway provides these automatically:
const DATABASE_URL = process.env.DATABASE_URL; // PostgreSQL addon
const REDIS_URL = process.env.REDIS_URL; // Redis addon
const GATEWAY_URL = process.env.GATEWAY_URL; // Service reference
```

**No need to manually configure these** - Railway handles it.

### Service Dependencies

**Startup Order**: Services start in parallel, handle connection retries:

```typescript
// ✅ GOOD - Retry database connection on startup
async function connectWithRetry(maxAttempts = 5) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await prisma.$connect();
      logger.info('Database connected');
      return;
    } catch (error) {
      logger.warn({ attempt, maxAttempts }, 'Database connection failed, retrying...');
      await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    }
  }
  throw new Error('Database connection failed after max attempts');
}
```

See `tzurot-async-flow` skill for retry patterns.

## Cost Optimization

### Development Environment

- **Plan**: Hobby (free tier with credits)
- **Services**: 3 services (bot-client, api-gateway, ai-worker)
- **Addons**: PostgreSQL, Redis

**Cost Monitoring**:

- Check usage in Railway dashboard
- Set up billing alerts (if available)
- Monitor AI API costs (OpenRouter/Gemini) separately

**⚠️ Warning**: Without BYOK, bot owner pays for all AI API usage. Implement rate limiting and token budgeting (see `tzurot-security` skill).

### Production Considerations (Future)

- Implement BYOK (Bring Your Own Key) before public launch
- Add admin commands for usage monitoring
- Set up proper rate limiting per guild/user
- Consider autoscaling for api-gateway and ai-worker

## Deployment Checklist

**Before Every Deployment**:

- [ ] ✅ Tests passing (`pnpm test`)
- [ ] ✅ Linting passing (`pnpm lint`)
- [ ] ✅ PR approved and merged to `develop`
- [ ] ✅ Verified no secrets committed (see `tzurot-security`)

**After Deployment**:

- [ ] ✅ All services show "Running" status
- [ ] ✅ Health endpoint returns 200 OK
- [ ] ✅ No ERROR logs in first 5 minutes
- [ ] ✅ Discord bot responds to test command
- [ ] ✅ Database migrations applied successfully (if any)

## Railway Dashboard

**Useful Sections**:

- **Deployments**: View build logs and deployment history
- **Metrics**: CPU, memory, bandwidth usage
- **Variables**: Manage environment variables (easier than CLI for viewing)
- **Logs**: Alternative to CLI for log viewing (with filtering)
- **Settings**: Service configuration, custom domains, sleep settings

**Dashboard URL**: https://railway.app/project/[project-id]

## Related Skills

- **tzurot-observability** - Log analysis and correlation IDs
- **tzurot-security** - Secret management and environment variables
- **tzurot-git-workflow** - Deployment triggers and branch strategy
- **tzurot-docs** - Update CURRENT_WORK.md after deployments

## References

- Railway CLI Reference: `docs/reference/RAILWAY_CLI_REFERENCE.md`
- Railway deployment guide: `docs/deployment/RAILWAY_DEPLOYMENT.md`
- Project README: `README.md#deployment`
- Railway official docs: https://docs.railway.app/

## Red Flags - When to Consult This Skill

- About to deploy to Railway
- Service is down or unhealthy
- Need to check production logs
- Environment variables need updating
- Database migration needed
- Performance issues in production
- Cost concerns or billing alerts
