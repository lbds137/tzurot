# Git Workflow Sync Guide: Solving the "develop behind main" Issue

## The Problem

Your repository experiences a common issue where `develop` appears to be "behind" `main` after merging PRs. This happens because:

1. PRs are created from `develop` and merged into `main`
2. GitHub creates merge commits on `main` that don't exist on `develop`
3. Branch protection rules prevent direct pushes to sync the branches

## Root Cause Analysis

Your current workflow:
```
feature → develop (PR) → main (PR)
```

When a PR is merged into `main`, GitHub creates a merge commit like:
```
d921494 Develop (#24)
```

This commit exists only on `main`, making `develop` appear "behind" even though all the actual code changes are already in `develop`.

## Solutions

### Solution 1: Change GitHub Merge Strategy (Recommended)

Instead of using "Create a merge commit", use one of these options in GitHub:

1. **"Squash and merge"** - Combines all commits into one
2. **"Rebase and merge"** - Maintains linear history without merge commits

To implement:
1. Go to your repository settings on GitHub
2. Navigate to Settings → General → Pull Requests
3. Consider disabling "Allow merge commits"
4. Enable "Allow squash merging" or "Allow rebase merging"

### Solution 2: Automated Sync Workflow

Create a GitHub Action that automatically syncs `develop` with `main` after each merge:

```yaml
# .github/workflows/sync-develop.yml
name: Sync develop with main

on:
  push:
    branches:
      - main

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0
          token: ${{ secrets.GITHUB_TOKEN }}
      
      - name: Sync develop with main
        run: |
          git config user.name "GitHub Actions"
          git config user.email "actions@github.com"
          git checkout develop
          git merge main -m "chore: sync develop with main [skip ci]"
          git push origin develop
```

Note: This requires adjusting branch protection rules to allow the GitHub Actions bot to push.

### Solution 3: Change PR Workflow

Instead of:
```
feature → develop → main
```

Consider:
```
feature → main (for hotfixes)
feature → develop (for regular development)
develop → main (for releases only)
```

This way, `main` only receives commits from `develop` during releases, maintaining a clear hierarchy.

### Solution 4: Manual Sync Process

When you need to sync (after merging to main):

1. Create a sync branch:
```bash
git checkout -b sync/develop-with-main origin/develop
git merge origin/main -m "chore: sync develop with main"
git push origin sync/develop-with-main
```

2. Create a PR from `sync/develop-with-main` to `develop`
3. Merge the PR

## Best Practices Going Forward

1. **Use consistent merge strategies** - Pick one and stick with it
2. **Avoid direct merges to main** - Always go through PRs
3. **Regular sync cycles** - Don't let branches diverge for too long
4. **Clear release process** - Define when and how code moves from develop to main

## Immediate Fix for Current Situation

Since you have branch protection, create a sync PR:

```bash
# Create sync branch
git checkout -b sync/main-to-develop origin/develop
git merge origin/main -m "chore: sync develop with main - resolve divergence"
git push origin sync/main-to-develop

# Then create a PR on GitHub from sync/main-to-develop → develop
```

## Prevention

To prevent this issue in the future:

1. **Option A**: Only merge to main during releases
2. **Option B**: Use squash or rebase merging on GitHub
3. **Option C**: Set up automated sync workflows
4. **Option D**: Remove branch protection temporarily for sync operations (not recommended)

## Conclusion

The simplest long-term solution is to change your GitHub merge strategy to either "Squash and merge" or "Rebase and merge". This maintains a linear history and prevents the divergence issue entirely.