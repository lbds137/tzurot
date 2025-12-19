---
name: tzurot-git-workflow
description: Git workflow for Tzurot v3 - Rebase-only strategy, PR creation against develop, commit message format, and safety checks. Use when creating commits, PRs, or performing git operations.
lastUpdated: '2025-12-18'
---

# Tzurot v3 Git Workflow

**Use this skill when:** Creating commits, pushing changes, creating PRs, or performing any git operations.

## 🚨 CRITICAL: Rebase-Only Workflow

**THIS PROJECT USES REBASE-ONLY. NO SQUASH. NO MERGE. ONLY REBASE.**

GitHub repository settings enforce this:

- ✅ **Rebase and merge** - ONLY option enabled
- ❌ **Squash and merge** - DISABLED
- ❌ **Create a merge commit** - DISABLED

**Why:** Squash/merge creates duplicate commits with different hashes, causing rebase conflicts and confusion.

## 🎯 CRITICAL: Always Target `develop` for PRs

**NEVER create PRs directly to `main`!**

- ✅ **Feature PRs → `develop`** (v3 is still in testing)
- ❌ **Feature PRs → `main`** (only for releases)

```bash
# ✅ CORRECT - Always target develop
gh pr create --base develop --title "feat: your feature"

# ❌ WRONG - Don't target main for features!
gh pr create --base main --title "feat: your feature"
```

## Branch Strategy

### Main Branches

- `main` - Production releases only (v3 not ready yet)
- `develop` - Active development branch (current v3 work)

### Feature Branches

Create from `develop`, use these prefixes:

- `feat/` - New features (e.g., `feat/smart-cache-invalidation`)
- `fix/` - Bug fixes (e.g., `fix/memory-leak-redis`)
- `docs/` - Documentation updates (e.g., `docs/update-testing-guide`)
- `refactor/` - Code refactoring (e.g., `refactor/simplify-retry-logic`)
- `chore/` - Maintenance tasks (e.g., `chore/update-dependencies`)
- `test/` - Test improvements (e.g., `test/add-coverage-personality-service`)

## Standard Workflow

### 1. Create Feature Branch

```bash
# Start from latest develop
git checkout develop
git pull origin develop

# Create feature branch
git checkout -b feat/your-feature-name
```

### 2. Make Changes and Test

**CRITICAL: Test before committing!**

```bash
# Run all tests
pnpm test

# Verify test summary
pnpm test 2>&1 | grep -E "(Test Files|Tests)" | sed 's/\x1b\[[0-9;]*m//g'

# TypeScript build check
pnpm build

# Lint check
pnpm lint
```

### 3. Commit Changes

**Commit Message Format:**

```
<type>(<scope>): <description>

[optional body]

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

**Types:**

- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation only
- `refactor` - Code refactoring (no behavior change)
- `test` - Test changes
- `chore` - Maintenance (deps, config, etc.)
- `style` - Code style/formatting
- `perf` - Performance improvement

**Scopes:** (optional but recommended)

- `ai-worker` - AI worker service
- `api-gateway` - API gateway service
- `bot-client` - Bot client service
- `common-types` - Common types package
- `ci` - CI/CD changes
- `deps` - Dependency updates

**Examples:**

```bash
git commit -m "$(cat <<'EOF'
feat(ai-worker): add pgvector memory retrieval

Implements cosine similarity search for personality memories.
Retrieves top 5 most relevant memories based on embedding distance.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

```bash
git commit -m "$(cat <<'EOF'
fix(bot-client): prevent webhook message duplication

Added Redis-based deduplication check to prevent processing
the same Discord message multiple times during webhook replies.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

### 4. Push and Create PR

```bash
# Push feature branch
git push -u origin feat/your-feature

# Create PR against develop
gh pr create --base develop --title "feat: your feature description"
```

**PR Description Format:**

```markdown
## Summary

Brief description of what this PR does

## Changes

- Added X functionality
- Fixed Y issue
- Refactored Z component

## Testing

- [ ] All tests passing
- [ ] Manual testing completed
- [ ] No breaking changes

## Notes

Any additional context or considerations
```

### 5. After PR is Merged

```bash
# Switch to develop
git checkout develop

# Pull rebased commits
git pull origin develop

# Clean up local feature branch
git branch -d feat/your-feature

# Delete remote branch (optional, GitHub can auto-delete)
git push origin --delete feat/your-feature
```

## Before ANY Push to Remote

**MANDATORY: Run tests before pushing!** Even "simple" changes can break tests.

```bash
# 1. Run all tests
pnpm test

