# Git and Version Control Scripts

Scripts for managing SSH setup and branch synchronization.

## Git Hooks

Git hooks are now managed by **Husky** and are automatically installed when you run `pnpm install`.

Hook configuration:

- `.husky/pre-commit` - lint-staged (prettier, eslint, secretlint) + Prisma migration safety
- `.husky/commit-msg` - commitlint (conventional commits)
- `.husky/pre-push` - branch validation + Turbo build/lint/test

Related configs:

- `.lintstagedrc.json` - lint-staged configuration
- `.secretlintrc.json` - secretlint rules
- `commitlint.config.cjs` - commit message rules
- `turbo.json` - Turborepo task caching

## Scripts

- **git-with-ssh.sh** - Wrapper for git commands using SSH authentication
- **setup-ssh.sh** - Configure SSH keys for git operations
- **sync-develop.sh** - Sync develop branch with remote

## Usage

```bash
# Use git with SSH
./scripts/git/git-with-ssh.sh push origin develop

# Sync develop branch
./scripts/git/sync-develop.sh
```
