# GitHub Rulesets

This directory contains GitHub ruleset configurations for the repository.

## Importing Rulesets

### Method 1: GitHub CLI (Recommended)

```bash
# Install GitHub CLI if not already installed
# https://cli.github.com/

# Import the ruleset (use the no-bypass version to avoid actor ID issues)
gh api \
  --method POST \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  /repos/OWNER/REPO/rulesets \
  --input .github/rulesets/branch-protection-no-bypass.json

# For temporary use without CI checks:
# --input .github/rulesets/branch-protection-no-checks.json
```

### Method 2: GitHub Web UI

1. Go to Settings → Rules → Rulesets
2. Click "New ruleset" → "Import"
3. Upload the `branch-protection.json` file

### Method 3: Using curl

```bash
curl -L \
  -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer YOUR_GITHUB_TOKEN" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  https://api.github.com/repos/OWNER/REPO/rulesets \
  -d @.github/rulesets/branch-protection.json
```

## What These Rules Do

### For `main` and `develop` branches:

1. **Require Pull Requests**
   - At least 1 approving review
   - Dismiss stale reviews when new commits are pushed
   - Require all conversations to be resolved

2. **Status Checks**
   - Tests must pass
   - Linting must pass
   - Up-to-date with base branch before merging

3. **Protection**
   - Prevent force pushes
   - Prevent branch deletion

4. **Bypass**
   - Repository admins can bypass these rules if needed

## Customization

Edit the JSON file to customize:

- `required_approving_review_count`: Number of required reviews
- `required_status_checks`: Add/remove CI checks
- `bypass_actors`: Configure who can bypass rules

## Notes

- Replace `OWNER` and `REPO` with your actual GitHub username and repository name
- You'll need appropriate permissions to create rulesets
- These rules apply to both `main` (default branch) and `develop`