# 2. Verify all passing
pnpm test 2>&1 | grep -E "(Test Files|Tests)" | sed 's/\x1b\[[0-9;]*m//g'

# 3. If all green, safe to push
git push origin <branch-name>
```

## Handling Rebase Conflicts

If you need to rebase your feature branch onto latest develop:

```bash
# Get latest develop
git checkout develop
git pull origin develop

# Switch to feature branch
git checkout feat/your-feature

# Rebase onto develop
git rebase develop

# If conflicts, resolve them, then:
git add <resolved-files>
git rebase --continue

# Force push (with lease for safety)
git push --force-with-lease origin feat/your-feature
```

**Important:** GitHub will automatically update the PR when you force-push.

## Git Safety Protocol

### 🚨 NEVER Run These Without Explicit Permission:

**Destructive Commands:**

- `git restore` → Discards changes (hours of work!)
- `git reset --hard` → Undoes commits permanently
- `git clean -fd` → Deletes untracked files
- `git push --force` (without `--force-with-lease`)
- `git branch -D` → Force deletes branch

**ALWAYS ASK BEFORE:**

```bash
# User says: "get all the changes on that branch"
# DO NOT run: git restore .
# THEY MEAN: git add . && git commit

# User says: "clean up"
# DO NOT run: git clean -fd
# THEY MEAN: Review and ask what to clean
```

### Golden Rules:

**1. Uncommitted changes = HOURS OF WORK**

- Treat them as sacred
- Never discard without explicit confirmation
- When in doubt, commit them first

**2. Always confirm destructive operations:**

```bash
# Before running git restore:
"This will discard your changes. Do you want to commit them first?"

# Before running git reset:
"This will undo commits. Are you sure? Should I create a backup branch?"

# Before running git clean:
"This will delete untracked files. Should I list them first?"
```

**3. Use safe alternatives:**

```bash
# Instead of: git push --force
# Use: git push --force-with-lease

# Instead of: git branch -D
# Use: git branch -d (fails if unmerged)

