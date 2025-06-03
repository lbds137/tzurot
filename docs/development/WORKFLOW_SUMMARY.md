# Git Workflow Summary

## 🚨 CRITICAL PR RULES

**NEVER create PRs directly to main!** The only exceptions are:
1. Syncing develop → main (releases)
2. Emergency hotfixes (with approval)

**ALWAYS create feature PRs to develop!**

See [PR_WORKFLOW_RULES.md](./PR_WORKFLOW_RULES.md) for details.

## Current Setup

### Repository Settings
- **Merge Policy**: Rebase-only (no merge commits or squash)
- **Linear History**: Enforced through rebase workflow
- **CI**: Single run per PR (no duplicates)

### Branch Protection
- **main**: ✅ Fully protected (requires PRs, reviews, status checks)
- **develop**: ❌ No protection (allows direct pushes for maintenance)

### SSH Authentication
- ✅ SSH key configured and working
- ✅ No password prompts needed
- ✅ Can push/pull without authentication issues

## Simplified Workflow

### 1. Feature Development
```bash
# Create feature branch from develop
git checkout develop
git pull origin develop
git checkout -b feat/my-feature

# Work on feature
# ... make changes ...
git add .
git commit -m "feat: description"
git push origin feat/my-feature

# Create PR: feat/my-feature → develop
```

### 2. Deploy to Production
```bash
# When ready to deploy
# Create PR: develop → main
# Merge when approved
```

### 3. Sync After Deploy
```bash
# After merging to main, sync develop immediately:
git sync-develop

# That's it! One command and you're synced.
# Note: This uses rebase + force push to maintain linear history
```

## The Entire Workflow

```
feature → develop (PR) → main (PR) → sync-develop (direct)
```

Simple. Clean. No unnecessary branches or complexity.

## Quick Commands

### Check Branch Status
```bash
# See how far ahead/behind branches are
git fetch --all
git rev-list --left-right --count origin/develop...origin/main
# Output: X Y (X commits ahead, Y commits behind)
```

### Sync Script
```bash
# Automatically syncs develop with main
./scripts/sync-develop.sh
```

## Benefits of This Setup

1. **No more sync PRs** - Direct push to develop for maintenance
2. **Protected production** - main still requires full review process  
3. **Easy syncing** - One command to sync branches
4. **No auth hassles** - SSH key handles everything

## Best Practices

1. **Still use PRs for features** - Even though develop allows direct push
2. **Only direct push for**:
   - Syncing with main
   - Fixing merge conflicts
   - Emergency hotfixes
   - Small documentation updates
3. **Communicate direct pushes** - Let team know when you push directly
4. **Test before pushing** - Run `npm test` even for direct pushes

## Rebase Workflow Tips

### Updating Feature Branches
```bash
# Before creating PR, rebase on latest develop
git checkout feature-branch
git fetch origin
git rebase origin/develop
git push --force-with-lease
```

### Why Rebase-Only?
- **Linear History**: Easy to read and understand
- **No Merge Commits**: Clean git log
- **No "X behind, Y ahead"**: Branches stay in sync
- **Cleaner Reverts**: If needed, reverting is straightforward

### Common Rebase Scenarios
1. **Conflicts during rebase**: Fix conflicts, then `git rebase --continue`
2. **Made a mistake**: `git rebase --abort` to start over
3. **Need to update PR**: Rebase and force-push updates the PR automatically