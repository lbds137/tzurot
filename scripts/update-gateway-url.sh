#!/bin/bash
set -e

# Quick script to update bot-client's GATEWAY_URL after API Gateway is deployed

echo "🔄 Updating bot-client GATEWAY_URL..."
echo ""

if [ -z "$1" ]; then
    echo "Usage: ./scripts/update-gateway-url.sh <gateway-url>"
    echo ""
    echo "Example:"
    echo "  ./scripts/update-gateway-url.sh https://api-gateway-production.up.railway.app"
    echo ""
    echo "Or get it from Railway:"
    echo "  railway status --service api-gateway"
    exit 1
fi

GATEWAY_URL="$1"

echo "Setting GATEWAY_URL to: ${GATEWAY_URL}"
railway variables set GATEWAY_URL="${GATEWAY_URL}" --service bot-client

echo ""
echo "✅ Updated! Bot client will use this URL on next restart."
echo ""
echo "To restart the bot-client service:"
echo "  railway restart --service bot-client"
