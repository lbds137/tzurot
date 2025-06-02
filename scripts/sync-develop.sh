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

# Merge main into develop
echo "🔀 Merging main into develop..."
if git merge origin/main -m "chore: sync develop with main after release [skip ci]"; then
    echo "✅ Merge successful!"
    
    # Push to origin
    echo "📤 Pushing to origin..."
    git push origin develop
    
    echo "✨ Develop is now synced with main!"
else
    echo "❌ Merge failed - there might be conflicts"
    echo "Resolve conflicts manually, then run:"
    echo "  git push origin develop"
    exit 1
fi

# Show current status
echo ""
echo "📊 Current branch status:"
git log --oneline --graph --decorate -5