# Instead of: git reset --hard
# Use: git reset --soft (keeps changes staged)
```

## Git Hooks & Commit Strategy

**🚨 CRITICAL: Hooks are source-controlled in `./hooks/` NOT `.git/hooks/`**

### Hook Philosophy

Minimize per-commit overhead, validate thoroughly before push.

| Hook           | When         | What It Does                | Speed       |
| -------------- | ------------ | --------------------------- | ----------- |
| **pre-commit** | Every commit | Prettier + migration safety | Fast (~5s)  |
| **pre-push**   | Before push  | Lint, typecheck, tests      | Slow (~60s) |

### Batched Commit Workflow

This approach reduces hook runs and saves resources:

1. **Work on a unit of work** (feature, fix, or refactor)
2. **Commit frequently** (pre-commit is fast, just migration checks)
3. **Push when the unit is complete** (triggers all quality checks once)
4. **Don't push after every commit** - batch related commits together

This means heavy checks (lint, typecheck, tests) run once per push instead of on every commit.

### Hook File Locations

**Source-controlled** (tracked in git):

- `./hooks/pre-commit` - Minimal checks
- `./hooks/pre-push` - Full quality suite

### Installing Hooks

Run after cloning or when hooks are updated:

```bash
./scripts/git/install-hooks.sh
```

This copies `./hooks/*` to `.git/hooks/`.

### Modifying Hooks

1. Edit files in `./hooks/` (source-controlled)
2. Run `./scripts/git/install-hooks.sh` to install locally
3. Commit and push the hook changes

### Pre-Commit Checks

The pre-commit hook runs formatting and safety checks:

- **Prettier** - Auto-formats staged files
- **Migration safety** - Ensures migrations are valid

If pre-commit checks fail:

```bash
# Review the error
# Fix the issue
# Stage fixes
git add <fixed-files>

# Commit again
git commit -m "your message"
```

### Pre-Push Checks

The pre-push hook runs the full quality suite:

1. **Lint** - ESLint checks
2. **TypeScript** - Type checking
3. **Tests** - Full test suite

**NEVER skip hooks:**

```bash
# ❌ BAD - Skips quality checks
git commit --no-verify

# ✅ GOOD - Fix the issues instead
pnpm lint:fix
pnpm test
git add .
git commit -m "fix: resolve linting issues"
```

## Working with Railway Deployment

Tzurot v3 auto-deploys from GitHub to Railway:

### Deployment Trigger

```bash
# Push to develop triggers deployment
git push origin develop

# Check deployment status
railway status

# View deployment logs
railway logs --service api-gateway
railway logs --service ai-worker
railway logs --service bot-client
```

### Health Checks After Deployment

```bash
# Check API gateway health
curl https://api-gateway-development-83e8.up.railway.app/health

# Check metrics
curl https://api-gateway-development-83e8.up.railway.app/metrics
```

## Multiple Commits in PR

**Prefer multiple small commits over one large commit:**

```bash
# Good - Logical progression
git commit -m "feat(ai-worker): add pgvector schema"
git commit -m "feat(ai-worker): implement memory retrieval"
git commit -m "test(ai-worker): add memory retrieval tests"

# Bad - Everything in one commit
git commit -m "feat(ai-worker): add memory feature"  # Too broad
```

**Each commit should:**

- Be atomic (one logical change)
- Have a clear purpose
- Pass all tests independently (if possible)

## Resolving Merge Conflicts

When rebasing causes conflicts:

```bash
# 1. Rebase starts
git rebase develop
# CONFLICT (content): Merge conflict in file.ts

# 2. Open conflicted files, resolve markers
# <<<<<<< HEAD
# =======
# >>>>>>> feature-branch

# 3. Stage resolved files
git add file.ts

# 4. Continue rebase
git rebase --continue

# 5. If more conflicts, repeat steps 2-4
# When done:
git push --force-with-lease origin feat/your-feature
```

**Conflict Resolution Tips:**

- Keep both changes if they're independent
- Preserve functionality over style
- Test after resolving each conflict
- When unsure, ask the user

## Viewing Git History

```bash
# Recent commits with dates
git log --oneline --date=short -10

# Commits on feature branch since diverging from develop
git log develop..HEAD

# File change history
git log --follow -- path/to/file.ts

# Who changed a line?
git blame path/to/file.ts
```

## Stashing Changes

Temporarily save uncommitted changes:

```bash
# Save changes
git stash push -m "WIP: feature description"

# List stashes
git stash list

# Apply most recent stash
git stash pop

# Apply specific stash
git stash apply stash@{0}

# Delete stash
git stash drop stash@{0}
```

## Cherry-Picking Commits

Copy commits from one branch to another:

```bash
# Get commit hash
git log --oneline

# Cherry-pick to current branch
git cherry-pick <commit-hash>

# Cherry-pick without committing (for editing)
git cherry-pick -n <commit-hash>
```

## Amending Commits

**ONLY amend when:**

1. User explicitly requested amend, OR
2. Adding edits from pre-commit hook

**Before amending, ALWAYS check:**

```bash
# Check authorship
git log -1 --format='%an %ae'

# Check if pushed
git status  # Should show "Your branch is ahead"
```

**NEVER amend other developers' commits!**

```bash
# Amend last commit message
git commit --amend -m "new message"

# Amend last commit (add more changes)
git add <forgotten-file>
git commit --amend --no-edit

# After amending, force push
git push --force-with-lease origin <branch>
```

## Anti-Patterns

### ❌ Don't Create PRs to main

```bash
# ❌ WRONG
gh pr create --base main --title "feat: my feature"

# ✅ RIGHT
gh pr create --base develop --title "feat: my feature"
```

### ❌ Don't Push Without Testing

```bash
# ❌ WRONG
git push origin feat/my-feature  # No tests run!

# ✅ RIGHT
pnpm test && git push origin feat/my-feature
```

### ❌ Don't Use Vague Commit Messages

```bash
# ❌ WRONG
git commit -m "fix stuff"
git commit -m "wip"
git commit -m "update"

# ✅ RIGHT
git commit -m "fix(bot-client): prevent duplicate webhook messages"
```

### ❌ Don't Skip Pre-Commit Hooks

```bash
# ❌ WRONG
git commit --no-verify -m "quick fix"

# ✅ RIGHT
pnpm lint:fix && git commit -m "fix: resolve linting issues"
```

### ❌ Don't Force Push to main or develop

```bash
# ❌ WRONG - Breaks history for everyone
git push --force origin main

# ✅ RIGHT - Only force-push to feature branches
git push --force-with-lease origin feat/my-feature
```

## Release Workflow

### 🚨 CRITICAL: Version Bump Must Update ALL package.json Files

**This is a monorepo.** Version MUST be updated in ALL of these files (excluding tzurot-legacy):

| File | Why |
|------|-----|
| `./package.json` | Root package |
| `./services/ai-worker/package.json` | AI worker service |
| `./services/api-gateway/package.json` | API gateway service |
| `./services/bot-client/package.json` | Bot client service |
| `./packages/common-types/package.json` | Common types package |
| `./scripts/package.json` | Scripts package |
| `./scripts/data/import-personality/package.json` | Import scripts |

**Use this ONE command to bump ALL versions at once:**

```bash
# Replace OLD_VERSION and NEW_VERSION (e.g., beta.22 → beta.23)
sed -i 's/"version": "3.0.0-OLD_VERSION"/"version": "3.0.0-NEW_VERSION"/g' \
  ./package.json \
  ./services/ai-worker/package.json \
  ./services/api-gateway/package.json \
  ./services/bot-client/package.json \
  ./packages/common-types/package.json \
  ./scripts/package.json \
  ./scripts/data/import-personality/package.json
```

**Verify ALL files were updated:**

```bash
grep -r '"version": "3.0.0-NEW_VERSION"' --include="package.json" . | grep -v node_modules | grep -v tzurot-legacy
```

**Anti-pattern (causes inconsistent versions across packages):**

```bash
# ❌ WRONG - Only updates root package.json!
# Editing just ./package.json manually
```

### Creating a Release PR to main

**When:** Ready to deploy develop to production (main branch)

**Process:**

1. **Check current version**

   ```bash
   # Check version in package.json
   cat package.json | grep '"version"' | head -1
   # Current: "3.0.0-alpha.43" → Next: "3.0.0-alpha.44"
   ```

2. **Bump version in ALL packages (see critical section above)**

   ```bash
   # Use the sed command from the critical section above!
   sed -i 's/"version": "3.0.0-beta.22"/"version": "3.0.0-beta.23"/g' \
     ./package.json \
     ./services/ai-worker/package.json \
     ./services/api-gateway/package.json \
     ./services/bot-client/package.json \
     ./packages/common-types/package.json \
     ./scripts/package.json \
     ./scripts/data/import-personality/package.json
   ```

3. **Commit and push version bump**

   ```bash
   git add package.json services/*/package.json packages/*/package.json scripts/package.json scripts/data/import-personality/package.json
   git commit -m "chore: bump version to 3.0.0-alpha.44"
   git push origin develop
   ```

4. **Create release PR to main**

   ```bash
   # IMPORTANT: Target main, not develop!
   gh pr create --base main --head develop \
     --title "Release v3.0.0-alpha.44: [Brief description]" \
     --body "$(cat <<'EOF'
   ## Release Summary
   Brief overview of what's in this release

   ## Major Changes
   ### Feature Category 1
   - Feature A
   - Feature B

   ### Feature Category 2
   - Improvement C
   - Fix D

   ## Testing
   All X,XXX tests passing:
   - common-types: X tests
   - api-gateway: X tests
   - ai-worker: X tests
   - bot-client: X tests

   ## Deployment Verification
   ✅ All services healthy in Railway development
   ✅ Smoke tests passing
   ✅ [Other verifications]

   ## Breaking Changes
   [None, or list breaking changes]

   🤖 Generated with [Claude Code](https://claude.com/claude-code)
   EOF
   )"
   ```

5. **Review and merge**
   - Verify all commits are included
   - Merge using "Rebase and merge" (only option enabled)
   - Delete develop branch? NO - keep it for ongoing development

### Version Numbering

**Current versioning scheme: Semantic Versioning with pre-release tags**

- `3.0.0-alpha.X` - Alpha releases (current phase)
- `3.0.0-beta.X` - Beta releases (after alpha testing complete)
- `3.0.0-rc.X` - Release candidates (production-ready, final testing)
- `3.0.0` - Production release
- `3.1.0` - Minor version (new features, backward compatible)
- `3.0.1` - Patch version (bug fixes only)
- `4.0.0` - Major version (breaking changes)

**When to increment:**

- **Alpha**: Each release to main during alpha testing (increment X)
- **Beta**: Transition from alpha when core features complete
- **RC**: When ready for production, final testing phase
- **Release**: When production-ready and verified
- **Patch**: Bug fixes only, no new features
- **Minor**: New features, backward compatible
- **Major**: Breaking changes, API changes

**Release checklist:**

- [ ] Version bumped in all package.json files
- [ ] GitHub Release draft prepared with release notes
- [ ] All tests passing
- [ ] Smoke tests in development environment passed
- [ ] PR title includes version number
- [ ] PR description includes comprehensive release notes

## Related Skills

- **tzurot-docs** - Session handoff and CURRENT_WORK.md updates
- **tzurot-testing** - Always run tests before committing
- **tzurot-security** - Pre-commit security checks

## References

- Full git workflow: `CLAUDE.md#git-workflow`
- Commit message format: `CLAUDE.md#commit-messages`
- PR creation: `CLAUDE.md#standard-pr-workflow`
- Post-mortems: `CLAUDE.md#2025-07-21---the-git-restore-catastrophe`
