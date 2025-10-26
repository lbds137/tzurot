#!/bin/bash
# Migration Helper - Orchestrates multi-step migrations safely
#
# Usage:
#   ./scripts/migration-helper.sh [options] <environment> <migration-script.sql>
#
# Options:
#   -y, --yes    Skip all confirmations (non-interactive mode)
#   -h, --help   Show this help message
#
# Examples:
#   # Interactive mode (prompts for confirmation)
#   ./scripts/migration-helper.sh production scripts/migrate-persona-all-in-one.sql
#
#   # Non-interactive mode (for Claude Code to run)
#   ./scripts/migration-helper.sh --yes production scripts/migrate-persona-all-in-one.sql

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse options
YES_FLAG=false
while [[ $# -gt 0 ]]; do
  case $1 in
    -y|--yes)
      YES_FLAG=true
      shift
      ;;
    -h|--help)
      echo "Migration Helper - Orchestrates multi-step migrations safely"
      echo ""
      echo "Usage:"
      echo "  $0 [options] <environment> <migration-script.sql>"
      echo ""
      echo "Options:"
      echo "  -y, --yes    Skip all confirmations (non-interactive mode)"
      echo "  -h, --help   Show this help message"
      echo ""
      echo "Examples:"
      echo "  # Interactive mode"
      echo "  $0 production scripts/migrate-persona-all-in-one.sql"
      echo ""
      echo "  # Non-interactive mode"
      echo "  $0 --yes production scripts/migrate-persona-all-in-one.sql"
      exit 0
      ;;
    *)
      break
      ;;
  esac
done

# Configuration
ENVIRONMENT=${1:-development}
MIGRATION_SCRIPT=${2}
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

# Validate inputs
if [ -z "$MIGRATION_SCRIPT" ]; then
    echo -e "${RED}❌ Error: Migration script not specified${NC}"
    echo "Usage: $0 [options] <environment> <migration-script.sql>"
    echo "Run '$0 --help' for more information"
    exit 1
fi

if [ ! -f "$MIGRATION_SCRIPT" ]; then
    echo -e "${RED}❌ Error: Migration script not found: $MIGRATION_SCRIPT${NC}"
    exit 1
fi

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║           Tzurot Migration Helper                         ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Environment:${NC} $ENVIRONMENT"
echo -e "${BLUE}Migration Script:${NC} $MIGRATION_SCRIPT"
echo -e "${BLUE}Timestamp:${NC} $TIMESTAMP"
echo -e "${BLUE}Mode:${NC} $([ "$YES_FLAG" = true ] && echo "Non-interactive (--yes)" || echo "Interactive")"
echo ""

# Step 1: Verify Railway backups
echo -e "${BLUE}💾 Backup Status Check${NC}"
echo -e "${YELLOW}⚠️  This script relies on Railway's automatic database backups.${NC}"
echo ""
echo -e "${BLUE}Verify backups exist:${NC}"
echo "  1. Go to https://railway.app"
echo "  2. Open project 'industrious-analysis'"
echo "  3. Click on the PostgreSQL service"
echo "  4. Go to 'Backups' tab"
echo "  5. Verify recent backups exist (Pro plan feature)"
echo ""
echo -e "${YELLOW}If migration fails, you can restore from Railway dashboard:${NC}"
echo "  Backups → Select backup → Restore"
echo ""

# Step 2: Confirm
if [ "$YES_FLAG" = false ]; then
    echo -e "${YELLOW}⚠️  WARNING: You are about to run a database migration on $ENVIRONMENT${NC}"
    echo ""
    read -p "Have you verified Railway backups exist? (yes/no): " BACKUP_CONFIRM
    if [ "$BACKUP_CONFIRM" != "yes" ]; then
        echo -e "${RED}❌ Migration cancelled - please verify backups first${NC}"
        exit 0
    fi
    echo ""
    read -p "Do you want to continue with migration? (yes/no): " CONFIRM
    if [ "$CONFIRM" != "yes" ]; then
        echo -e "${RED}❌ Migration cancelled${NC}"
        exit 0
    fi
    echo ""
else
    echo -e "${YELLOW}⚠️  Running migration on $ENVIRONMENT (--yes flag provided)${NC}"
    echo -e "${BLUE}💡 Assuming Railway backups have been verified${NC}"
    echo ""
fi

# Step 3: Show database stats before migration
echo -e "${BLUE}📊 Database stats before migration...${NC}"
railway run --environment "$ENVIRONMENT" psql -c "
SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
    n_live_tup as rows
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
LIMIT 5;
" 2>&1 || echo "(Stats query failed, continuing...)"
echo ""

# Step 4: Run migration
echo -e "${BLUE}🚀 Running migration script...${NC}"
railway run --environment "$ENVIRONMENT" psql < "$MIGRATION_SCRIPT" 2>&1

MIGRATION_EXIT_CODE=$?
echo ""

if [ $MIGRATION_EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✅ Migration completed successfully${NC}"
else
    echo -e "${RED}❌ Migration failed with exit code $MIGRATION_EXIT_CODE${NC}"
    echo ""
    echo -e "${YELLOW}To rollback:${NC}"
    echo "  1. Go to https://railway.app"
    echo "  2. Open project 'industrious-analysis' → PostgreSQL"
    echo "  3. Click 'Backups' tab"
    echo "  4. Select most recent backup (before this migration)"
    echo "  5. Click 'Restore'"
    echo ""
    echo -e "${YELLOW}Or use SQL rollback if migration includes rollback script:${NC}"
    echo "  railway run --environment $ENVIRONMENT psql < scripts/rollback-[name].sql"
    exit $MIGRATION_EXIT_CODE
fi
echo ""

# Step 5: Post-migration verification
echo -e "${BLUE}🔍 Post-migration verification...${NC}"

# Check migration status
echo -e "${BLUE}Checking Prisma migration status...${NC}"
railway run --environment "$ENVIRONMENT" npx prisma migrate status 2>&1 || echo "(Prisma check failed, continuing...)"
echo ""

# Show table stats again
echo -e "${BLUE}📊 Database stats after migration...${NC}"
railway run --environment "$ENVIRONMENT" psql -c "
SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
    n_live_tup as rows
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
LIMIT 5;
" 2>&1 || echo "(Stats query failed, continuing...)"
echo ""

# Step 6: Summary
echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║           Migration Complete!                              ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Environment:${NC} $ENVIRONMENT"
echo -e "${BLUE}Timestamp:${NC} $TIMESTAMP"
echo -e "${BLUE}Backup:${NC} Railway automatic backups (Pro plan)"
echo ""
echo -e "${YELLOW}📝 Next Steps:${NC}"
echo "1. Test the application to ensure everything works"
echo "2. Monitor logs for errors:"
echo "   railway logs --service api-gateway --environment $ENVIRONMENT"
echo "   railway logs --service ai-worker --environment $ENVIRONMENT"
echo "3. If issues occur, restore from Railway dashboard:"
echo "   https://railway.app → industrious-analysis → PostgreSQL → Backups"
echo ""
echo -e "${GREEN}✅ Migration process completed${NC}"
