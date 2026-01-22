# GitHub CLI (gh) Reference

**GitHub CLI Version**: 2.65.0
**Last Updated**: 2025-11-28
**Purpose**: Accurate command reference to prevent errors from outdated AI training data

---

## ⚠️ Critical Notes

### 🚨 USE OPS CLI FOR PR COMMENTS/REVIEWS

**`gh pr view` and `gh pr edit` are FLAKY** due to GitHub's "Projects (classic) deprecation" GraphQL error. **Use the ops CLI instead:**

```bash
# ✅ PREFERRED - Reliable ops commands
pnpm ops gh:pr-comments 499     # Get all comments
pnpm ops gh:pr-reviews 499      # Get all reviews
pnpm ops gh:pr-conversation 499 # Get conversation comments
pnpm ops gh:pr-all 499          # Get everything
pnpm ops gh:pr-edit 499 --title "New title"  # Edit PR

# ❌ FLAKY - May fail with GraphQL errors
gh pr view 499 --comments
gh pr edit 499 --title "..."
```

### Comment Types in Pull Requests

**There are THREE types of comments on a PR - they use DIFFERENT API endpoints!**

| Type                | Description                    | API Endpoint                                 | gh command                      |
| ------------------- | ------------------------------ | -------------------------------------------- | ------------------------------- |
| **Issue Comments**  | General PR conversation        | `/repos/{owner}/{repo}/issues/{pr}/comments` | `gh pr view --json comments`    |
| **Review Comments** | Line-specific comments on diff | `/repos/{owner}/{repo}/pulls/{pr}/comments`  | `gh api ...pulls/{pr}/comments` |
| **Reviews**         | Formal reviews (APPROVE, etc.) | `/repos/{owner}/{repo}/pulls/{pr}/reviews`   | `gh pr view --json reviews`     |

**Common Mistake**: Using `/pulls/{pr}/comments` when you want issue comments (general discussion).

### Projects API Deprecation

**`projectCards` is deprecated!** GitHub Projects v2 uses `projectItems` instead.

```bash
# ❌ DEPRECATED - Will be empty or fail
gh pr view --json projectCards

# ✅ CORRECT - GitHub Projects v2
gh pr view --json projectItems
```

**Scope Required**: Working with projects requires the `project` scope:

```bash
gh auth refresh -s project
```

---

## Pull Request Commands

### View PR

```bash
# View current branch's PR in terminal
gh pr view

# View specific PR by number
gh pr view 123

# View in browser
gh pr view 123 --web

# Get PR as JSON (useful for automation)
gh pr view 123 --json number,title,body,state,comments
```

**Available JSON fields**: `additions`, `assignees`, `author`, `autoMergeRequest`, `baseRefName`, `baseRefOid`, `body`, `changedFiles`, `closed`, `closedAt`, `comments`, `commits`, `createdAt`, `deletions`, `files`, `fullDatabaseId`, `headRefName`, `headRefOid`, `headRepository`, `headRepositoryOwner`, `id`, `isCrossRepository`, `isDraft`, `labels`, `latestReviews`, `maintainerCanModify`, `mergeCommit`, `mergeStateStatus`, `mergeable`, `mergedAt`, `mergedBy`, `milestone`, `number`, `potentialMergeCommit`, `projectCards`, `projectItems`, `reactionGroups`, `reviewDecision`, `reviewRequests`, `reviews`, `state`, `statusCheckRollup`, `title`, `updatedAt`, `url`

### Create PR

```bash
# Basic PR creation (opens editor for title/body)
gh pr create

# With title and body directly
gh pr create --title "feat: add new feature" --body "Description here"

# Specify base branch (IMPORTANT for Tzurot - always use develop!)
gh pr create --base develop --title "feat: add new feature"

# Using HEREDOC for multiline body (recommended for Claude Code)
gh pr create --base develop --title "feat: your feature" --body "$(cat <<'EOF'
## Summary
- Change 1
- Change 2

## Test plan
- [ ] Test step 1

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"

# Fill from commits automatically
gh pr create --fill

# Create draft PR
gh pr create --draft --title "WIP: feature"

# Add labels and reviewers
gh pr create --label "enhancement" --reviewer username
```

### Edit PR

