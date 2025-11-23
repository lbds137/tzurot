#!/bin/bash
# Railway Shared Variables Setup Script
# Sets up shared and service-specific environment variables for Tzurot v3

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script modes
DRY_RUN=false
INTERACTIVE=true

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --yes|-y)
      INTERACTIVE=false
      shift
      ;;
    --help|-h)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --dry-run     Show what would be set without actually setting variables"
      echo "  --yes, -y     Skip confirmation prompts"
      echo "  --help, -h    Show this help message"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Run '$0 --help' for usage information"
      exit 1
      ;;
  esac
done

# Header
echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║       Railway Shared Variables Setup - Tzurot v3          ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

if [ "$DRY_RUN" = true ]; then
  echo -e "${YELLOW}[DRY RUN MODE] No changes will be made${NC}"
  echo ""
fi

# Check if Railway CLI is installed
if ! command -v railway &> /dev/null; then
  echo -e "${RED}❌ Railway CLI is not installed${NC}"
  echo "Install it with: npm install -g @railway/cli"
  exit 1
fi

echo -e "${GREEN}✓${NC} Railway CLI found"

# Check if linked to a project
if ! railway status &> /dev/null; then
  echo -e "${RED}❌ Not linked to a Railway project${NC}"
  echo "Run: railway link"
  exit 1
fi

# Get project info
PROJECT_INFO=$(railway status)
echo -e "${GREEN}✓${NC} Linked to Railway project"
echo "$PROJECT_INFO"
echo ""

# Function to set a variable (with dry-run support)
set_variable() {
  local scope=$1
  local service=$2
  local key=$3
  local value=$4
  local description=$5

  if [ "$DRY_RUN" = true ]; then
    if [ "$scope" = "shared" ]; then
      echo -e "${BLUE}[DRY RUN]${NC} Would set shared variable: ${GREEN}$key${NC}"
    else
      echo -e "${BLUE}[DRY RUN]${NC} Would set $service variable: ${GREEN}$key${NC}"
    fi
    [ -n "$description" ] && echo "          Description: $description"
  else
    if [ "$scope" = "shared" ]; then
      echo -e "Setting shared variable: ${GREEN}$key${NC}"
      railway variables --set "$key=$value"
    else
      echo -e "Setting $service variable: ${GREEN}$key${NC}"
      railway variables --service "$service" --set "$key=$value"
    fi
    [ -n "$description" ] && echo "          Description: $description"
  fi
}

