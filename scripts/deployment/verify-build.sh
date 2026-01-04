#!/bin/bash
# Verify all TypeScript builds succeed before pushing

set -e

echo "🔨 Building all packages and services..."
echo ""

# Clear stale tsbuildinfo files to ensure fresh builds
# Without this, tsc incremental builds may skip output if only tsbuildinfo exists but dist was deleted
echo "🧹 Clearing stale build artifacts..."
find packages services -name "tsconfig.tsbuildinfo" -type f -delete 2>/dev/null || true

echo "📦 Building common-types..."
pnpm --filter @tzurot/common-types build

echo "🚀 Building api-gateway..."
pnpm --filter api-gateway build

echo "🤖 Building ai-worker..."
pnpm --filter ai-worker build

echo "🎮 Building bot-client..."
pnpm --filter bot-client build

echo ""
echo "✅ All builds succeeded!"