**⚠️ KNOWN BUG**: `gh pr edit` fails with "Projects (classic) deprecation" error even on latest versions (2.65.0+). This is a [known issue](https://github.com/cli/cli/issues/11983) with no fix as of November 2025.

```bash
# ❌ BROKEN - Will fail with GraphQL error
gh pr edit 123 --body "new body"
gh pr edit 123 --body-file body.md
gh pr edit 123 --title "new title"

# ✅ WORKAROUND - Use REST API directly
gh api -X PATCH repos/{owner}/{repo}/pulls/123 -f body="new body"
gh api -X PATCH repos/{owner}/{repo}/pulls/123 -f body="$(cat body.md)"
gh api -X PATCH repos/{owner}/{repo}/pulls/123 -f title="new title"

# ✅ Update both title and body
gh api -X PATCH repos/{owner}/{repo}/pulls/123 \
  -f title="new title" \
  -f body="$(cat body.md)"
```

### Add Comment to PR

```bash
# Add comment with body
gh pr comment 123 --body "Your comment here"

# Read body from file
gh pr comment 123 --body-file comment.md

# Read from stdin
echo "My comment" | gh pr comment 123 --body-file -

# Open editor
gh pr comment 123 --editor
```

### Check PR Status

```bash
# View CI checks for current branch's PR
gh pr checks

# View CI checks for specific PR
gh pr checks 123

# Wait for checks to complete
gh pr checks 123 --watch

# Only show required checks
gh pr checks 123 --required

# Get checks as JSON
gh pr checks 123 --json name,state,bucket,conclusion
```

**Exit codes**:

- 0: All checks passed
- 1: Error
- 8: Checks still pending

### Merge PR

```bash
# Merge with default method
gh pr merge 123

# Rebase and merge (required for Tzurot)
gh pr merge 123 --rebase

# Squash and merge
gh pr merge 123 --squash

# Delete branch after merge
gh pr merge 123 --rebase --delete-branch

# Auto-merge when checks pass
gh pr merge 123 --auto --rebase
```

### List PRs

```bash
# List open PRs
gh pr list

# List with specific state
gh pr list --state open
gh pr list --state closed
gh pr list --state merged
gh pr list --state all

# Filter by author
gh pr list --author @me
gh pr list --author username

# Filter by label
gh pr list --label "bug"

# Get as JSON
gh pr list --json number,title,author,state
```

---

## API Commands

### Basic Usage

```bash
# GET request (default)
gh api repos/{owner}/{repo}/pulls/123

# POST request
gh api repos/{owner}/{repo}/issues --method POST -f title="Issue title" -f body="Body"

# Custom headers
gh api endpoint -H "Accept: application/vnd.github+json"
```

### Placeholders

The following placeholders are automatically replaced:

- `{owner}` - Repository owner (from current directory or GH_REPO)
- `{repo}` - Repository name
- `{branch}` - Current branch name

```bash
# These are equivalent when in the tzurot repo:
gh api repos/lbds137/tzurot/pulls
gh api repos/{owner}/{repo}/pulls
```

### Getting PR Comments (Issue Comments)

**These are the general discussion comments on a PR:**

```bash
# Get all issue comments on a PR
gh api repos/{owner}/{repo}/issues/123/comments

# Get with pagination (for many comments)
gh api repos/{owner}/{repo}/issues/123/comments --paginate

# Format output with jq
gh api repos/{owner}/{repo}/issues/123/comments --jq '.[].body'
```

### Getting Review Comments (Line Comments)

**These are comments on specific lines in the diff:**

```bash
# Get all line-level review comments
gh api repos/{owner}/{repo}/pulls/123/comments

# Note: This is DIFFERENT from issue comments!
```

### Getting PR Reviews

**These are formal reviews (APPROVE, REQUEST_CHANGES, COMMENT):**

```bash
# Get all reviews
gh api repos/{owner}/{repo}/pulls/123/reviews

# Get review comments for a specific review
gh api repos/{owner}/{repo}/pulls/123/reviews/456/comments
```

### Posting Comments

```bash
# Post an issue comment (general PR comment)
gh api repos/{owner}/{repo}/issues/123/comments \
  --method POST \
  -f body="Your comment here"

# Post a review comment (line-specific)
gh api repos/{owner}/{repo}/pulls/123/comments \
  --method POST \
  -f body="Line comment" \
  -f commit_id="abc123" \
  -f path="src/file.ts" \
  -f line=42
```

---

## Workflow Run Commands

```bash
# List recent workflow runs
gh run list

# View a specific run
gh run view 12345

# Watch a run in progress
gh run watch 12345

# Download artifacts from a run
gh run download 12345

# Rerun a failed workflow
gh run rerun 12345

# Rerun only failed jobs
gh run rerun 12345 --failed
```

---

## Issue Commands

```bash
# List issues
gh issue list

# View specific issue
gh issue view 123

# Create issue
gh issue create --title "Bug: something broke" --body "Description"

# Comment on issue
gh issue comment 123 --body "Comment here"

# Close issue
gh issue close 123
```

---

## Common Patterns for Tzurot

### Creating a PR to develop

```bash
gh pr create --base develop --title "feat: description" --body "$(cat <<'EOF'
## Summary
- Brief description of changes

## Test plan
- [ ] Manual testing steps

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### Reading PR Review Comments

```bash
# Get general discussion comments (most common)
gh pr view 123 --json comments --jq '.comments[].body'

# Get via API for more details
gh api repos/{owner}/{repo}/issues/123/comments --jq '.[] | {author: .user.login, body: .body}'
```

### Checking if PR has reviews

```bash
# Quick check
gh pr view 123 --json reviews --jq '.reviews | length'

# Get review details
gh pr view 123 --json reviews --jq '.reviews[] | {author: .author.login, state: .state}'
```

### Posting a Code Review Comment

```bash
gh pr comment 123 --body "$(cat <<'EOF'
## Code Review

### Issues Found
- Issue 1
- Issue 2

### Suggestions
- Suggestion 1

**Verdict**: Approve with minor changes
EOF
)"
```

---

## Authentication

### Check Status

```bash
gh auth status
# Shows: account, scopes, token status
```

### Add Scopes

```bash
# Add project scope (for GitHub Projects)
gh auth refresh -s project

