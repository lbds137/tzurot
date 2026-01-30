#!/bin/bash
# Regenerate PGLite schema SQL from Prisma schema
#
# This script generates the SQL schema for PGLite integration tests.
# Run this whenever you change prisma/schema.prisma.
#
# Usage:
#   ./scripts/testing/regenerate-pglite-schema.sh
#   pnpm generate:pglite
#
# Note: Uses a dummy DATABASE_URL - Prisma doesn't actually connect,
# it just needs the provider hint to generate PostgreSQL-compatible SQL.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUTPUT_FILE="$PROJECT_ROOT/tests/schema/pglite-schema.sql"

# Use dummy URL - prisma migrate diff doesn't actually connect to the database.
# It just needs the provider hint (postgresql://) to generate the right SQL syntax.
# This matches what CI does in .github/workflows/ci.yml
DUMMY_DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"

# Use existing DATABASE_URL if set (might have extra features), otherwise use dummy
if [ -z "$DATABASE_URL" ]; then
  export DATABASE_URL="$DUMMY_DATABASE_URL"
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
