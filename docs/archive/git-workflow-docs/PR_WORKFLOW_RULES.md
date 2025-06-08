# PR Workflow Rules

## 🚨 CRITICAL: PR Target Branch Rules

### NEVER create PRs directly to main except:
1. **Syncing develop → main** (periodic releases)
2. **Emergency hotfixes** (with team approval)

### ALWAYS create PRs to develop for:
1. **Feature branches** (`feat/*`, `feature/*`)
2. **Bug fixes** (`fix/*`, `bugfix/*`)
3. **Refactoring** (`refactor/*`)
4. **Documentation** (`docs/*`)
5. **Testing** (`test/*`)
6. **Any other work branches**

## Correct Workflow

```
feature/my-feature → develop → main
       ↑                ↑         ↑
    Your Work      Integration  Production
```

## How to Create a PR

### For Feature Work:
```bash
# From your feature branch
gh pr create --base develop --title "feat: your feature description"
```

### For Syncing develop to main:
```bash
# From develop branch
gh pr create --base main --title "release: sync develop to main"
```

## Common Mistakes to Avoid

❌ **DON'T**: `gh pr create --base main` (from feature branches)
✅ **DO**: `gh pr create --base develop`

❌ **DON'T**: Merge directly to main
✅ **DO**: Merge to develop, then sync develop to main

❌ **DON'T**: Use GitHub's default base branch without checking
✅ **DO**: Always verify the base branch before creating PR

## Branch Protection Rules

- **main**: Protected, only accepts PRs from develop
- **develop**: Protected, accepts PRs from feature branches
- Both branches require:
  - PR reviews
  - Passing tests
  - No direct pushes

## Recovery Procedure

If someone accidentally merges to main instead of develop:

1. Don't panic
2. Notify the team
3. Follow the branch recovery procedure in `BRANCH_RECOVERY.md`

## GitHub CLI Aliases

Add these to your shell profile for safety:

```bash
# Safe PR creation - defaults to develop
alias pr-create='gh pr create --base develop'

# Explicit PR to main (requires confirmation)
alias pr-to-main='echo "⚠️  Creating PR to main - are you sure? (Ctrl+C to cancel)" && read && gh pr create --base main'
```

Remember: When in doubt, target develop!