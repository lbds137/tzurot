# Git and Version Control Scripts

Scripts for managing git hooks, SSH setup, and branch synchronization.

## Scripts

- **install-hooks.sh** - Install pre-commit hooks from `hooks/` to `.git/hooks/`
- **pre-commit-hook** - Legacy pre-commit hook (source-controlled hooks now in `hooks/`)
- **setup-pre-commit.sh** - Initial pre-commit hook setup
- **git-with-ssh.sh** - Wrapper for git commands using SSH authentication
- **setup-ssh.sh** - Configure SSH keys for git operations
- **sync-develop.sh** - Sync develop branch with remote

## Usage

```bash
# Install git hooks
./scripts/git/install-hooks.sh

# Use git with SSH
./scripts/git/git-with-ssh.sh push origin develop
```
