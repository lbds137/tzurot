---
name: tzurot-git-workflow
description: 'Git workflow procedures. Invoke with /tzurot-git-workflow for commit, PR, and release procedures.'
lastUpdated: '2026-07-04'
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

**Types:** `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `debug`
(`debug` = temporary diagnostic instrumentation, added then removed; see `.claude/rules/05-tooling.md` § "The `debug` type" for when to use it vs. `chore`/`feat`.)
**Scopes:** `ai-worker`, `api-gateway`, `bot-client`, `common-types`, `ci`, `deps`

**Command-shape rules for commit/push** (each class cost multiple cycles in practice):

- Chain with `&&`, never `;` — a hook-rejected commit must halt the chain; with `;` the dead commit flows into a push that no-ops as "Everything up-to-date" and the rejection reason scrolls away.
- **Never filter commit/push output** through `grep`/`tail`/`head` — hook rejections (commitlint, pre-push gate) get swallowed and cost a blind re-diagnosis cycle. Read the full output; it's short when things work and essential when they don't.
- **Pass `timeout: 600000`** on Bash calls that commit or push — lint-staged + the pre-push gate run the full local pipeline (minutes); default timeouts kill mid-hook and leave ambiguous state (commit landed, push didn't).
- In compound commands that `cd` into a package, run the git step as `git -C <repo-root> …` (or with absolute paths) — repo-relative pathspecs break after the cd, failing AFTER the tests already passed.
- Canonical push-verify (don't improvise greps — a pattern starting with `-` parses as an option flag). Use this `ls-remote` form when you need a scriptable boolean; the `-> branch` ref-update line / `git status -sb` check below is the quick visual form — same goal, pick by context:

```bash
test "$(git rev-parse HEAD)" = "$(git ls-remote origin "refs/heads/<branch>" | cut -f1)" && echo PUSH_LANDED
```

### 3. Push

```bash
pnpm test && git push -u origin <branch>
```

**Verify every push actually landed** before proceeding (and before arming the
CI Monitor): confirm the `-> branch` ref-update line in the push output, or
`git status -sb` showing in-sync. Backgrounded pushes reporting exit 0 AND
foreground pushes with `| tail`/`| grep`-filtered output have both hidden
failed transfers.

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
  command: 'sleep 60; gh pr checks <N> --watch --interval=30 > /dev/null 2>&1; sleep 5; echo "CI_COMPLETE"; gh pr checks <N>',
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

4. Apply review feedback per `.claude/rules/08-review-response.md` — trivial-shape edits auto-apply (test-gated fixup commits), semantic-shape edits ASK; batch-present all items in one end-of-round message.

The #1-without-#2 failure mode is worth guarding against: all-green CI feels complete, but new review comments can still carry blocking findings or non-blocking observations the user wants to triage.

The #2-without-full-body failure mode is the second trap: fetching comments but extracting only the summary section. A review that ends "**Summary**: two actionable items" almost always has a body with additional items that weren't promoted to the summary.

If the monitor completes without a `CI_COMPLETE` line in its output, the 15-min timeout fired first — re-arm rather than assume CI passed. If CI fails or CodeQL flags something, use `PushNotification` — the user should hear about it before their next turn.

**Merge gate is green-only.** Per `.claude/rules/00-critical.md` "Never Merge PRs Without Completed CI": every check must be green before `gh pr merge` runs, including release PRs. If a check fails for what looks like infrastructure reasons (binary not found, missing secret, action-setup error), `gh run rerun <run-id> --failed` and re-arm the Monitor — don't merge through the red. The release procedure below assumes a green pipeline.

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

## Claude workflow changes target `main`, not `develop`

GitHub Actions that validate against the **default branch (`main`)** — notably **`claude-review`** and the `@claude` responder — refuse to run on a PR unless **their own workflow file** is byte-identical to the version on `main`. A "security skip": it stops an untrusted PR from altering the very workflow that reviews it.

**Scope — the validation is file-scoped.** Only the self-validating claude workflow files (`claude-code-review.yml`, `claude.yml`) trigger the skip; a PR carrying drift in any OTHER workflow file still gets a real review (empirically confirmed: a PR with ci.yml drift received a full claude-review). Non-claude workflows (`ci.yml`) also _execute_ from the PR's own branch, so **routine `ci.yml` edits ride normal develop PRs like any code change** — no main-cut ceremony. `pnpm ops guard:workflow-sync` enforces exactly this scope (claude files only).

**Consequence**: a change to one of the **claude workflow files** that lands on `develop` first **silently disables those reviews on every PR** — they pass as a green ~10-15s no-op (`"Skipping action due to workflow validation"`, no review posted) — until the change reaches `main`. Under the normal flow that's only at the next release, and the release PR's own review skips too, so it compounds across the whole cycle.

**Rule**: For any change to `claude-code-review.yml` or `claude.yml`, open a PR **cut from `main` and targeting `main`** — never branch from `develop` for this (a develop-based branch targeting `main` drags all of develop's unmerged commits into the diff). The moment it merges, run `pnpm ops release:finalize` to resync `develop` onto `main` — do this before other work piles onto `develop`, since every commit added there (and every open feature branch) then needs rebasing onto the resynced `develop`. Do NOT let a claude-workflow change reach `main` via the routine `develop→main` release merge.

**This bites most often with dependabot** bumps that touch the claude workflow files (e.g. an `actions/checkout` major bump usually edits every workflow, claude ones included) — dependabot opens them against `develop`. When a dependabot PR (or any PR) touches `claude-code-review.yml`/`claude.yml`, **cherry-pick just those workflow hunks into a fresh `main`-cut PR** and merge that first, rather than letting the change reach `develop`; the ci.yml hunk of the same bump can ride develop normally. (There's no `@dependabot retarget` command; re-pointing a develop-based PR's base at `main` via the GitHub UI would drag all of develop's unmerged commits into the diff, so cherry-picking the hunk is the clean path.)

**Recovery — a claude-workflow change already landed on `develop`** (the disruptive case; infrequent but real):

1. Branch off `main`, sync just the affected workflow file(s) to develop's state (`git checkout origin/develop -- .github/workflows/<file>`), commit, PR against `main`. (Pattern: PR #1318 — `actions/checkout` bump.)
2. Merge to `main` (needs explicit approval — `main` always does).
3. Rebase `develop` onto `main` so the two don't diverge on the workflow file (`pnpm ops release:finalize`, or manual `git rebase origin/main` + `--force-with-lease`).
4. **Order matters — do step 3 first.** For each open PR: rebase the feature branch onto the updated `develop` (`git rebase develop`) and push. The push itself re-triggers the review on the new HEAD, which now carries the updated workflow in its ancestry — so the validation passes. Do **not** reach for `gh run rerun`: it re-runs the _old_ commit's checkout, whose workflow bytes still mismatch `main`, so it keeps skipping. The rebase-push is the only reliable trigger (the PR's review validates the PR branch's _own_ HEAD workflow against `main`).

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

**Security preflight first**: check open Dependabot PRs and the GitHub security
tab before cutting the release — the user has repeatedly been the one to notice
new advisories mid-release, and a fixable vuln is cheaper to ride along than to
hotfix after.

```bash
gh pr list --author "app/dependabot" --state open
gh api repos/{owner}/{repo}/dependabot/alerts --jq '[.[] | select(.state=="open")] | length'
```

```bash
gh pr create --base main --head develop --title "Release v3.0.0-beta.XX: Description"
```

### 4. Pre-Merge Migration (if release includes one)

Run migrations **before** merging — Railway auto-deploys every service the moment the release PR merges to `main`, so migrating _after_ leaves new code on the old schema for the deploy window (the beta.140 `column ... does not exist` incident). Migrate first, while prod still runs the old code:

```bash
pnpm ops release:premigrate --dry-run   # preview the new migrations in the release range
pnpm ops release:premigrate             # apply to prod, THEN proceed to merge
```

Skip if the release has no migration — `release:premigrate` detects this and exits cleanly (or check `git log v<previous>..HEAD --no-merges -- prisma/migrations/`). Safe for **additive** migrations (old code ignores the new column/table/constraint). **Destructive** migrations (drop/rename a column, tighten a constraint on existing data) invert the window and need a brief maintenance window — `release:premigrate` refuses them without `--allow-destructive`. See `.claude/rules/03-database.md` § Deployment.

### 5. Merge Release PR

⚠️ **NEVER use `--delete-branch` for release PRs.** `develop` is a long-lived branch.

⚠️ **Wait for every CI check to be green** per `.claude/rules/00-critical.md` "Never Merge PRs Without Completed CI". Release PRs are not exempt — claude-review is the second-look on the full release delta and infra failures (binary not found, missing secret) need `gh run rerun <run-id> --failed` before merge, not "merge through it."

⚠️ **When assessing release safety, do NOT cite "soaked in dev".** Dev has no organic traffic — a dev deploy proves boot, not behavior (see `/tzurot-deployment` § "What a dev deploy proves"). The honest safety basis is per-PR CI + reviews, the holistic release review, and blast-radius analysis of runtime-unverified paths.

```bash
# ✅ CORRECT - Merge without deleting develop (only after all checks green)
gh pr merge <number> --rebase

