# Critical Rules

These constraints MUST always be followed. Violations cause bugs, security issues, or data loss.

## Security (CRITICAL)

### Shell Command Safety

**This vulnerability has occurred multiple times.** Never use string interpolation in shell commands.

```typescript
// ❌ WRONG - Command injection vulnerable
execSync(`git commit -m "${message}"`);

// ✅ CORRECT - Arguments passed directly, no shell interpretation
execFileSync('git', ['commit', '-m', message]);

// ✅ OK - Static commands without interpolation
execSync('git status');
```

| Function                   | Use When                    | Safety        |
| -------------------------- | --------------------------- | ------------- |
| `execFileSync(cmd, args)`  | Any external data in args   | ✅ Safe       |
| `execSync(staticCmd)`      | Fully static command string | ✅ Safe       |
| `execSync(\`...\${var}\`)` | ❌ NEVER                    | ⚠️ Vulnerable |

### Secrets

- Never commit `.env`, credentials, tokens, API keys
- Use Railway env vars for production secrets
- Validate required env vars at startup with fail-fast

### User Input

- Validate with Zod at service boundaries
- Never trust Discord input directly
- Escape markdown in Discord embeds: `escapeMarkdown(userInput)`

### Logging (No PII)

```typescript
// ❌ WRONG - Logs PII
logger.info({ user }, 'User authenticated');

// ✅ CORRECT - Log only safe identifiers
logger.info({ userId: user.id }, 'User authenticated');
```

**NEVER log:** Emails, phones, IPs, usernames, message content, API keys
**Safe to log:** User IDs, guild IDs, channel IDs, timestamps, error codes

## Git Safety

### REBASE-ONLY Workflow

**NO SQUASH. NO MERGE COMMITS. ONLY REBASE.**

```bash
# ❌ FORBIDDEN - Creates merge commits
git merge develop
git merge --no-ff feature-branch

# ✅ CORRECT - Fast-forward only (fails if not possible)
git rebase develop
gh pr merge --rebase --delete-branch
```

**To update main from develop**: Use GitHub PR with rebase merge, or ensure fast-forward is possible.

### Destructive Commands - ASK FIRST

**NEVER run these without explicit user permission:**

| Command                       | Risk                            |
| ----------------------------- | ------------------------------- |
| `git merge`                   | Creates forbidden merge commits |
| `git restore`                 | Discards uncommitted work       |
| `git checkout .`              | Discards all changes            |
| `git reset --hard`            | Undoes commits permanently      |
| `git clean -fd`               | Deletes untracked files         |
| `git push --force`            | Rewrites history                |
| `killall node` / `pkill node` | Kills Claude Code               |
| `rm -rf` on gitignored paths  | Data is UNRECOVERABLE           |

**Uncommitted changes = HOURS OF WORK.** When user says "get changes" → COMMIT, not DISCARD.

### Before Code Changes

1. Read the ENTIRE file first
2. Never modify files you haven't read
3. Make ONLY the requested change

### Never Merge PRs Without User Approval

CI passing != merge approval. User must explicitly request merge.

## Testing

- **NEVER modify tests to make them pass** - fix the implementation
- **Coverage required**: 80% minimum, Codecov blocks PRs below threshold
- Run tests before pushing - no exceptions

### Test Coverage Baseline

- **NEVER add NEW code to `knownGaps` baseline** - write proper tests instead
- `knownGaps` is for pre-existing tech debt, not new features
- When audit fails with "NEW gaps", fix by adding tests, not by updating baseline
- File: `.github/baselines/test-coverage-baseline.json`

## Project Rules

### No Backward Compatibility

One-person project. Make the cleanest change, even if breaking.

### Verify Before Accepting External Feedback

Automated reviewers can be wrong. Check schema/source/tests before implementing suggestions.

### Mandatory Global Discovery ("Grep Rule")

Before modifying config/infrastructure: Search ALL instances → List affected files → Justify exclusions.