# Add multiple scopes
gh auth refresh -s project -s read:org
```

### Current Token Scopes (typical)

- `repo` - Full control of private repositories
- `workflow` - Update GitHub Action workflows
- `gist` - Create gists
- `read:org` - Read org membership

---

## Troubleshooting

### "Resource not accessible" Error

**Cause**: Missing required scope or permissions.

**Fix**:

```bash
gh auth refresh -s <needed-scope>
```

### Empty Response for Comments

**Cause**: Using wrong endpoint. PRs have multiple comment types.

**Fix**: Determine which type of comments you need:

- General discussion → `/issues/{pr}/comments` or `gh pr view --json comments`
- Line comments → `/pulls/{pr}/comments`
- Reviews → `/pulls/{pr}/reviews`

### "projectCards is empty"

**Cause**: GitHub Projects v2 uses `projectItems` not `projectCards`.

**Fix**:

```bash
gh pr view --json projectItems
```

### "Projects (classic) is being deprecated" Error

**Cause**: Known bug in gh CLI (affects all versions including 2.65.0+). The `gh pr edit` command queries deprecated GraphQL fields even when not working with projects.

**Symptoms**:

```
GraphQL: Projects (classic) is being deprecated in favor of the new Projects experience...
(repository.pullRequest.projectCards)
```

**Impact**: `gh pr edit`, `gh issue view`, and related commands fail with exit code 1.

**Workaround**: Use REST API directly instead of convenience commands:

```bash
# Instead of: gh pr edit 123 --body "new body"
gh api -X PATCH repos/{owner}/{repo}/pulls/123 -f body="new body"

# Instead of: gh pr edit 123 --title "new title"
gh api -X PATCH repos/{owner}/{repo}/pulls/123 -f title="new title"
```

**Status**: Open bug in gh CLI - [Issue #11983](https://github.com/cli/cli/issues/11983), no fix as of November 2025.

### "Rate limit exceeded"

**Cause**: Too many API requests.

**Fix**: Wait and retry, or add delay between requests:

```bash
sleep 1
```

### Authentication Required for Private Repos

**Cause**: Token doesn't have `repo` scope.

**Fix**:

```bash
gh auth refresh -s repo
```

---

## Quick Reference

| Task                 | Command                                                       |
| -------------------- | ------------------------------------------------------------- |
| View PR              | `gh pr view 123`                                              |
| Create PR to develop | `gh pr create --base develop`                                 |
| Edit PR body ⚠️      | `gh api -X PATCH repos/{owner}/{repo}/pulls/123 -f body="…"`  |
| Edit PR title ⚠️     | `gh api -X PATCH repos/{owner}/{repo}/pulls/123 -f title="…"` |
| Comment on PR        | `gh pr comment 123 --body "text"`                             |
| Check CI status      | `gh pr checks 123`                                            |
| Merge with rebase    | `gh pr merge 123 --rebase`                                    |
| List open PRs        | `gh pr list`                                                  |
| Get PR comments      | `gh pr view 123 --json comments`                              |
| Get PR as JSON       | `gh pr view 123 --json number,title,body`                     |
| API request          | `gh api repos/{owner}/{repo}/endpoint`                        |

⚠️ = Workaround for broken `gh pr edit` command (see Troubleshooting)
