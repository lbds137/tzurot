#!/bin/bash
# Verify all TypeScript builds succeed before pushing

set -e

echo "🔨 Building all packages and services..."
echo ""

echo "📦 Building common-types..."
pnpm --filter @tzurot/common-types build

echo "📦 Building api-clients..."
pnpm --filter @tzurot/api-clients build

echo "🚀 Building api-gateway..."
pnpm --filter api-gateway build

echo "🤖 Building ai-worker..."
pnpm --filter ai-worker build

echo "🎮 Building bot-client..."
pnpm --filter bot-client build

echo ""
echo "✅ All builds succeeded!"
