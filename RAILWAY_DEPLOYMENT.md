# Railway Deployment Guide for Tzurot v3

## Overview

Tzurot v3 is a monorepo with 3 microservices that need to be deployed to Railway:

1. **bot-client** - Discord bot (Discord.js)
2. **api-gateway** - HTTP API (Express)
3. **ai-worker** - AI processing with vector memory (LangChain + Qdrant)

## Required Railway Services

### 1. PostgreSQL Database
Used for relational data (user credentials, personality configs, session data)

- **Service**: Add PostgreSQL from Railway marketplace
- **Name**: `postgres`
- **Environment Variable**: Automatically sets `DATABASE_URL`

### 2. Redis
Used for BullMQ job queue and caching

- **Service**: Add Redis from Railway marketplace
- **Name**: `redis`
- **Environment Variable**: Automatically sets `REDIS_URL`

### 3. Qdrant (Vector Database)
Used for long-term memory and RAG

**Option A: Qdrant Cloud** (Recommended - generous free tier)
- Sign up at https://qdrant.tech/
- Create a cluster (free tier: 1GB storage)
- Get cluster URL and API key
- Set `QDRANT_URL` and `QDRANT_API_KEY` environment variables

**Option B: Self-hosted on Railway**
```yaml
# Add a new service with custom Docker container
Docker Image: qdrant/qdrant:latest
Port: 6333
```

Set Railway internal URL for other services:
```
QDRANT_URL=http://qdrant.railway.internal:6333
```
(Note: No API key needed for internal Railway deployment)

## Environment Variables

### Global (all services need these)
```
NODE_ENV=production
PNPM_VERSION=8.15.1
```

### bot-client
```
DISCORD_TOKEN=your_discord_bot_token
API_GATEWAY_URL=http://api-gateway.railway.internal:3000
```

### api-gateway
```
PORT=3000
REDIS_URL=<set by Railway Redis addon>
AI_WORKER_URL=http://ai-worker.railway.internal:3001
```

### ai-worker
```
PORT=3001
REDIS_URL=<set by Railway Redis addon>
QDRANT_URL=<your Qdrant Cloud URL or http://qdrant.railway.internal:6333>
QDRANT_API_KEY=<your Qdrant API key if using cloud>

# AI Provider Keys (for personalities without BYOK)
OPENROUTER_API_KEY=your_openrouter_key
OPENAI_API_KEY=your_openai_key (for embeddings)
```

## Deployment Steps

### 1. Connect Repository
1. Go to Railway dashboard
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Choose your `tzurot` repository
5. Select the `tzurot-v3` directory as root (if prompted)

### 2. Add Database Services
1. Click "+ New Service" → "Database" → "Add PostgreSQL"
2. Click "+ New Service" → "Database" → "Add Redis"
3. For Qdrant: Either use Qdrant Cloud (recommended) or add "+ New Service" → "Docker" → Use `qdrant/qdrant:latest`

### 3. Deploy Application Services
Railway should auto-detect the 3 services from `railway.json`:
- bot-client
- api-gateway
- ai-worker

If not auto-detected:
1. Click "+ New Service" → "Empty Service"
2. Set root directory (e.g., `services/bot-client`)
3. Set build command: `cd ../.. && pnpm install --frozen-lockfile && pnpm --filter @tzurot/bot-client build`
4. Set start command: `pnpm start`

### 4. Configure Environment Variables
For each service, go to Variables tab and add the environment variables listed above.

**Important**: Use Railway's internal networking for service-to-service communication:
- `http://service-name.railway.internal:port`

### 5. Deploy!
1. Push your code to GitHub
2. Railway will automatically build and deploy all services
3. Check logs for each service to ensure they're running

## Verifying Deployment

### Check Service Health
Each service should log on startup:

**bot-client**:
```
[BotClient] Connected to Discord as YourBot#1234
[BotClient] API Gateway connection: OK
```

**api-gateway**:
```
[APIGateway] Server listening on port 3000
[APIGateway] Redis connection: OK
```

**ai-worker**:
```
[AIWorker] BullMQ worker started
[AIWorker] Qdrant connection: OK
[AIWorker] Vector store initialized
```

### Test End-to-End
1. Send a message to your Discord bot
2. Check logs:
   - bot-client receives message and sends to api-gateway
   - api-gateway creates job in Redis queue
   - ai-worker picks up job, queries Qdrant, generates response
   - Response flows back to Discord

## Troubleshooting

### "Cannot connect to Qdrant"
- For Qdrant Cloud: Verify `QDRANT_URL` and `QDRANT_API_KEY` are set correctly
- For self-hosted: Verify Qdrant service is running on Railway
- Use Railway internal URL: `http://qdrant.railway.internal:6333`

### "No API key available"
- Make sure `OPENROUTER_API_KEY` or `OPENAI_API_KEY` is set in ai-worker
- Or ensure user has provided their own API key (BYOK)

### "Module not found" errors
- Ensure build command includes `pnpm install --frozen-lockfile`
- Check that workspace dependencies are building correctly
- Try adding `pnpm run build` in root before service-specific build

### Services not communicating
- Use Railway's internal networking (`.railway.internal`)
- Don't use public URLs for service-to-service calls
- Check PORT environment variable matches what service listens on

## Scaling Considerations

### For Production
1. **Increase replicas** for bot-client (horizontal scaling)
2. **Upgrade database** tiers as usage grows
3. **Use Qdrant Cloud** for production-grade vector search performance
4. **Add monitoring** (Railway integrates with Sentry, LogDNA, etc.)

### Cost Optimization
- Use BYOK for all users to avoid paying for their AI usage
- Monitor Qdrant storage usage (free tier: 1GB)
- Use Redis for aggressive caching to reduce vector DB queries

## Monitoring

Railway provides built-in metrics:
- CPU/Memory usage per service
- Request counts
- Error rates
- Deployment history

Add these to your services for better observability:
```typescript
// Health check endpoint
app.get('/health', async (req, res) => {
  const chromaOk = await memoryManager.healthCheck();
  const redisOk = await redisClient.ping();

  res.json({
    status: chromaOk && redisOk ? 'healthy' : 'degraded',
    chroma: chromaOk,
    redis: redisOk
  });
});
```

## Rollback

If a deployment breaks:
1. Go to Deployments tab in Railway
2. Click on last working deployment
3. Click "Redeploy"

Or revert the git commit and push.
