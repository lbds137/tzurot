# Deployment Scripts

Helper scripts for deploying Tzurot v3 to Railway.

## Prerequisites

1. **Railway CLI installed:**
   ```bash
   npm install -g @railway/cli
   ```

2. **Logged into Railway:**
   ```bash
   railway login
   ```

3. **Environment file configured:**
   - Copy `.env.example` to `.env`
   - Fill in your actual API keys and tokens

## Scripts

### `deploy-railway-dev.sh`

Main deployment script that sets up all environment variables for the development environment on Railway.

**What it does:**
- Links to your Railway project
- Sets environment variables for all three services:
  - `api-gateway`: Port, logging
  - `ai-worker`: AI provider config, Gemini API key
  - `bot-client`: Discord token, Gateway URL
- Provides next steps for deployment

**Usage:**
```bash
cd /home/deck/WebstormProjects/tzurot/tzurot-v3
./scripts/deploy-railway-dev.sh
```

**First-time setup:**
1. Create Railway project (if you haven't already)
2. Add Redis service via Railway dashboard
3. Create three services: `api-gateway`, `ai-worker`, `bot-client`
4. Run this script
5. Deploy each service (see below)

### `update-gateway-url.sh`

Quick helper to update the bot-client's Gateway URL after API Gateway is deployed.

**Usage:**
```bash
./scripts/update-gateway-url.sh https://your-gateway.railway.app
```

## Full Deployment Flow

### 1. Initial Setup (One-time)

```bash
# Navigate to v3 directory
cd /home/deck/WebstormProjects/tzurot/tzurot-v3

# Ensure .env is configured with your keys
cat .env  # Verify it has your Discord token and Gemini API key

# Run deployment script
./scripts/deploy-railway-dev.sh
```

### 2. Deploy Services (In Order)

Railway will auto-deploy from your GitHub repo. Make sure code is pushed first:

```bash
# Ensure all code is committed and pushed
git status
git push origin feat/v3-architecture-rewrite
```

Then deploy in this order:

```bash
# 1. Deploy API Gateway (needs to be first)
railway up --service api-gateway

# Wait for it to deploy, then get the URL
railway status --service api-gateway

# 2. Update bot-client with the Gateway URL
./scripts/update-gateway-url.sh https://your-actual-gateway-url.railway.app

# 3. Deploy AI Worker
railway up --service ai-worker

# 4. Deploy Bot Client
railway up --service bot-client
```

### 3. Verify Deployment

```bash
# Check API Gateway health
curl https://your-gateway-url.railway.app/health

# View logs
railway logs --service api-gateway
railway logs --service ai-worker
railway logs --service bot-client

# Check Railway dashboard
railway open
```

## Environment Variables Reference

### Shared (All Services)
- `NODE_ENV`: development
- `LOG_LEVEL`: debug
- `REDIS_URL`: Auto-set by Railway when Redis service is added

### api-gateway
- `PORT`: 3000

### ai-worker
- `AI_PROVIDER`: gemini
- `GEMINI_API_KEY`: Your Google Gemini API key
- `DEFAULT_AI_MODEL`: gemini-2.5-pro
- `ENABLE_MEMORY`: false (for now)
- `ENABLE_STREAMING`: false (for now)

### bot-client
- `DISCORD_TOKEN`: Your Discord bot token
- `GATEWAY_URL`: URL of deployed api-gateway
- `PERSONALITIES_DIR`: /app/personalities

## Troubleshooting

**Problem:** Bot not responding to messages
- Check `GATEWAY_URL` is correct: `railway variables --service bot-client`
- Verify API Gateway is running: `railway logs --service api-gateway`
- Check Discord token is valid

**Problem:** AI responses failing
- Verify `GEMINI_API_KEY` is set: `railway variables --service ai-worker`
- Check ai-worker logs: `railway logs --service ai-worker`
- Test Gemini API key is valid

**Problem:** Services can't connect to Redis
- Ensure Redis service is added in Railway dashboard
- Verify `REDIS_URL` is set: `railway variables --service api-gateway`
- Redis URL should be auto-injected: `${{Redis.REDIS_URL}}`

**Problem:** "Service not found"
- Make sure services are named exactly: `api-gateway`, `ai-worker`, `bot-client`
- Check Railway dashboard to verify service names
- Link to correct project: `railway link`

## Updating Variables

To update a single variable:
```bash
railway variables set KEY=value --service service-name
```

To view all variables for a service:
```bash
railway variables --service service-name
```

To delete a variable:
```bash
railway variables --delete KEY --service service-name
```

## Production Deployment

For production, you'll want to:
1. Create a separate `.env.production` file
2. Use a different Railway environment
3. Set `NODE_ENV=production`
4. Set `LOG_LEVEL=info` (less verbose)
5. Use production Discord bot token
6. Consider adding vector database (Qdrant/Pinecone)

Production deployment script coming soon!