# ❌ FORBIDDEN - Would delete develop!
gh pr merge <number> --rebase --delete-branch
```

#### Fallback for large PRs: fast-forward when rebase-merge chokes

GitHub's "Rebase and merge" replays every PR commit onto `main` as **new** commits. On a release PR with a large commit range (observed failing at ~200 commits, beta.126 / PR #1120), the API rejects the merge and the web UI falsely reports merge conflicts — even though `gh pr view <N> --json mergeable,mergeStateStatus` returns `MERGEABLE` / `CLEAN`. `--admin` does **not** help; this is a mechanical rebase failure, not a branch-protection block. The error to grep this skill for when you hit it:

```
GraphQL: This branch can't be rebased (mergePullRequest)
```

When this happens, fast-forward `main` to `develop` instead. Because every release leaves `main` an ancestor of `develop` (step 6 rebases develop onto main, and all new work piles onto develop), this is a clean fast-forward — and it's actually _cleaner_ than the button: it keeps develop's original SHAs, so `main` and `develop` end byte-identical and **step 6's `release:finalize` becomes a no-op** (no SHA divergence to repair).

**Two guardrails are mandatory — do not skip either:**

1. **Attempt `gh pr merge <N> --rebase` FIRST**, even when you expect it to fail. That command fires the `pr-merge-review-check.sh` PreToolUse gate (`00-critical.md`), which forces the latest `claude-review` into context before any merge. **Distinguish the two failure modes**: the gate blocks _once_ by injecting the review into stderr and exiting non-zero — engage with the review and retry the same command; if that retry _also_ fails with the `can't be rebased` error above, the merge has failed mechanically and you proceed to the FF. A bare `git push` to `main` does **not** trigger that gate, so the FF is only safe _after_ the gate has been satisfied by a real `gh pr merge` attempt in the same session. (If the session restarts between the failed attempt and the FF push, re-attempt `gh pr merge --rebase` once more first — the acked comment-id persists, so the hook won't re-block, but the re-attempt re-establishes that the review is in context.)
2. **Verify `main` is an ancestor of `develop`** — `git merge --ff-only` refuses (loudly, no side effects) if `main` has diverged (e.g. a hotfix landed directly on main). If it refuses, do NOT force anything: rebase develop onto main first (`git checkout develop && git rebase origin/main && git push --force-with-lease`), then retry the FF.