# Function to get current value or prompt for new one
get_or_prompt() {
  local var_name=$1
  local description=$2
  local is_secret=$3
  local current_value

  # Try to get current value from local .env
  if [ -f .env ]; then
    current_value=$(grep "^$var_name=" .env 2>/dev/null | cut -d'=' -f2- | tr -d '"' || echo "")
  fi

  if [ -n "$current_value" ]; then
    if [ "$is_secret" = "true" ]; then
      echo -e "${GREEN}✓${NC} Found $var_name in .env (***hidden***)" >&2
    else
      echo -e "${GREEN}✓${NC} Found $var_name in .env: $current_value" >&2
    fi
    echo "$current_value"
  else
    if [ "$INTERACTIVE" = true ]; then
      echo -e "${YELLOW}⚠${NC}  $var_name not found in .env" >&2
      echo "   Description: $description" >&2
      read -p "   Enter value (or press Enter to skip): " input_value
      echo "$input_value"
    else
      echo ""
    fi
  fi
}

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Step 1: Gathering Variable Values${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Shared Infrastructure Variables
echo -e "${YELLOW}Shared Infrastructure Variables${NC}"
echo -e "${BLUE}ℹ${NC}  Note: DATABASE_URL is usually provided automatically by Railway's Postgres addon"
echo "   If you're using Railway Postgres, you can skip this (press Enter)"
echo "   Railway will automatically inject DATABASE_PRIVATE_URL for services"
echo "   Note: PostgreSQL includes pgvector extension for vector memory"
DATABASE_URL=$(get_or_prompt "DATABASE_URL" "PostgreSQL connection string (or leave empty to use Railway's)" "true")
echo ""

# Shared AI Configuration
echo -e "${YELLOW}Shared AI Configuration${NC}"
AI_PROVIDER=$(get_or_prompt "AI_PROVIDER" "AI provider (gemini, openrouter, etc.)" "false")
GEMINI_API_KEY=$(get_or_prompt "GEMINI_API_KEY" "Gemini API key" "true")
OPENROUTER_API_KEY=$(get_or_prompt "OPENROUTER_API_KEY" "OpenRouter API key (if using OpenRouter)" "true")
OPENAI_API_KEY=$(get_or_prompt "OPENAI_API_KEY" "OpenAI API key (for embeddings)" "true")
DEFAULT_AI_MODEL=$(get_or_prompt "DEFAULT_AI_MODEL" "Default AI model to use" "false")
WHISPER_MODEL=$(get_or_prompt "WHISPER_MODEL" "Whisper model for audio transcription" "false")
VISION_FALLBACK_MODEL=$(get_or_prompt "VISION_FALLBACK_MODEL" "Vision model for image analysis" "false")
EMBEDDING_MODEL=$(get_or_prompt "EMBEDDING_MODEL" "Embedding model for pgvector" "false")
echo ""

# Shared Application Settings
echo -e "${YELLOW}Shared Application Settings${NC}"
NODE_ENV=$(get_or_prompt "NODE_ENV" "Node environment (production, development)" "false")
LOG_LEVEL=$(get_or_prompt "LOG_LEVEL" "Logging level (info, debug, etc.)" "false")
echo ""

# Bot-Client Specific
echo -e "${YELLOW}Bot-Client Specific Variables${NC}"
DISCORD_TOKEN=$(get_or_prompt "DISCORD_TOKEN" "Discord bot token" "true")
DISCORD_CLIENT_ID=$(get_or_prompt "DISCORD_CLIENT_ID" "Discord client ID" "false")
echo ""

# API Gateway Specific
echo -e "${YELLOW}API Gateway Specific Variables${NC}"
API_GATEWAY_PORT=$(get_or_prompt "API_GATEWAY_PORT" "API Gateway port (3000)" "false")
echo ""

# AI Worker Specific
echo -e "${YELLOW}AI Worker Specific Variables${NC}"
WORKER_CONCURRENCY=$(get_or_prompt "WORKER_CONCURRENCY" "Worker concurrency (5)" "false")
AI_WORKER_PORT=$(get_or_prompt "PORT" "AI Worker port (3001)" "false")
echo ""

# Apply defaults
NODE_ENV=${NODE_ENV:-"production"}
LOG_LEVEL=${LOG_LEVEL:-"info"}
AI_PROVIDER=${AI_PROVIDER:-"gemini"}
DEFAULT_AI_MODEL=${DEFAULT_AI_MODEL:-"anthropic/claude-haiku-4.5"}
WHISPER_MODEL=${WHISPER_MODEL:-"whisper-1"}
VISION_FALLBACK_MODEL=${VISION_FALLBACK_MODEL:-"qwen/qwen3-vl-235b-a22b-instruct"}
EMBEDDING_MODEL=${EMBEDDING_MODEL:-"text-embedding-3-small"}
API_GATEWAY_PORT=${API_GATEWAY_PORT:-"3000"}
WORKER_CONCURRENCY=${WORKER_CONCURRENCY:-"5"}
AI_WORKER_PORT=${AI_WORKER_PORT:-"3001"}

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Step 2: Review Configuration${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

echo -e "${YELLOW}Shared Variables (apply to all services):${NC}"
echo "  DATABASE_URL: $([ -n "$DATABASE_URL" ] && echo '***set***' || echo 'NOT SET (Railway will provide with pgvector)')"
echo "  AI_PROVIDER: ${AI_PROVIDER}"
echo "  GEMINI_API_KEY: $([ -n "$GEMINI_API_KEY" ] && echo '***set***' || echo 'NOT SET')"
echo "  OPENROUTER_API_KEY: $([ -n "$OPENROUTER_API_KEY" ] && echo '***set***' || echo 'NOT SET')"
echo "  OPENAI_API_KEY: $([ -n "$OPENAI_API_KEY" ] && echo '***set***' || echo 'NOT SET')"
echo "  DEFAULT_AI_MODEL: ${DEFAULT_AI_MODEL}"
echo "  WHISPER_MODEL: ${WHISPER_MODEL}"
echo "  VISION_FALLBACK_MODEL: ${VISION_FALLBACK_MODEL}"
echo "  EMBEDDING_MODEL: ${EMBEDDING_MODEL}"
echo "  NODE_ENV: ${NODE_ENV}"
echo "  LOG_LEVEL: ${LOG_LEVEL}"
echo ""

echo -e "${YELLOW}bot-client specific:${NC}"
echo "  DISCORD_TOKEN: $([ -n "$DISCORD_TOKEN" ] && echo '***set***' || echo 'NOT SET')"
echo "  DISCORD_CLIENT_ID: ${DISCORD_CLIENT_ID:-NOT SET}"
echo ""

echo -e "${YELLOW}api-gateway specific:${NC}"
echo "  API_GATEWAY_PORT: ${API_GATEWAY_PORT}"
echo ""

echo -e "${YELLOW}ai-worker specific:${NC}"
echo "  WORKER_CONCURRENCY: ${WORKER_CONCURRENCY}"
echo "  PORT: ${AI_WORKER_PORT}"
echo ""

# Validate required variables
MISSING_VARS=()
# DATABASE_URL is optional - Railway Postgres addon provides it automatically
[ -z "$DISCORD_TOKEN" ] && MISSING_VARS+=("DISCORD_TOKEN")

# At least one AI provider API key is required
if [ -z "$GEMINI_API_KEY" ] && [ -z "$OPENROUTER_API_KEY" ]; then
  MISSING_VARS+=("GEMINI_API_KEY or OPENROUTER_API_KEY")
fi

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
  echo -e "${RED}❌ Missing required variables:${NC}"
  for var in "${MISSING_VARS[@]}"; do
    echo "   - $var"
  done
  echo ""
  echo "Please set these in your .env file or provide them when prompted."
  exit 1
fi

# Warning about DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
  echo -e "${YELLOW}⚠${NC}  DATABASE_URL not provided - Railway will use Postgres addon's URL automatically"
  echo "   Services will use: \${{Postgres.DATABASE_PRIVATE_URL}}"
fi

# Info about AI provider
if [ "$AI_PROVIDER" = "gemini" ] && [ -z "$GEMINI_API_KEY" ]; then
  echo -e "${YELLOW}⚠${NC}  AI_PROVIDER is set to 'gemini' but GEMINI_API_KEY is not provided"
  echo "   Make sure to set GEMINI_API_KEY or change AI_PROVIDER"
fi
if [ "$AI_PROVIDER" = "openrouter" ] && [ -z "$OPENROUTER_API_KEY" ]; then
  echo -e "${YELLOW}⚠${NC}  AI_PROVIDER is set to 'openrouter' but OPENROUTER_API_KEY is not provided"
  echo "   Make sure to set OPENROUTER_API_KEY or change AI_PROVIDER"
fi

echo -e "${GREEN}✓${NC} All required variables are set"
echo ""

# Confirmation
if [ "$INTERACTIVE" = true ] && [ "$DRY_RUN" = false ]; then
  echo -e "${YELLOW}⚠  This will set variables in your Railway project${NC}"
  read -p "Continue? (yes/no): " confirm
  if [ "$confirm" != "yes" ]; then
    echo "Aborted."
    exit 0
  fi
  echo ""
fi

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Step 3: Setting Variables${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Set shared variables
echo -e "${YELLOW}Setting shared variables...${NC}"
# Only set DATABASE_URL if provided (Railway Postgres addon provides it automatically otherwise)
[ -n "$DATABASE_URL" ] && set_variable "shared" "" "DATABASE_URL" "$DATABASE_URL" "PostgreSQL connection (custom)"
set_variable "shared" "" "AI_PROVIDER" "$AI_PROVIDER" "AI provider"
[ -n "$GEMINI_API_KEY" ] && set_variable "shared" "" "GEMINI_API_KEY" "$GEMINI_API_KEY" "Gemini API key"
[ -n "$OPENROUTER_API_KEY" ] && set_variable "shared" "" "OPENROUTER_API_KEY" "$OPENROUTER_API_KEY" "OpenRouter API key"
[ -n "$OPENAI_API_KEY" ] && set_variable "shared" "" "OPENAI_API_KEY" "$OPENAI_API_KEY" "OpenAI API key"
set_variable "shared" "" "DEFAULT_AI_MODEL" "$DEFAULT_AI_MODEL" "Default AI model"
set_variable "shared" "" "WHISPER_MODEL" "$WHISPER_MODEL" "Audio transcription model"
set_variable "shared" "" "VISION_FALLBACK_MODEL" "$VISION_FALLBACK_MODEL" "Vision model"
set_variable "shared" "" "EMBEDDING_MODEL" "$EMBEDDING_MODEL" "Embedding model"
set_variable "shared" "" "NODE_ENV" "$NODE_ENV" "Node environment"
set_variable "shared" "" "LOG_LEVEL" "$LOG_LEVEL" "Logging level"
echo ""

# Set bot-client specific variables
echo -e "${YELLOW}Setting bot-client variables...${NC}"
set_variable "service" "bot-client" "DISCORD_TOKEN" "$DISCORD_TOKEN" "Discord bot token"
[ -n "$DISCORD_CLIENT_ID" ] && set_variable "service" "bot-client" "DISCORD_CLIENT_ID" "$DISCORD_CLIENT_ID" "Discord client ID"
echo ""

# Set api-gateway specific variables
echo -e "${YELLOW}Setting api-gateway variables...${NC}"
set_variable "service" "api-gateway" "API_GATEWAY_PORT" "$API_GATEWAY_PORT" "Gateway port"
echo ""

# Set ai-worker specific variables
echo -e "${YELLOW}Setting ai-worker variables...${NC}"
set_variable "service" "ai-worker" "WORKER_CONCURRENCY" "$WORKER_CONCURRENCY" "Worker concurrency"
set_variable "service" "ai-worker" "PORT" "$AI_WORKER_PORT" "Worker port"
echo ""

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
if [ "$DRY_RUN" = true ]; then
  echo -e "${GREEN}✓ Dry run complete${NC}"
  echo ""
  echo "Run without --dry-run to actually set these variables."
else
  echo -e "${GREEN}✓ All variables set successfully${NC}"
  echo ""
  echo "Next steps:"
  echo "  1. Verify variables: railway variables"
  echo "  2. Redeploy services: railway up"
  echo "  3. Check logs: railway logs"
fi
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
