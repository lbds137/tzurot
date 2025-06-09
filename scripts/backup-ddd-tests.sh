#!/bin/bash

# Safe backup script for DDD tests
# Creates timestamped backup without modifying original files

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="tests/unit/.ddd-backup-${TIMESTAMP}"

echo "🔒 Creating backup of DDD test files..."
echo "Backup directory: ${BACKUP_DIR}"

# Create backup directory
mkdir -p "${BACKUP_DIR}"

# Copy directory structure and files
echo "Backing up domain tests..."
cp -r tests/unit/domain "${BACKUP_DIR}/" 2>/dev/null || true

echo "Backing up adapter tests..."
cp -r tests/unit/adapters "${BACKUP_DIR}/" 2>/dev/null || true

# Count backed up files
DOMAIN_COUNT=$(find "${BACKUP_DIR}/domain" -name "*.test.js" 2>/dev/null | wc -l)
ADAPTER_COUNT=$(find "${BACKUP_DIR}/adapters" -name "*.test.js" 2>/dev/null | wc -l)

echo ""
echo "✅ Backup complete!"
echo "   Domain tests: ${DOMAIN_COUNT} files"
echo "   Adapter tests: ${ADAPTER_COUNT} files"
echo "   Total: $((DOMAIN_COUNT + ADAPTER_COUNT)) files"
echo ""
echo "Backup location: ${BACKUP_DIR}"
echo ""
echo "To restore from backup:"
echo "  cp -r ${BACKUP_DIR}/* tests/unit/"