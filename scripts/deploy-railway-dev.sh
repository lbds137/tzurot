#!/bin/bash
set -e

# Tzurot v3 Railway Development Deployment Script
# This script sets up environment variables for all three services on Railway

echo "🚂 Tzurot v3 Railway Development Deployment"
echo "==========================================="
echo ""

# Check if Railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI not found. Install it with: npm i -g @railway/cli"
    exit 1
fi

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "❌ .env file not found. Please create one from .env.example"
    exit 1
fi

# Load .env file
echo "📋 Loading environment variables from .env..."
export $(cat .env | grep -v '^#' | grep -v '^$' | xargs)

echo ""
echo "🔗 Linking to Railway project..."
echo "   (If not already linked, you'll be prompted to select a project)"
railway link || true

echo ""
echo "📦 Setting up services..."
echo ""

# ============================================
# Shared Infrastructure
# ============================================
echo "🔴 Setting up Redis..."
echo "   (Make sure you've added Redis service in Railway dashboard first!)"
echo "   Redis URL will be auto-set by Railway as \${{Redis.REDIS_URL}}"

# ============================================
# API Gateway Service
# ============================================
echo ""
echo "🌐 Setting up API Gateway service..."
railway variables \
  --set "NODE_ENV=development" \
  --set "LOG_LEVEL=debug" \
  --set "PORT=3000" \
  --set "REDIS_HOST=\${{Redis.REDISHOST}}" \
  --set "REDIS_PORT=\${{Redis.REDISPORT}}" \
  --set "REDIS_PASSWORD=\${{Redis.REDISPASSWORD}}" \
  --set "RAILWAY_DOCKERFILE_PATH=services/api-gateway/Dockerfile" \
  --service api-gateway

echo "   ✓ API Gateway variables set"

# ============================================
# AI Worker Service
# ============================================
echo ""
echo "🤖 Setting up AI Worker service..."
railway variables \
  --set "NODE_ENV=development" \
  --set "LOG_LEVEL=debug" \
  --set "AI_PROVIDER=${AI_PROVIDER}" \
  --set "GEMINI_API_KEY=${GEMINI_API_KEY}" \
  --set "DEFAULT_AI_MODEL=${DEFAULT_AI_MODEL}" \
  --set "QDRANT_URL=${QDRANT_URL}" \
  --set "QDRANT_API_KEY=${QDRANT_API_KEY}" \
  --set "OPENAI_API_KEY=${OPENAI_API_KEY}" \
  --set "DATABASE_URL=\${{Postgres.DATABASE_URL}}" \
  --set "REDIS_HOST=\${{Redis.REDISHOST}}" \
  --set "REDIS_PORT=\${{Redis.REDISPORT}}" \
  --set "REDIS_PASSWORD=\${{Redis.REDISPASSWORD}}" \
  --set "RAILWAY_DOCKERFILE_PATH=services/ai-worker/Dockerfile" \
  --service ai-worker

echo "   ✓ AI Worker variables set"

# ============================================
# Bot Client Service
# ============================================
echo ""
echo "🤖 Setting up Bot Client service..."
echo "   Using Railway service reference for API Gateway URL"
echo "   (Railway will automatically set this to the api-gateway public URL)"

railway variables \
  --set "NODE_ENV=development" \
  --set "LOG_LEVEL=debug" \
  --set "DISCORD_TOKEN=${DISCORD_TOKEN}" \
  --set "GATEWAY_URL=https://\${{api-gateway.RAILWAY_PUBLIC_DOMAIN}}" \
  --set "DATABASE_URL=\${{Postgres.DATABASE_URL}}" \
  --set "RAILWAY_DOCKERFILE_PATH=services/bot-client/Dockerfile" \
  --service bot-client

echo "   ✓ Bot Client variables set"

# ============================================
# Summary
# ============================================
echo ""
echo "✅ Railway environment variables configured!"
echo ""
echo "📝 Next steps:"
echo "   1. Verify services in Railway dashboard: https://railway.app"
echo "   2. Ensure Redis service is added and linked"
echo "   3. Deploy services:"
echo "      railway up --service api-gateway"
echo "      railway up --service ai-worker"
echo "      railway up --service bot-client"
echo "   4. After API Gateway deploys, update bot-client GATEWAY_URL:"
echo "      railway variables set GATEWAY_URL=https://your-actual-url.railway.app --service bot-client"
echo ""
echo "🔍 View logs:"
echo "   railway logs --service api-gateway"
echo "   railway logs --service ai-worker"
echo "   railway logs --service bot-client"
echo ""
