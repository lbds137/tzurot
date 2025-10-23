#!/bin/bash
# Cleanup Legacy Variables from Railway
# Removes v2 (shapes.inc) and deprecated v3 variables

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Script modes
DRY_RUN=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --help|-h)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Removes legacy and deprecated variables from Railway"
      echo ""
      echo "Options:"
      echo "  --dry-run     Show what would be removed without actually removing"
      echo "  --help, -h    Show this help message"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║       Railway Legacy Variables Cleanup - Tzurot v3        ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

if [ "$DRY_RUN" = true ]; then
  echo -e "${YELLOW}[DRY RUN MODE] No changes will be made${NC}"
  echo ""
fi

# Check Railway CLI
if ! command -v railway &> /dev/null; then
  echo -e "${RED}❌ Railway CLI not installed${NC}"
  exit 1
fi

# Variables to remove per service
declare -A VARS_TO_REMOVE

# ai-worker: Remove deprecated feature flags and redundant config
VARS_TO_REMOVE[ai-worker]="ENABLE_MEMORY ENABLE_STREAMING OPENROUTER_BASE_URL REDIS_HOST REDIS_PASSWORD REDIS_PORT"

# bot-client: Remove ALL shapes.inc and v2 legacy variables
# Note: Keeping PORT (needed for avatar image serving)
# Note: Keeping GITHUB_WEBHOOK_SECRET (for version notification system - to be ported)
VARS_TO_REMOVE[bot-client]="SERVICE_API_BASE_URL SERVICE_API_KEY SERVICE_APP_ID SERVICE_ID SERVICE_WEBSITE BOT_PREFIX BOT_PUBLIC_BASE_URL FEATURE_FLAG_FEATURES_ENHANCED_CONTEXT PERSONALITIES_DIR PERSONALITY_JARGON_TERM REDIS_HOST REDIS_PASSWORD REDIS_PORT DATABASE_URL"

# api-gateway: Remove redundant Redis config (uses REDIS_URL)
VARS_TO_REMOVE[api-gateway]="REDIS_HOST REDIS_PASSWORD REDIS_PORT"

echo -e "${YELLOW}Variables to remove:${NC}"
echo ""

for service in "${!VARS_TO_REMOVE[@]}"; do
  echo -e "${BLUE}$service:${NC}"
  for var in ${VARS_TO_REMOVE[$service]}; do
    echo "  - $var"
  done
  echo ""
done

if [ "$DRY_RUN" = false ]; then
  read -p "Continue with removal? (yes/no): " confirm
  if [ "$confirm" != "yes" ]; then
    echo "Aborted."
    exit 0
  fi
  echo ""
fi

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Removing Variables${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

for service in "${!VARS_TO_REMOVE[@]}"; do
  echo -e "${YELLOW}Cleaning $service...${NC}"

  for var in ${VARS_TO_REMOVE[$service]}; do
    if [ "$DRY_RUN" = true ]; then
      echo -e "  ${BLUE}[DRY RUN]${NC} Would remove: ${GREEN}$var${NC}"
    else
      echo -e "  Removing: ${GREEN}$var${NC}"
      railway variables --service "$service" --remove "$var" 2>/dev/null || echo -e "  ${YELLOW}  (already removed or doesn't exist)${NC}"
    fi
  done

  echo ""
done

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
if [ "$DRY_RUN" = true ]; then
  echo -e "${GREEN}✓ Dry run complete${NC}"
  echo ""
  echo "Run without --dry-run to actually remove these variables."
else
  echo -e "${GREEN}✓ Cleanup complete${NC}"
  echo ""
  echo "Removed legacy variables. Services will redeploy with updated config."
fi
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
