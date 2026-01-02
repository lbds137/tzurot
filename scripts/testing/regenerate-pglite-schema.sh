#!/bin/bash
# Regenerate PGLite schema SQL from Prisma schema
#
# This script generates the SQL schema for PGLite integration tests.
# Run this whenever you change prisma/schema.prisma.
#
# Usage: ./scripts/testing/regenerate-pglite-schema.sh
#
# Requires DATABASE_URL to be set (uses it for Prisma CLI, doesn't connect).

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUTPUT_FILE="$PROJECT_ROOT/tests/integration/schema/pglite-schema.sql"

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
  # Try to source .env
  if [ -f "$PROJECT_ROOT/.env" ]; then
    export $(grep -v '^#' "$PROJECT_ROOT/.env" | xargs)
  fi
fi

if [ -z "$DATABASE_URL" ]; then
  echo "Error: DATABASE_URL is not set. Set it or create a .env file."
  exit 1
fi

echo "Generating PGLite schema from Prisma..."

# Generate SQL using prisma migrate diff
cd "$PROJECT_ROOT"
npx prisma migrate diff \
  --from-empty \
  --to-schema ./prisma/schema.prisma \
  --script 2>/dev/null > "$OUTPUT_FILE"

# Count lines to verify
LINES=$(wc -l < "$OUTPUT_FILE")
echo "Generated $OUTPUT_FILE ($LINES lines)"
echo "Done! Remember to commit the updated schema file."
