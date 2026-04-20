#!/bin/bash
# PostToolUse hook: after `git push` or `gh pr create`, inject a reminder for
# Claude to arm a Monitor watching PR CI + review-bot completion.
# Contract + Monitor command shape: .claude/rules/05-tooling.md "PR Monitoring".

# No `-e`: we rely on graceful early-exits via empty-var checks. `-u` catches
# typos on variable names; pipefail surfaces failures from pipelines.
set -uo pipefail

INPUT=$(cat)
TOOL_NAME=$(jq -r '.tool_name // empty' <<<"$INPUT" 2>/dev/null || echo "")
COMMAND=$(jq -r '.tool_input.command // empty' <<<"$INPUT" 2>/dev/null || echo "")

[ "$TOOL_NAME" != "Bash" ] && exit 0

# Trailing boundary prevents false matches like `git push-custom`. Command
# string matches (strings/comments) are rare enough locally not to warrant an AST.
if ! grep -qE '(^|[[:space:]&|;])(git push|gh pr create)($|[[:space:]])' <<<"$COMMAND"; then
    exit 0
fi

# Tag pushes (`git push --tags` / `git push origin --tags`) have no PR
# association — the branch might coincidentally have an open PR, but the push
# is about tags, not that PR. Exit early to avoid spurious reminders.
if grep -qE '(^|[[:space:]])git push[[:space:]].*--tags($|[[:space:]])' <<<"$COMMAND"; then
    exit 0
fi

PR_NUM=""

# `gh pr create` returns the PR URL as stdout — parsing it avoids the
# replication lag `gh pr list` hits immediately after creation.
if grep -qE '(^|[[:space:]&|;])gh pr create($|[[:space:]])' <<<"$COMMAND"; then
    # Field-path guesswork: Claude Code's PostToolUse hook payload isn't
    # strictly documented. If none of these match, we fall through to the
    # gh-pr-list lookup and log a one-liner to stderr so drift is detectable.
    OUTPUT=$(jq -r '.tool_result.stdout // .tool_response.output // .output // empty' <<<"$INPUT" 2>/dev/null || echo "")
    if [ -z "$OUTPUT" ]; then
        echo "pr-monitor-reminder: no tool_result stdout available; falling back to gh pr list" >&2
    fi
    PR_NUM=$(grep -oE 'pull/[0-9]+' <<<"$OUTPUT" | head -1 | grep -oE '[0-9]+$' || echo "")
fi

# Fallback (primary path for `git push`): resolve PR from current branch.
# Silently exits if the branch has no open PR — right for pushes to
# develop/main or a feature branch that hasn't had a PR opened yet.
if [ -z "$PR_NUM" ]; then
    BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
    [ -z "$BRANCH" ] && exit 0
    PR_NUM=$(gh pr list --head "$BRANCH" --state open --json number --jq '.[0].number' 2>/dev/null || echo "")
fi

[ -z "$PR_NUM" ] || [ "$PR_NUM" = "null" ] && exit 0

# Append-only dedup: one line per (PR, SHA) we've already reminded for.
# Survives multi-PR sessions (switching between PRs doesn't clobber history).
# /tmp is wiped on reboot, so the file stays bounded naturally.
SHA=$(git rev-parse HEAD 2>/dev/null || echo "nosha-$$")
KEY="${PR_NUM}:${SHA}"
SEEN_FILE="/tmp/.claude_pr_monitor_seen"
if [ -f "$SEEN_FILE" ] && grep -qxF "$KEY" "$SEEN_FILE" 2>/dev/null; then
    exit 0
fi
echo "$KEY" >>"$SEEN_FILE"

cat <<EOF
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PR MONITOR REMINDER — push detected on PR #$PR_NUM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Per .claude/rules/05-tooling.md (PR Monitoring), arm a Monitor now:

  Monitor({
    description: "CI + reviews for PR #$PR_NUM",
    command: 'gh pr checks $PR_NUM --watch --interval=30 > /dev/null 2>&1; echo "CI_COMPLETE"; gh pr checks $PR_NUM',
    timeout_ms: 900000
  })

When it fires:
- Inspect \`gh pr checks $PR_NUM\` output for pass/fail summary.
- If no "CI_COMPLETE" line appeared, the 15-min timeout fired first — re-arm.
- Fetch new comments: gh api /repos/<owner>/<repo>/issues/$PR_NUM/comments
  (include human reviewer comments, not just bots).
- Report CI state + reviewer findings in one message (blocking vs. non-blocking).
- Do NOT fix without user approval.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
