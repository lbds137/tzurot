#!/bin/bash
# PostToolUse hook: after `git push` or `gh pr create`, inject a reminder for
# Claude to arm a Monitor watching PR CI + review-bot completion.
# Contract + Monitor command shape: .claude/rules/05-tooling.md "PR Monitoring".

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

[ "$TOOL_NAME" != "Bash" ] && exit 0

# Trailing boundary prevents false matches like `git push-custom`. Command
# string matches (strings/comments) are rare enough locally not to warrant an AST.
if ! echo "$COMMAND" | grep -qE '(^|[[:space:]&|;])(git push|gh pr create)($|[[:space:]])'; then
    exit 0
fi

PR_NUM=""

# `gh pr create` returns the PR URL as stdout — parsing it avoids the
# replication lag `gh pr list` hits immediately after creation.
if echo "$COMMAND" | grep -qE '(^|[[:space:]&|;])gh pr create($|[[:space:]])'; then
    OUTPUT=$(echo "$INPUT" | jq -r '.tool_result.stdout // .tool_response.output // .output // empty' 2>/dev/null)
    PR_NUM=$(echo "$OUTPUT" | grep -oE 'pull/[0-9]+' | head -1 | grep -oE '[0-9]+$')
fi

# Fallback (primary path for `git push`): resolve PR from current branch.
# Silently exits if the branch has no open PR — that's the right behaviour
# for pushes to develop/main/feature-without-PR.
if [ -z "$PR_NUM" ]; then
    BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
    [ -z "$BRANCH" ] && exit 0
    PR_NUM=$(gh pr list --head "$BRANCH" --state open --json number --jq '.[0].number' 2>/dev/null)
fi

[ -z "$PR_NUM" ] || [ "$PR_NUM" = "null" ] && exit 0

# Dedup by (PR_NUM, commit_SHA): re-pushing the same commit is idempotent, but
# a new commit re-arms the reminder (new CI run, possibly new review).
SHA=$(git rev-parse HEAD 2>/dev/null)
KEY="${PR_NUM}:${SHA}"
LAST_FILE="/tmp/.claude_pr_monitor_last"
[ "$(cat "$LAST_FILE" 2>/dev/null)" = "$KEY" ] && exit 0
echo "$KEY" > "$LAST_FILE"

cat << EOF
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
- Fetch new review comments: gh api /repos/lbds137/tzurot/issues/$PR_NUM/comments
- Report CI state + reviewer findings in one message (blocking vs. non-blocking).
- Do NOT fix without user approval.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
