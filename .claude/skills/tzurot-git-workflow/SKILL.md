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

When the monitor fires, **all four** of the following must happen — do not stop after #1 even when every check passed:

1. Inspect the final `gh pr checks <N>` output for pass/fail.
2. Fetch new reviewer feedback via three endpoints (GitHub splits them; the raw `/issues/N/comments` call silently misses inline line comments):
   - `pnpm ops gh:pr-comments <N>` — conversation + inline line-level review comments
   - `pnpm ops gh:pr-reviews <N>` — review summaries (Approve / Request Changes)
   - `pnpm ops gh:pr-info <N>` — PR-level state

   No bot-only filter — human reviewer comments matter too. Dedup by tracking `created_at` of the last-reported comment.

3. Report CI status **and** new reviewer feedback in one concise message. Group findings as blocking vs. non-blocking. If no new reviews since the last push, say so explicitly — silence is not a substitute for "no new comments."

   **Read the body, not just the summary.** Reviewer output is tiered: verdict → strengths → major items → minor items → observations → summary. The trailing "Summary" / "Actionable items" section is a reviewer's shortcut; it frequently under-reports items the body flags in detail. When a review is 100+ lines, treat length as a skimming red flag — walk every `###` section before calling the report done. Cross-check: if codecov flags missing lines, grep the review body for a corresponding test-gap call-out.

   **Each `claude[bot]` entry is a separate review cycle.** If multiple exist (pre-rebase + post-rebase, push + re-push), read every one — don't assume only the latest matters. Track `created_at` of the last-reported comment so future fetches dedup correctly across session boundaries.

4. Don't fix anything without user approval — report only. User decides in-PR vs. backlog.

The #1-without-#2 failure mode is worth guarding against: all-green CI feels complete, but new review comments can still carry blocking findings or non-blocking observations the user wants to triage.

The #2-without-full-body failure mode is the second trap: fetching comments but extracting only the summary section. A review that ends "**Summary**: two actionable items" almost always has a body with additional items that weren't promoted to the summary.

If the monitor completes without a `CI_COMPLETE` line in its output, the 15-min timeout fired first — re-arm rather than assume CI passed. If CI fails or CodeQL flags something, use `PushNotification` — the user should hear about it before their next turn.

**Merge gate is green-only.** Per `.claude/rules/00-critical.md` "Never Merge PRs With Red CI": every check must be green before `gh pr merge` runs, including release PRs. If a check fails for what looks like infrastructure reasons (binary not found, missing secret, action-setup error), `gh run rerun <run-id> --failed` and re-arm the Monitor — don't merge through the red. The release procedure below assumes a green pipeline.

### After PR Merged

```bash
git checkout develop
git pull origin develop
git branch -d feat/your-feature
```

## Dependabot PR Recovery

Dependabot PRs have three distinct cleanup paths — using the wrong one wastes a cycle or produces a forbidden merge-commit state.

| Situation                                                                                       | Command                             | Effect                                                                                                                                        |
| ----------------------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch is behind develop, dependabot is the only committer                                      | `@dependabot rebase` (PR comment)   | Dependabot rebases its own branch onto develop and regenerates the lockfile. PR number preserved, CI reruns.                                  |
| Branch has a non-dependabot commit (e.g., GitHub's "Update branch" button added a merge commit) | `@dependabot recreate` (PR comment) | Dependabot **closes the existing PR** and opens a **new** one against current develop. PR number changes; any prior review comments are lost. |
| Need to abandon the bump entirely                                                               | `gh pr close` or let it age out     | Dependabot will re-open on next schedule unless the dep is added to `ignore:` in `dependabot.yml`.                                            |

**Key constraint**: `@dependabot rebase` **refuses to run** if any commit on the branch is authored by someone other than dependabot. GitHub's "Update branch" UI button appears to rebase, but it actually adds a merge commit authored by `github-actions[bot]` — which poisons the branch for `rebase`. Once that happens, `recreate` is the only in-band recovery.

**Rule of thumb**: don't hit "Update branch" on dependabot PRs. Use the chat command. If you do hit it by accident, don't waste time on `rebase` — go straight to `recreate`.

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

⚠️ **Wait for every CI check to be green** per `.claude/rules/00-critical.md` "Never Merge PRs With Red CI". Release PRs are not exempt — claude-review is the second-look on the full release delta and infra failures (binary not found, missing secret) need `gh run rerun <run-id> --failed` before merge, not "merge through it."

```bash
# ✅ CORRECT - Merge without deleting develop (only after all checks green)
gh pr merge <number> --rebase

# ❌ FORBIDDEN - Would delete develop!
gh pr merge <number> --rebase --delete-branch
```

### 5. Run Prisma Migration (if release includes one)

Prod auto-deploys on merge to `main` (see `tzurot-deployment` skill), but **schema changes do NOT auto-apply**. Run the migration immediately after merge to minimize the window where new code runs against the pre-migration schema:

```bash
pnpm ops db:migrate --env prod
```

For backward-compatible migrations (column type widening, additive indexes), the small window is low-risk because old code can still read the new schema. For breaking schema changes, sequence carefully — either run the migration first if old code can tolerate the new schema, or coordinate a brief maintenance window.

Skip this step if the release contains no migration. Verify with `git log v<previous>..HEAD --no-merges -- prisma/migrations/` — empty output means no migration to run.

### 6. After Merge to Main

Rebase develop onto main so their SHAs stay aligned. Skipping this step causes the next release PR to show apparent "conflicts with main" that aren't real (content is identical, just different SHAs).

**Preferred — automated:**

```bash
pnpm ops release:finalize           # Interactive: prompts before force-push
pnpm ops release:finalize --yes     # Skip the prompt (non-TTY safe)
pnpm ops release:finalize --dry-run # Preview the steps without executing
```

The command runs the full `fetch → checkout main → pull → checkout develop → pull → rebase origin/main → push --force-with-lease` sequence with safety rails: refuses on dirty working tree, no-op exit when already aligned, aborts rebase cleanly on conflicts.

**Manual fallback (if the tool is broken or you need step-by-step debugging):**

```bash
git fetch --all
git checkout main && git pull origin main
git checkout develop && git pull origin develop
git rebase origin/main
git push origin develop --force-with-lease
```

### 7. Tag and Push

Git tag + GitHub Release are **separate** things. The merge does neither — you must:

```bash
# On main (after the pull above)
git checkout main
git tag -a v3.0.0-beta.XX -m "Release v3.0.0-beta.XX: Description"
git push origin v3.0.0-beta.XX
```

### 8. Create GitHub Release

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

### 9. Reset CURRENT.md Unreleased Section

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
