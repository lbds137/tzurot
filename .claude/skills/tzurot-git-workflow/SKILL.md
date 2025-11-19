---
name: tzurot-git-workflow
description: Git workflow for Tzurot v3 - Rebase-only strategy, PR creation against develop, commit message format, and safety checks. Use when creating commits, PRs, or performing git operations.
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

## Pre-Commit Checks

The project has automated pre-commit hooks that run:
1. **TypeScript build** - All services must compile
2. **ESLint** - Code style and quality checks
3. **Tests** - All tests must pass

If pre-commit checks fail:
```bash
# Review the error
# Fix the issue
# Stage fixes
git add <fixed-files>

# Commit again
git commit -m "your message"
```

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

## References

- Full git workflow: `CLAUDE.md#git-workflow`
- Commit message format: `CLAUDE.md#commit-messages`
- PR creation: `CLAUDE.md#standard-pr-workflow`
- Post-mortems: `CLAUDE.md#2025-07-21---the-git-restore-catastrophe`
