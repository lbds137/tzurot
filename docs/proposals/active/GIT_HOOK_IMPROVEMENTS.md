# Git Hook Infrastructure Improvements

> Created: 2026-01-07
> Status: PLANNED
> Source: MCP Council brainstorm session

## Overview

Modernize the git hook infrastructure based on council recommendations to improve developer experience, safety, and performance.

---

## Implementation Plan

### Phase 1: Quick Wins (No Dependencies)

#### 1.1 Switch to `core.hooksPath`

**Current Problem**: Hooks require manual copying via `scripts/git/install-hooks.sh`. Changes to hooks aren't effective until re-run.

**Solution**: Configure git to look directly at the source-controlled `hooks/` directory.

```bash
# Add to package.json postinstall
git config core.hooksPath hooks
```

**Changes**:

- [ ] Add `postinstall` script to root `package.json`
- [ ] Remove `scripts/git/install-hooks.sh` (no longer needed)
- [ ] Update CLAUDE.md to remove "run install-hooks" instructions
- [ ] Rename `hooks/` to `.githooks/` (conventional name)

**Effort**: 15 minutes

---

### Phase 2: Performance & Developer Experience

#### 2.1 Install Husky

**Why**: Standard tool for managing git hooks in npm projects. Auto-installs hooks on `pnpm install`.

```bash
pnpm add -D husky
```

**Changes**:

- [ ] Install husky
- [ ] Add `prepare` script: `"prepare": "husky"`
- [ ] Migrate existing hooks to `.husky/` format
- [ ] Remove old `hooks/` directory

**Note**: Husky uses `core.hooksPath` internally, so Phase 1 becomes part of this.

**Effort**: 30 minutes

---

#### 2.2 Install lint-staged

**Current Problem**: `pnpm format` runs Prettier on ALL files (~600 files, 30+ seconds).

**Solution**: Only format staged files.

```bash
pnpm add -D lint-staged
```

**Configuration** (`.lintstagedrc.json`):

```json
{
  "*.{ts,tsx}": ["prettier --write", "eslint --fix --max-warnings=0"],
  "*.{md,json,yml,yaml}": ["prettier --write"],
  "*.sql": ["prettier --write"]
}
```

**Changes**:

- [ ] Install lint-staged
- [ ] Create `.lintstagedrc.json`
- [ ] Update pre-commit hook to use `npx lint-staged`
- [ ] Remove `pnpm format` from pre-commit

**Effort**: 30 minutes

---

### Phase 3: Safety & Validation

#### 3.1 Add Secret Scanning

**Why**: AI-assisted coding increases risk of pasting API keys. GitGuardian only catches after push.

**Option A: secretlint** (Node-based, integrates with lint-staged)

```bash
pnpm add -D @secretlint/secretlint-rule-preset-recommend secretlint
```

**Option B: gitleaks** (Go binary, faster, runs standalone)

```bash
# Install via brew or download binary
brew install gitleaks
```

**Recommendation**: Use **secretlint** for integration with lint-staged, fall back to gitleaks for CI.

**Configuration** (`.secretlintrc.json`):

```json
{
  "rules": [
    {
      "id": "@secretlint/secretlint-rule-preset-recommend"
    }
  ]
}
```

**Changes**:

- [ ] Install secretlint
- [ ] Create `.secretlintrc.json`
- [ ] Add to pre-commit: `npx secretlint --secretlintrcJSON .secretlintrc.json`
- [ ] Or integrate into lint-staged config

**Effort**: 30 minutes

---

#### 3.2 Add Commitlint

**Why**: Enforce conventional commit format (`feat:`, `fix:`, etc.) for clean history.

```bash
pnpm add -D @commitlint/cli @commitlint/config-conventional
```

**Configuration** (`commitlint.config.js`):

```javascript
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      ['api-gateway', 'ai-worker', 'bot-client', 'common-types', 'hooks', 'docs', 'deps'],
    ],
    'body-max-line-length': [0], // Allow long bodies (changelogs, etc.)
  },
};
```

**Changes**:

- [ ] Install commitlint
- [ ] Create `commitlint.config.js`
- [ ] Add commit-msg hook: `npx --no -- commitlint --edit ${1}`

**Effort**: 30 minutes

---

#### 3.3 Add Branch Name Validation

**Why**: Enforce `feat/`, `fix/`, `chore/` prefixes for cleaner branch organization.

**Add to pre-push hook**:

```bash
# Validate branch name format
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ ! "$BRANCH" =~ ^(feat|fix|chore|refactor|docs|test|ci)/.+ ]] && [[ "$BRANCH" != "develop" ]] && [[ "$BRANCH" != "main" ]]; then
    echo "❌ Branch name must follow pattern: type/description"
    echo "   Valid types: feat, fix, chore, refactor, docs, test, ci"
    echo "   Example: feat/add-user-auth"
    exit 1
fi
```

**Changes**:

- [ ] Add validation to pre-push hook
- [ ] Allow `develop` and `main` branches to bypass
- [ ] Allow `scratch/` prefix for WIP branches (skips all checks)

**Effort**: 15 minutes

---

### Phase 4: Advanced (Future Consideration)

#### 4.1 Turborepo for Cached Test Runs

**Why**: Skip tests if package hasn't changed. Could reduce pre-push from 2 min to seconds.

**Deferred because**:

- Requires restructuring test commands
- Need to validate caching works correctly
- Current performance is acceptable for solo dev

**Estimated Effort**: 2-4 hours

---

## Final Hook Architecture

After implementation:

### `.husky/pre-commit`

```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# Run lint-staged (prettier, eslint, secretlint on staged files only)
npx lint-staged

# Check for dangerous Prisma migrations
./scripts/check-prisma-migrations.sh
```

### `.husky/commit-msg`

```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

npx --no -- commitlint --edit ${1}
```

### `.husky/pre-push`

```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# Validate branch name
./scripts/validate-branch-name.sh

# Skip full checks for docs-only changes
./scripts/check-push-scope.sh || exit 0

# Full checks for code changes
pnpm build
pnpm lint
pnpm test
```

---

## Migration Checklist

1. [ ] Create feature branch: `chore/git-hook-improvements`
2. [ ] Install Husky
3. [ ] Install lint-staged
4. [ ] Install secretlint
5. [ ] Install commitlint
6. [ ] Migrate existing hooks to new format
7. [ ] Test all hooks work correctly
8. [ ] Update CLAUDE.md documentation
9. [ ] Create PR

---

## Rollback Plan

If issues arise:

1. `git config --unset core.hooksPath` restores default behavior
2. Delete `.husky/` and hooks are disabled
3. Old hooks are preserved in git history

---

## Dependencies to Add

```json
{
  "devDependencies": {
    "husky": "^9.x",
    "lint-staged": "^15.x",
    "@commitlint/cli": "^19.x",
    "@commitlint/config-conventional": "^19.x",
    "@secretlint/secretlint-rule-preset-recommend": "^8.x",
    "secretlint": "^8.x"
  }
}
```

**Estimated total install size**: ~15MB

---

## Success Metrics

| Metric                        | Current        | Target               |
| ----------------------------- | -------------- | -------------------- |
| Pre-commit time (docs change) | ~35s           | <5s                  |
| Pre-push time (docs change)   | ~2min          | <5s                  |
| Hook installation             | Manual script  | Automatic            |
| Secret scanning               | Post-push only | Pre-commit           |
| Commit message validation     | None           | Conventional commits |
