---
name: tzurot-git-workflow
description: 'Git workflow procedures. Invoke with /tzurot-git-workflow for commit, PR, and release procedures.'
lastUpdated: '2026-03-09'
---

# Git Workflow Procedures

**Invoke with /tzurot-git-workflow** for step-by-step git operations.

**Safety rules are in `.claude/rules/00-critical.md`** - they apply automatically.

## Commit Procedure

### 1. Stage Changes

```bash
git status                    # Review what's changed
git add <specific-files>      # Stage specific files (preferred)
# Or: git add -p              # Interactive staging
```

### 2. Create Commit

```bash
git commit -m "$(cat <<'EOF'
feat(scope): short description

Longer explanation of what and why.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

**Types:** `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`
**Scopes:** `ai-worker`, `api-gateway`, `bot-client`, `common-types`, `ci`, `deps`

### 3. Push

```bash
pnpm test && git push -u origin <branch>
```

## PR Procedure

### Create PR

```bash
# 1. Ensure on feature branch, up-to-date with develop
git checkout develop && git pull origin develop
git checkout feat/your-feature
git rebase develop

# 2. Push and create PR
git push -u origin feat/your-feature
gh pr create --base develop --title "feat: description"
```

### Arm CI monitor (required)

Immediately after `gh pr create` — and after any subsequent `git push` to an open PR — start a `Monitor` that waits for CI to complete and reports new review comments back. **Do not skip this step and do not wait for the user to ask about CI status.**

The `.claude/hooks/pr-monitor-reminder.sh` PostToolUse hook auto-fires on `git push` / `gh pr create` and injects a reminder with the Monitor invocation pre-filled with the current PR number. Use that when you see it; the template below is the fallback shape if you're arming manually:

```
Monitor({
  description: "CI + reviews for PR <N>",
  command: 'gh pr checks <N> --watch --interval=30 > /dev/null 2>&1; echo "CI_COMPLETE"; gh pr checks <N>',
  timeout_ms: 900000
})
```

When the monitor fires:

1. Inspect the final `gh pr checks <N>` output for pass/fail.
2. Fetch new review comments: `gh api /repos/lbds137/tzurot/issues/<N>/comments` (no bot-only filter — human reviewer comments matter too). Dedup by tracking `created_at` of the last-reported comment.
3. Report CI status + new reviewer feedback in one concise message. Group findings as blocking vs. non-blocking.
4. Don't fix anything without user approval — report only. User decides in-PR vs. backlog.

If the monitor completes without a `CI_COMPLETE` line in its output, the 15-min timeout fired first — re-arm rather than assume CI passed. If CI fails or CodeQL flags something, use `PushNotification` — the user should hear about it before their next turn.

### After PR Merged

```bash
git checkout develop
git pull origin develop
git branch -d feat/your-feature
```

## Rebase Procedure

```bash
git checkout develop && git pull origin develop
git checkout feat/your-feature
git rebase develop

# If conflicts:
# 1. Edit files to resolve
# 2. git add <resolved>
# 3. git rebase --continue
# Repeat until done

git push --force-with-lease origin feat/your-feature
```

## Release Procedure

### 1. Version Bump

```bash
# Option A: Changesets (recommended)
pnpm changeset
pnpm changeset:version
git add . && git commit -m "chore: version packages"

# Option B: Manual
pnpm bump-version 3.0.0-beta.XX
git commit -am "chore: bump version to 3.0.0-beta.XX"
```

### 2. Write Release Notes

Write release notes following the Conventional Changelog format defined in `.claude/rules/05-tooling.md`.

**Source of truth**: `git log v<previous-tag>..HEAD --no-merges` — NOT CURRENT.md.
CURRENT.md tracks session work; release notes track what shipped between tags.
Using CURRENT.md caused duplicate entries in beta.94 (items from beta.93 re-listed).

```bash
# 1. Find the previous release tag
git tag --list "v3.0.0-beta.*" --sort=-version:refname | head -1

# 2. List actual commits for this release
git log v<previous>..HEAD --no-merges --oneline

# 3. Cross-check: every release note item must map to a commit in that range
# 4. Cross-check: no item should appear in the previous release's notes
```

### 3. Create Release PR

```bash
gh pr create --base main --head develop --title "Release v3.0.0-beta.XX: Description"
```

### 4. Merge Release PR

⚠️ **NEVER use `--delete-branch` for release PRs.** `develop` is a long-lived branch.

```bash
# ✅ CORRECT - Merge without deleting develop
gh pr merge <number> --rebase

# ❌ FORBIDDEN - Would delete develop!
gh pr merge <number> --rebase --delete-branch
```

### 5. After Merge to Main

```bash
git fetch --all
git checkout main && git pull origin main
git checkout develop && git pull origin develop
git rebase origin/main
git push origin develop --force-with-lease
```

### 6. Tag and Push

Git tag + GitHub Release are **separate** things. The merge does neither — you must:

```bash
# On main (after the pull above)
git checkout main
git tag -a v3.0.0-beta.XX -m "Release v3.0.0-beta.XX: Description"
git push origin v3.0.0-beta.XX
```

### 7. Create GitHub Release

The tag is git metadata; the GitHub Release is the user-facing page with notes.
Both are needed. Use the same release notes prepared in step 2:

```bash
gh release create v3.0.0-beta.XX \
  --title "v3.0.0-beta.XX" \
  --prerelease \
  --notes "$(cat <<'EOF'
### Bug Fixes
- ...

### Improvements
- ...

**Full Changelog**: https://github.com/lbds137/tzurot/compare/v3.0.0-beta.YY...v3.0.0-beta.XX
EOF
)"
```

`--prerelease` flag is used for all `-beta.*` tags (match existing convention
via `gh release list`).

### 8. Reset CURRENT.md Unreleased Section

After a release merges to main, reset the "Unreleased on Develop" section in
CURRENT.md to only track items since the new release tag. Failing to do this
caused duplicate entries in the beta.94 release notes (items from beta.93
were re-listed because CURRENT.md still tracked them).

## GitHub CLI (Use ops instead of broken `gh pr edit`)

```bash
pnpm ops gh:pr-info 478        # Get PR info
pnpm ops gh:pr-reviews 478     # Get reviews
pnpm ops gh:pr-comments 478    # Get line comments
pnpm ops gh:pr-edit 478 --title "New title"
```

## References

- GitHub CLI: `docs/reference/GITHUB_CLI_REFERENCE.md`
- Safety rules: `.claude/rules/00-critical.md`
