#!/bin/bash
# Bump version across all package.json files in the monorepo
#
# Usage:
#   ./scripts/utils/bump-version.sh <new-version>
#   pnpm bump-version <new-version>
#
# Examples:
#   pnpm bump-version 3.0.0-beta.31
#   pnpm bump-version 3.0.0

set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <new-version>"
  echo "Example: $0 3.0.0-beta.31"
  exit 1
fi

NEW_VERSION="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Validate version format (semver with optional pre-release)
if ! echo "$NEW_VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$'; then
  echo "Error: Invalid version format '$NEW_VERSION'"
  echo "Expected format: X.Y.Z or X.Y.Z-prerelease (e.g., 3.0.0 or 3.0.0-beta.31)"
  exit 1
fi

cd "$ROOT_DIR"

# Find all package.json files (excluding node_modules, .pnpm-store, and tzurot-legacy)
PACKAGE_FILES=$(find . -name "package.json" \
  -not -path "*/node_modules/*" \
  -not -path "*/.pnpm-store/*" \
  -not -path "*/tzurot-legacy/*" \
  | sort)

echo "Bumping version to $NEW_VERSION in:"
echo ""

UPDATED=0
for file in $PACKAGE_FILES; do
  # Get current version
  CURRENT=$(grep -o '"version": *"[^"]*"' "$file" | head -1 | sed 's/.*: *"\([^"]*\)"/\1/')

  if [ -n "$CURRENT" ] && [ "$CURRENT" != "$NEW_VERSION" ]; then
    # Update version using sed (handle macOS vs Linux differences)
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' "s/\"version\": *\"$CURRENT\"/\"version\": \"$NEW_VERSION\"/" "$file"
    else
      sed -i "s/\"version\": *\"$CURRENT\"/\"version\": \"$NEW_VERSION\"/" "$file"
    fi
    echo "  $file: $CURRENT -> $NEW_VERSION"
    UPDATED=$((UPDATED + 1))
  elif [ "$CURRENT" = "$NEW_VERSION" ]; then
    echo "  $file: already at $NEW_VERSION (skipped)"
  fi
done

echo ""
if [ $UPDATED -gt 0 ]; then
  echo "Updated $UPDATED package.json file(s)"
  echo ""
  echo "Next steps:"
  echo "  1. Review changes: git diff"
  echo "  2. Commit: git commit -am \"chore: bump version to $NEW_VERSION\""
else
  echo "No files needed updating"
fi
