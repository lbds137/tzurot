# Tzurot v3 Deployment Guide

## Railway Deployment Setup

This guide covers deploying tzurot v3's microservices architecture to Railway.

### Architecture Overview

Tzurot v3 consists of three services:
- **bot-client**: Discord.js client (connects to Discord Gateway)
- **api-gateway**: HTTP API + BullMQ job queue
- **ai-worker**: AI processing worker (processes queued jobs)

Plus required infrastructure:
- **Redis**: For BullMQ job queue
- **PostgreSQL**: For persistent data (future: user credentials, config)
- **Qdrant/Pinecone**: Vector database for long-term memory (future)

### Step 1: Create Railway Project

1. Go to [Railway](https://railway.app)
2. Create new project: "tzurot-v3"
3. Connect your GitHub repository

### Step 2: Add Infrastructure Services

#### Redis (Required)
1. Click "New" → "Database" → "Add Redis"
2. Railway will automatically set `REDIS_URL` environment variable
3. All services will use this shared Redis instance

#### PostgreSQL (Future)
1. Click "New" → "Database" → "Add PostgreSQL"
2. Will be used for user credentials, server config, etc.

### Step 3: Deploy Application Services

Railway will auto-detect the monorepo structure. You need to create 3 separate services:

#### Service 1: bot-client

1. Click "New" → "GitHub Repo" → Select your repo
2. Configure service:
   - **Name**: `bot-client`
   - **Root Directory**: `tzurot-v3/services/bot-client`
   - **Build Command**: `pnpm install && pnpm build`
   - **Start Command**: `pnpm start`

**Environment Variables:**
```bash
# Required
DISCORD_TOKEN=your_discord_bot_token
GATEWAY_URL=https://your-api-gateway.railway.app
PERSONALITIES_DIR=/app/personalities

# Optional
NODE_ENV=production
LOG_LEVEL=info
```

#### Service 2: api-gateway

1. Click "New" → "GitHub Repo" → Select your repo
2. Configure service:
   - **Name**: `api-gateway`
   - **Root Directory**: `tzurot-v3/services/api-gateway`
   - **Build Command**: `pnpm install && pnpm build`
   - **Start Command**: `pnpm start`
   - **Port**: 3000 (enable public networking)

**Environment Variables:**
```bash
# Required (auto-set by Railway)
REDIS_URL=${{Redis.REDIS_URL}}

# Required
PORT=3000

# Optional
NODE_ENV=production
LOG_LEVEL=info
```

**Important**: Make note of the public URL Railway assigns (e.g., `https://api-gateway-production.up.railway.app`). Use this for `GATEWAY_URL` in bot-client.

#### Service 3: ai-worker

1. Click "New" → "GitHub Repo" → Select your repo
2. Configure service:
   - **Name**: `ai-worker`
   - **Root Directory**: `tzurot-v3/services/ai-worker`
   - **Build Command**: `pnpm install && pnpm build`
   - **Start Command**: `pnpm start`

**Environment Variables:**
```bash
# Required (auto-set by Railway)
REDIS_URL=${{Redis.REDIS_URL}}

# Required - AI Provider
OPENROUTER_API_KEY=your_openrouter_key
ANTHROPIC_API_KEY=your_anthropic_key  # Alternative

# Optional - Vector DB (future)
QDRANT_URL=your_qdrant_url
QDRANT_API_KEY=your_qdrant_key

# Optional
NODE_ENV=production
LOG_LEVEL=info
```

### Step 4: Configure Personalities

Currently personalities are loaded from JSON files. You have two options:

#### Option A: Use Railway Volumes (Persistent)
1. In `ai-worker` service, add a volume:
   - Mount path: `/app/personalities`
   - Upload your personality JSON files to this volume

#### Option B: Commit to Repo (Simpler for now)
1. Create `personalities/` directory in `tzurot-v3/`
2. Add personality JSON files
3. Update `PERSONALITIES_DIR` to point to this location
4. Commit and push

**Example personality file** (`personalities/lilith.json`):
```json
{
  "name": "lilith",
  "displayName": "Lilith",
  "avatarUrl": "https://example.com/lilith-avatar.png",
  "systemPrompt": "You are Lilith, a wise and ancient figure...",
  "model": "anthropic/claude-3.5-sonnet",
  "temperature": 0.8,
  "maxTokens": 1000
}
```

### Step 5: Environment Variable Reference

#### bot-client
| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_TOKEN` | Yes | Discord bot token from developer portal |
| `GATEWAY_URL` | Yes | URL of api-gateway service |
| `PERSONALITIES_DIR` | No | Path to personalities folder (default: `../../../personalities`) |

#### api-gateway
| Variable | Required | Description |
|----------|----------|-------------|
| `REDIS_URL` | Yes | Redis connection string (auto-set) |
| `PORT` | Yes | HTTP port (default: 3000) |

#### ai-worker
| Variable | Required | Description |
|----------|----------|-------------|
| `REDIS_URL` | Yes | Redis connection string (auto-set) |
| `OPENROUTER_API_KEY` | Yes | OpenRouter API key |
| `QDRANT_URL` | No | Qdrant vector DB URL (future) |
| `QDRANT_API_KEY` | No | Qdrant API key (future) |

### Step 6: Deploy Order

Deploy in this order to avoid startup failures:

1. **Redis** (infrastructure)
2. **api-gateway** (wait for healthy)
3. **ai-worker** (wait for healthy)
4. **bot-client** (last, depends on api-gateway)

### Step 7: Verify Deployment

#### Check Service Health

**bot-client:**
```bash
# Should show: "Logged in as YourBot#1234"
railway logs --service bot-client
```

**api-gateway:**
```bash
# Should show: "API Gateway listening on port 3000"
railway logs --service api-gateway

# Test health endpoint
curl https://your-gateway.railway.app/health
```

**ai-worker:**
```bash
# Should show: "AI Worker listening for jobs on queue: ai-requests"
railway logs --service ai-worker
```

#### Test End-to-End

1. Go to your Discord server
2. Type: `@YourBot hello` or `@lilith tell me about yourself`
3. Bot should respond via webhook with personality name and avatar

### Troubleshooting

#### Bot not responding
- Check `DISCORD_TOKEN` is set correctly
- Verify bot has proper Discord permissions (Send Messages, Manage Webhooks)
- Check `GATEWAY_URL` points to api-gateway's public URL
- Look at bot-client logs for connection errors

#### "Gateway health check failed"
- Ensure api-gateway is deployed and healthy
- Check `GATEWAY_URL` environment variable
- Verify api-gateway's `/health` endpoint is accessible

#### AI responses failing
- Check ai-worker logs for errors
- Verify `OPENROUTER_API_KEY` is set
- Ensure Redis connection is working (both api-gateway and ai-worker)
- Check BullMQ queue status

#### No personalities loaded
- Verify `PERSONALITIES_DIR` points to correct location
- Check personality JSON files are valid
- Look for "Loaded N personalities" in ai-worker logs

### Monitoring

Railway provides built-in monitoring:
- **Metrics**: CPU, Memory, Network usage per service
- **Logs**: Real-time logs with filtering
- **Deployments**: Deployment history and rollback

### Cost Optimization

**Current setup (free tier friendly):**
- Redis: Shared, minimal usage
- 3 services: Each uses minimal resources during idle
- Bot scales with usage

**Future optimizations:**
- Use Railway's autoscaling for ai-worker during high load
- Implement job priority queues (high/low priority)
- Cache personality configs in Redis to reduce file reads

### Next Steps

Once basic deployment works:
1. Add PostgreSQL for user credentials (BYOK)
2. Set up vector database (Qdrant on Railway or Pinecone)
3. Implement slash commands
4. Add conversation history and auto-response
5. Enable "free will" agent system

---

## Local Development

For local testing before deployment:

```bash
# Start infrastructure
docker-compose up -d

# In separate terminals:
cd services/api-gateway && pnpm dev
cd services/ai-worker && pnpm dev
cd services/bot-client && pnpm dev
```

Make sure `.env` files are configured in each service directory.

---

## Rollback Procedure

If deployment fails:

1. Railway Dashboard → Select service → "Deployments" tab
2. Find last working deployment
3. Click "Redeploy"

Or via CLI:
```bash
railway rollback --service bot-client
```

---

## Support

- Railway Docs: https://docs.railway.app
- Discord.js Guide: https://discordjs.guide
- LangChain Docs: https://js.langchain.com/docs
- Tzurot v3 Architecture: See `ARCHITECTURE_DECISIONS.md`