```bash
# Only after `gh pr merge --rebase` has fired the review gate AND failed mechanically:
git fetch --all                            # REQUIRED: refresh origin/develop — `git pull origin main`
                                           # below does NOT fetch it, so the FF could land a stale develop
git checkout main && git pull origin main
git merge --ff-only origin/develop         # fast-forward; refuses if main diverged
git push origin main                       # FF push — NOT a force-push
# GitHub auto-closes the PR as MERGED once its head commits land on main.
```

This is a **permitted, documented merge path** for the large-PR case — not a workaround to reach for casually. For normal-sized release PRs, `gh pr merge --rebase` remains the default (it's contributor-agnostic and fires the gate directly). Reserve the FF for when rebase-merge mechanically fails.

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
Both are needed. Use the same release notes prepared in step 2.

**Release-channel convention**: the **newest** release holds GitHub's **`latest`**
badge (`prerelease=false`); **every older** beta is `prerelease=true`. The `latest`
badge is how users/tooling find the current build, and a prerelease can't hold it.
This is NOT automatic — without the two commands below the newest tag stays a plain
release and the previous one keeps `latest`, so both steps are required each release.

```bash
# Create the newest release as `latest` (NOT --prerelease — they're mutually exclusive)
gh release create v3.0.0-beta.XX \
  --title "v3.0.0-beta.XX" \
  --latest \
  --notes "$(cat <<'EOF'
### Bug Fixes
- ...

### Improvements
- ...

**Full Changelog**: https://github.com/lbds137/tzurot/compare/v3.0.0-beta.YY...v3.0.0-beta.XX
EOF
)"

# Flip the PREVIOUS newest to prerelease. Creating vXX as --latest removes vYY's
# latest badge but leaves it a plain release, so this explicit flip is required.
gh release edit v3.0.0-beta.YY --prerelease
```

Verify with `gh release list --limit 5 --json tagName,isPrerelease,isLatest --jq '.[] | {tagName, isPrerelease, isLatest}'`:
the newest must read `prerelease=false / latest=true`, every older beta `prerelease=true / latest=false`.
Older betas (beyond the immediately-previous) are already prerelease from past releases —
only the immediately-previous tag needs flipping each time. **Do NOT** mark the newest
tag `--prerelease`; that's the old (wrong) instruction this step replaces.

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
