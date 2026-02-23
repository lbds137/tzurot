#!/usr/bin/env bash
# Find production files that knip reports as unused, excluding known
# false-positive categories (command submodules, test utilities, scripts).
#
# Command submodules (e.g., commands/admin/cleanup.ts) are dynamically
# loaded via defineCommand's re-export pattern and are invisible to knip's
# static analysis in --production mode.
#
# Two-pass approach:
# 1. Run knip --production to get candidate unused files
# 2. Filter out known false positives (test utils, command submodules)
# 3. Verify remaining candidates have no non-test importers (grep check)
#
# Usage: pnpm knip:dead

set -euo pipefail

# Run knip in production mode, files-only
KNIP_OUTPUT=$(pnpm knip --production --include files 2>&1 || true)

# Filter to just file paths (skip pnpm warnings, blank lines)
# Strip trailing whitespace first (knip pads output with spaces)
FILES=$(echo "$KNIP_OUTPUT" \
  | sed 's/[[:space:]]*$//' \
  | grep -E '^\S+\.tsx?$')

if [[ -z "$FILES" ]]; then
  echo "✅ No unused files detected."
  exit 0
fi

# Exclude known false-positive patterns
CANDIDATES=$(echo "$FILES" \
  | grep -v '/test/' \
  | grep -v '/test-utils' \
  | grep -v '\.mock\.ts$' \
  | grep -v '/fixtures' \
  | grep -v '/scripts/' \
  | grep -v '/commands/[^/]*/[^/]*\.ts$' \
  | grep -v '^vitest\.' \
  | grep -v '^\..*\.ts$' \
  || true)

if [[ -z "$CANDIDATES" ]]; then
  echo "✅ No dead files found ($(echo "$FILES" | wc -l | tr -d ' ') knip hits filtered as false positives)."
  exit 0
fi

# Second pass: verify each candidate has no non-test importers
DEAD_FILES=()

while IFS= read -r candidate; do
  basename=$(basename "$candidate" .ts)

  # Search for non-test imports of this file
  importers=$(grep -rl --include='*.ts' \
    --exclude='*.test.ts' --exclude='*.spec.ts' --exclude='*.int.test.ts' \
    "/${basename}\\.js['\"]" \
    services/ packages/ 2>/dev/null \
    | grep -v "$candidate" \
    || true)

  if [[ -z "$importers" ]]; then
    DEAD_FILES+=("$candidate")
  fi
done <<< "$CANDIDATES"

if [[ ${#DEAD_FILES[@]} -eq 0 ]]; then
  FILTERED=$(echo "$FILES" | wc -l | tr -d ' ')
  echo "✅ No dead files found ($FILTERED knip hits filtered as false positives)."
  exit 0
fi

echo "⚠️  Found ${#DEAD_FILES[@]} potentially dead file(s):"
echo ""
for f in "${DEAD_FILES[@]}"; do
  echo "  $f"
done
echo ""
echo "Verify each file: check git log and grep for dynamic imports before deleting."
exit 1
