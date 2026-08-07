#!/bin/bash
# PostToolUse hook: after `git push` or `gh pr create`, inject a reminder for
# Claude to arm a Monitor watching PR CI + review-bot completion.
# Contract + Monitor command shape: .claude/rules/05-tooling.md "PR Monitoring".
#
# The reminder prints `--sha $(git rev-parse HEAD)` UNRESOLVED, on purpose, even
# though $SHA below already holds the pushed value. Baking the value in has no
# arm-delay window, but it also makes this copy differ from the two doc copies,
# and every hand-filled SHA has to be transcribed from somewhere — which failed
# four times in one session. The cost is that anything moving HEAD between the
# push and the Monitor — a branch checkout more often than a new commit — makes
# the gate watch a different SHA silently; the rule names that window. Do not "fix" this back to $SHA without reading that section
# and guard:monitor-command, which requires all three copies to match.

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
#
# Specific-ref tag pushes (`git push origin v3.0.0-beta.XX`) aren't caught by
# this filter — they look like a normal ref push — but they're implicitly
# handled downstream: release tags are pushed from `main`, and `gh pr list
# --head main` returns empty since main is always a target branch, so the
# empty-PR guard below exits silently.
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
    #
    # Observability TODO: if this stderr line never fires in practice over
    # several PRs, the three alternative paths below are dead code and can be
    # narrowed to the single path that the payload actually uses. If it fires
    # on every `gh pr create`, the fallback-through-gh-pr-list is the only
    # real code path and parsing stdout is dead weight — drop it entirely.
    # Either way, revisit once we have observational data.
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

# Explicit if/then/fi. Bash `&&` and `||` are equal-precedence and
# left-associative, so the one-liner form `[ -z ] || [ = null ] && exit`
# is also correct — but readers who carry C-style precedence intuition
# (`&&` binds tighter than `||`) will misread it. Use the unambiguous form.
if [ -z "$PR_NUM" ] || [ "$PR_NUM" = "null" ]; then
    exit 0
fi

# Append-only dedup: one line per (PR, SHA) we've already reminded for.
# Survives multi-PR sessions (switching between PRs doesn't clobber history).
# Namespaced by UID so concurrent sessions from different users on the same
# host can't cross-contaminate each other's dedup state.
# /tmp is wiped on reboot, so the file stays bounded naturally.
SHA=$(git rev-parse HEAD 2>/dev/null || echo "nosha-$$")
KEY="${PR_NUM}:${SHA}"
SEEN_FILE="/tmp/.claude_pr_monitor_seen.$(id -u)"
if [ -f "$SEEN_FILE" ] && grep -qxF "$KEY" "$SEEN_FILE" 2>/dev/null; then
    exit 0
fi
echo "$KEY" >>"$SEEN_FILE"
# Non-secret data, but restrict to the owning user anyway — no reason for
# other accounts on a shared host to read one user's PR/SHA history.
chmod 600 "$SEEN_FILE" 2>/dev/null || true

# Owner policy: every human-authored PR carries its CREATOR as assignee; bot
# PRs (dependabot etc.) stay unassigned. The skill's canonical
# `gh pr create --assignee @me` is the primary path; this is the
# deterministic backfill when the flag was forgotten. REST endpoint rather
# than `gh pr edit` (the latter is unreliable in this repo — see
# 05-tooling.md "Use instead of broken gh pr edit"). Fail-open: an offline
# `gh` must never block the reminder below.
PR_META=$(gh pr view "$PR_NUM" --json author,assignees \
    --jq '"\(.author.login) \(.assignees | length)"' 2>/dev/null || echo "")
if [ -n "$PR_META" ]; then
    AUTHOR=${PR_META% *}
    ASSIGNEE_COUNT=${PR_META##* }
    # One pattern covers bots AND input hygiene: real GitHub logins are
    # [A-Za-z0-9-] only, so "app/dependabot", "foo[bot]", or anything mangled
    # falls through to skip rather than reach the API call.
    case "$AUTHOR" in
    '' | *dependabot* | *[!A-Za-z0-9-]*) : ;;
    *)
        if [ "$ASSIGNEE_COUNT" = "0" ]; then
            if gh api "repos/{owner}/{repo}/issues/${PR_NUM}/assignees" \
                -f "assignees[]=${AUTHOR}" >/dev/null 2>&1; then
                echo "pr-monitor-reminder: auto-assigned ${AUTHOR} to PR #$PR_NUM" >&2
            else
                # Fail-open by design, but say so — a silent permission error
                # would otherwise read as "the backfill never runs".
                echo "pr-monitor-reminder: assignee backfill failed for PR #$PR_NUM (proceeding)" >&2
            fi
        fi
        ;;
    esac
fi

cat <<EOF
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PR MONITOR REMINDER — push detected on PR #$PR_NUM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Per .claude/rules/05-tooling.md (PR Monitoring), arm a Monitor now:

  FIRST: if a monitor for PR #$PR_NUM is still running from an earlier push,
  TaskStop it. One monitor per PR — the reporting half is not SHA-pinned, so a
  stale watcher reports the CURRENT state under an older push's label.

  COPY THE LINE BELOW VERBATIM, substitution included — do NOT resolve the SHA
  yourself and paste the result. Hand-transcribing it failed four times in one
  session (twice by completing an abbreviated SHA with invented characters), and
  every one of those spins silently instead of erroring. The gate does reject an
  abbreviated SHA and a well-formed one naming no local commit, but the point of
  the substitution is that there is nothing left to get wrong.

  The gate waits for the CI workflow RUN to complete and for nothing else on
  that SHA to still be in flight; do not swap it for a fixed 'sleep', because
  run creation itself can lag the push by minutes (see 05-tooling.md § PR
  Monitoring).

  Arm a Monitor with description "CI + reviews for PR #$PR_NUM", timeout_ms
  1800000, persistent false (deliberately NOT true — a forgotten session-length
  watcher cannot be cleaned up), and the line below as its "command", verbatim:

    pnpm ops gh:ci-gate $PR_NUM --sha \$(git rev-parse HEAD)

When it fires:
- Inspect \`gh pr checks $PR_NUM\` output for pass/fail summary.
- If no "CI_COMPLETE" line appeared, the 30-min timeout fired first — re-arm.
- Fetch new feedback. Conversation comments + inline code-review comments
  + review summaries live in THREE different endpoints — you need all three:
    pnpm ops gh:pr-comments $PR_NUM   # conversation + line-level
    pnpm ops gh:pr-reviews $PR_NUM    # Approve / Request Changes summaries
    pnpm ops gh:pr-info $PR_NUM       # PR-level state
  (\`gh api /repos/.../issues/N/comments\` only returns issue-level and
   silently misses inline line comments — the most common place human
   reviewers leave blocking feedback.)
- Report CI state + reviewer findings in one message (blocking vs. non-blocking).
- Apply feedback per /tzurot-review-response (trivial-shape
  auto-apply via test-gated fixups; semantic-shape ASK; batch-present).
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
