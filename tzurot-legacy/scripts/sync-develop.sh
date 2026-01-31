#!/bin/bash

# Sync develop with main after releases
# This script assumes develop branch has no protection rules

set -e

echo "🔄 Syncing develop with main..."

# Fetch latest changes
echo "📥 Fetching latest changes..."
git fetch --all

# Switch to develop
echo "🌿 Switching to develop branch..."
git checkout develop
git pull origin develop

# Rebase develop onto main
echo "🔀 Rebasing develop onto main..."
if git rebase origin/main; then
    echo "✅ Rebase successful!"
    
    # Push to origin (force needed after rebase)
    echo "📤 Pushing to origin (with force-with-lease for safety)..."
    git push origin develop --force-with-lease
    
    echo "✨ Develop is now synced with main!"
else
    echo "❌ Rebase failed - there might be conflicts"
    echo "Resolve conflicts manually, then run:"
    echo "  git rebase --continue  # After fixing conflicts"
    echo "  git push origin develop --force-with-lease"
    exit 1
fi

# Show current status
echo ""
echo "📊 Current branch status:"
git log --oneline --graph --decorate -5