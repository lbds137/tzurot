#!/bin/bash
# Migration Helper - Orchestrates multi-step migrations safely
#
# Usage:
#   ./scripts/migration-helper.sh [environment] [migration-script.sql]
#
# Example:
#   ./scripts/migration-helper.sh production scripts/migrate-persona-all-in-one.sql

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
ENVIRONMENT=${1:-development}
MIGRATION_SCRIPT=${2}
BACKUP_DIR="backups"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

# Validate inputs
if [ -z "$MIGRATION_SCRIPT" ]; then
    echo -e "${RED}❌ Error: Migration script not specified${NC}"
    echo "Usage: $0 [environment] [migration-script.sql]"
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
echo ""

# Step 1: Confirm
echo -e "${YELLOW}⚠️  WARNING: You are about to run a database migration on $ENVIRONMENT${NC}"
echo ""
read -p "Do you want to continue? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
    echo -e "${RED}❌ Migration cancelled${NC}"
    exit 0
fi
echo ""

# Step 2: Create backup directory
echo -e "${BLUE}📁 Creating backup directory...${NC}"
mkdir -p "$BACKUP_DIR"
echo -e "${GREEN}✅ Backup directory ready${NC}"
echo ""

# Step 3: Backup database
echo -e "${BLUE}💾 Creating database backup...${NC}"
BACKUP_FILE="$BACKUP_DIR/backup-$ENVIRONMENT-$TIMESTAMP.sql"

railway run --environment "$ENVIRONMENT" pg_dump > "$BACKUP_FILE" 2>&1

if [ -f "$BACKUP_FILE" ]; then
    BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo -e "${GREEN}✅ Backup created: $BACKUP_FILE ($BACKUP_SIZE)${NC}"
else
    echo -e "${RED}❌ Backup failed!${NC}"
    exit 1
fi
echo ""

# Step 4: Show database stats before migration
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
" 2>&1
echo ""

# Step 5: Final confirmation
echo -e "${YELLOW}⚠️  FINAL CONFIRMATION${NC}"
echo -e "Backup created: ${GREEN}$BACKUP_FILE${NC}"
echo -e "Migration script: ${BLUE}$MIGRATION_SCRIPT${NC}"
echo ""
read -p "Proceed with migration? (yes/no): " FINAL_CONFIRM
if [ "$FINAL_CONFIRM" != "yes" ]; then
    echo -e "${RED}❌ Migration cancelled${NC}"
    echo -e "${BLUE}💡 Backup preserved at: $BACKUP_FILE${NC}"
    exit 0
fi
echo ""

# Step 6: Run migration
echo -e "${BLUE}🚀 Running migration script...${NC}"
railway run --environment "$ENVIRONMENT" psql < "$MIGRATION_SCRIPT" 2>&1

MIGRATION_EXIT_CODE=$?
echo ""

if [ $MIGRATION_EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✅ Migration completed successfully${NC}"
else
    echo -e "${RED}❌ Migration failed with exit code $MIGRATION_EXIT_CODE${NC}"
    echo -e "${YELLOW}💡 Backup available for rollback: $BACKUP_FILE${NC}"
    exit $MIGRATION_EXIT_CODE
fi
echo ""

# Step 7: Post-migration verification
echo -e "${BLUE}🔍 Post-migration verification...${NC}"

# Check migration status
echo -e "${BLUE}Checking Prisma migration status...${NC}"
railway run --environment "$ENVIRONMENT" npx prisma migrate status 2>&1 || true
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
" 2>&1
echo ""

# Step 8: Summary
echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║           Migration Complete!                              ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Backup Location:${NC} $BACKUP_FILE"
echo -e "${BLUE}Environment:${NC} $ENVIRONMENT"
echo -e "${BLUE}Timestamp:${NC} $TIMESTAMP"
echo ""
echo -e "${YELLOW}📝 Next Steps:${NC}"
echo "1. Test the application to ensure everything works"
echo "2. Monitor logs for errors:"
echo "   railway logs --service api-gateway --environment $ENVIRONMENT"
echo "3. If issues occur, rollback with:"
echo "   railway run --environment $ENVIRONMENT psql < $BACKUP_FILE"
echo ""
echo -e "${GREEN}✅ Migration process completed${NC}"
