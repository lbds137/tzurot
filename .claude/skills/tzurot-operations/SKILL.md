---
name: tzurot-operations
description: Common development operations for Tzurot v3 - Adding personalities, checking health, debugging production. Use when performing routine operations or troubleshooting issues.
lastUpdated: '2025-12-08'
---

# Common Operations - Tzurot v3

**Use this skill when:** Adding a personality, checking service health, debugging production issues, or performing other routine development operations.

## Adding a New Personality

1. Create `personalities/name.json`:

   ```json
   {
     "name": "PersonalityName",
     "systemPrompt": "Your personality description...",
     "model": "anthropic/claude-sonnet-4.5",
     "temperature": 0.8,
     "avatar": "https://example.com/avatar.png"
   }
   ```

2. Commit and push (Railway auto-deploys)
3. Bot auto-loads new personality on restart

### Personality Configuration Fields

| Field          | Required | Description                                       |
| -------------- | -------- | ------------------------------------------------- |
| `name`         | Yes      | Display name for the personality                  |
| `systemPrompt` | Yes      | Instructions defining personality behavior        |
| `model`        | Yes      | AI model identifier (OpenRouter format)           |
| `temperature`  | No       | Response randomness (0.0-2.0, default 0.7)        |
| `avatar`       | No       | URL to avatar image (used in webhooks)            |
| `maxTokens`    | No       | Maximum response length (default varies by model) |

### Model Format Examples

```json
// OpenRouter models
"model": "anthropic/claude-sonnet-4.5"
"model": "openai/gpt-4-turbo"
"model": "google/gemini-2.0-flash-exp"
"model": "meta-llama/llama-3.1-70b-instruct"

// Guest mode (free models)
"model": "google/gemini-2.0-flash-exp:free"
```

## Checking Service Health

### API Gateway Health Endpoint

```bash
# Quick health check
curl https://api-gateway-development-83e8.up.railway.app/health

# Expected response:
# {
#   "status": "healthy",
#   "timestamp": "2025-12-08T14:30:00.000Z",
#   "services": {
#     "database": "connected",
#     "redis": "connected"
#   }
# }
```

### Checking Logs

```bash
# API Gateway logs
railway logs --service api-gateway --tail 50

# AI Worker logs
railway logs --service ai-worker --tail 50

# Bot Client logs
railway logs --service bot-client --tail 50
```

### Service Status

```bash
# Check all services
railway status

# Check specific service
railway status --service api-gateway
```

## Debugging Production Issues

### Step-by-Step Debugging Process

1. **Check service logs first**:

   ```bash
   railway logs --service <name>
   ```

2. **Verify environment variables**:

   ```bash
   railway variables --service <name>
   ```

3. **Check health endpoint** (api-gateway only):

   ```bash
   curl https://api-gateway-development-83e8.up.railway.app/health
   ```

4. **Look for error patterns in logs**:

   ```bash
   railway logs --service api-gateway | grep "ERROR"
   railway logs --service ai-worker | grep "error"
   ```

5. **Check Railway dashboard** for service status and metrics

### Common Issues & Solutions

| Symptom                 | Likely Cause          | Solution                                     |
| ----------------------- | --------------------- | -------------------------------------------- |
| Bot not responding      | bot-client crashed    | Check logs, verify DISCORD_TOKEN             |
| Slow responses          | AI worker overloaded  | Check ai-worker logs, verify OPENROUTER_KEY  |
| 500 errors from gateway | Database connection   | Verify DATABASE_URL, check Prisma migrations |
| Jobs stuck in queue     | Redis connection      | Verify REDIS_URL, check ai-worker status     |
| Webhooks failing        | Invalid webhook URL   | Check bot-client logs for webhook errors     |
| Memory not retrieved    | pgvector query issues | Check ai-worker logs for embedding errors    |

### Tracing Requests Across Services

Use correlation IDs to follow a request through all services:

```bash
# Find the request ID in bot-client logs
railway logs --service bot-client | grep "requestId"

# Trace it through api-gateway
railway logs --service api-gateway | grep "requestId:abc123"

# And through ai-worker
railway logs --service ai-worker | grep "requestId:abc123"
```

## Database Operations

### Quick Database Commands

```bash
# Check migration status
railway run npx prisma migrate status

# Apply pending migrations
railway run npx prisma migrate deploy

# Generate Prisma client after schema changes
railway run npx prisma generate

# Open Prisma Studio (local, connects to Railway DB)
npx prisma studio

# Direct database access
railway run psql
```

### Common Database Tasks

**Checking a user's data:**

```sql
-- Connect first: railway run psql

-- Find user by Discord ID
SELECT * FROM "User" WHERE "discordId" = '123456789';

-- Check user's wallet credentials
SELECT u.id, u."discordId", wc.provider, wc."isValid"
FROM "User" u
JOIN "WalletCredential" wc ON u.id = wc."userId"
WHERE u."discordId" = '123456789';
```

**Checking conversation history:**

```sql
-- Recent conversations for a user
SELECT ch.id, ch."personalityId", ch."createdAt"
FROM "ConversationHistory" ch
JOIN "User" u ON ch."userId" = u.id
WHERE u."discordId" = '123456789'
ORDER BY ch."createdAt" DESC
LIMIT 10;
```

## Redis Operations

### Checking Queue Status

```bash
# Connect to Redis
railway run redis-cli

# Check queue lengths
LLEN bull:ai-generation:wait
LLEN bull:ai-generation:active
LLEN bull:ai-generation:completed
LLEN bull:ai-generation:failed

# Check for stuck jobs
ZRANGE bull:ai-generation:delayed 0 -1 WITHSCORES
```

### Cache Invalidation

```bash
# Clear personality cache (force reload from DB)
redis-cli DEL "personality:lilith"

# Clear all personality caches
redis-cli KEYS "personality:*" | xargs redis-cli DEL
```

## Discord Operations

### Checking Bot Status in Discord

1. Bot should show as "Online" (green dot)
2. Slash commands should appear in autocomplete
3. @mentions should trigger responses

### Refreshing Slash Commands

If commands are outdated or missing:

1. Redeploy bot-client (commands register on startup)
2. Check bot-client logs for "Registered X commands"
3. Discord caches commands for ~1 hour for global commands

### Webhook Issues

If messages appear from the wrong personality:

1. Check webhook cache in bot-client logs
2. Webhooks are created per-channel per-personality
3. If corrupted, delete webhook from Discord channel settings

## Performance Monitoring

### Key Metrics to Watch

1. **Response time**: Target <10s for normal messages
2. **Queue depth**: Should stay near 0 during normal operation
3. **Memory usage**: Watch for gradual increases (leaks)
4. **Error rate**: Should be <1%

### Admin Commands for Monitoring

```bash
# In Discord (bot owner only)
/admin usage           # View usage statistics
/admin servers         # List all servers bot is in
```

## Related Skills

- **tzurot-deployment** - Railway deployment operations, rollbacks
- **tzurot-observability** - Structured logging patterns, correlation IDs
- **tzurot-db-vector** - Database migrations, pgvector operations
- **tzurot-security** - Secret management, environment variables

## References

- Railway CLI Reference: `docs/reference/RAILWAY_CLI_REFERENCE.md`
- Deployment guide: `docs/deployment/RAILWAY_DEPLOYMENT.md`
- Troubleshooting: `docs/deployment/RAILWAY_DEPLOYMENT.md#troubleshooting`
