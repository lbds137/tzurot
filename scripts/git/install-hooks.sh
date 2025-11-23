#!/bin/bash
# Install git hooks from the hooks/ directory

set -e

GIT_ROOT=$(git rev-parse --show-toplevel)
cd "$GIT_ROOT"

echo "📎 Installing git hooks..."

# Copy pre-commit hook
if [ -f "hooks/pre-commit" ]; then
    cp hooks/pre-commit .git/hooks/pre-commit
    chmod +x .git/hooks/pre-commit
    echo "✅ Installed pre-commit hook"
else
    echo "❌ hooks/pre-commit not found"
    exit 1
fi

# Copy pre-push hook
if [ -f "hooks/pre-push" ]; then
    cp hooks/pre-push .git/hooks/pre-push
    chmod +x .git/hooks/pre-push
    echo "✅ Installed pre-push hook"
else
    echo "❌ hooks/pre-push not found"
    exit 1
fi

echo "✅ All hooks installed successfully!"
