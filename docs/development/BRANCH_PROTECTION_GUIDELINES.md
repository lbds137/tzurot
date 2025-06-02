# Branch Protection Guidelines

## Branch Protection Strategy

### `main` Branch (Production)
**Status**: FULLY PROTECTED ✅

- ✅ Require pull request before merging
- ✅ Require at least 1 approval
- ✅ Require status checks to pass
- ✅ Require branches to be up to date before merging
- ✅ Include administrators in restrictions
- ✅ Restrict who can push (maintainers only)

**When to push to main**: NEVER directly. Always use PRs.

### `develop` Branch (Development)
**Status**: MINIMALLY PROTECTED ⚠️

- ❌ No required pull request reviews
- ❌ No required status checks
- ✅ Restrict who can push to team members only
- ❌ No requirement for branches to be up to date

**When direct pushes to develop are acceptable**:
1. ✅ Syncing with main after releases
2. ✅ Fixing merge conflicts
3. ✅ Emergency hotfixes (with team notification)
4. ✅ Documentation-only changes
5. ✅ Dependency updates (after local testing)

**When PRs are still required**:
1. ⚠️ All feature development
2. ⚠️ Bug fixes that touch business logic
3. ⚠️ Refactoring
4. ⚠️ Breaking changes
5. ⚠️ Changes from external contributors

## Sync Workflow

After merging to main:
```bash
# Option 1: Use the sync script
./scripts/sync-develop.sh

# Option 2: Use git alias
git sync-develop

# Option 3: Manual sync
git checkout develop
git pull origin develop
git merge origin/main -m "chore: sync develop with main"
git push origin develop
```

## Best Practices

1. **Default to PRs**: Even though develop allows direct pushes, still use PRs for code review and CI checks
2. **Communicate**: If you need to push directly, notify the team in Slack/Discord
3. **Run Tests**: Always run `npm test` before direct pushes
4. **Small Changes Only**: Direct pushes should be small and low-risk
5. **Document Why**: In direct push commits, explain why it was necessary

## Emergency Procedures

If you need to push directly to develop:
1. Pull latest: `git pull origin develop`
2. Run tests: `npm test`
3. Check linting: `npm run lint`
4. Push with clear message: `git push origin develop`
5. Notify team with reason

## Why This Approach?

- **main** = Production stability (full protection)
- **develop** = Development flexibility (minimal protection)
- **PRs** = Still used for code review and knowledge sharing
- **Direct push** = Available for maintenance tasks

This balance provides security where it matters most (production) while maintaining development velocity.