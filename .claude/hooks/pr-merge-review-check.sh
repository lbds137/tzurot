#!/bin/bash
# PreToolUse hook: before `gh pr merge <N>`, fetch the latest claude[bot] review
# comment for that PR and dump its content into Claude's context. Blocks the
# merge on first invocation per (PR, review-comment-id); allows on retry once
# the same review-comment-id has been "acked" (i.e., already injected once).
#
# This enforces context-presence of the post-autosquash review before any
# merge call lands. The agent can still ignore what it sees — but the content
# is structurally in the context window, removing the "I forgot to fetch" path.
#
# Background: .claude/rules/00-critical.md "Never Merge PRs Without Completed
# CI" #3 says "claude-review turning green only means it finished posting — it
# does NOT mean its content was read." The rule existed but relied on agent
# attention; this hook is the structural backstop. Companion to
# pr-monitor-reminder.sh (PostToolUse on push/create).

set -uo pipefail

INPUT=$(cat)
TOOL_NAME=$(jq -r '.tool_name // empty' <<<"$INPUT" 2>/dev/null || echo "")
COMMAND=$(jq -r '.tool_input.command // empty' <<<"$INPUT" 2>/dev/null || echo "")

[ "$TOOL_NAME" != "Bash" ] && exit 0

# Match `gh pr merge` (with trailing word boundary so `gh pr merge-queue` etc.
# don't trigger), then scan the remainder of the command for the first standalone
# numeric token. This catches both arg orders:
#   gh pr merge 979 --rebase          (number first)
#   gh pr merge --rebase 979          (flags first)
# Bare `gh pr merge` (current branch's PR, no number) is rare in agent flow and
# stays out of scope — if it occurs the merge proceeds without the gate.
if ! [[ "$COMMAND" =~ (^|[[:space:]&|;])gh[[:space:]]+pr[[:space:]]+merge($|[[:space:]]) ]]; then
    exit 0
fi
# Strip everything up to and including the `merge` keyword, then find the first
# whitespace-delimited all-digit token in the remainder. Excludes flag values
# like `--retries=5` because those carry the digit inside an `=` or `--` token.
REMAINDER="${COMMAND#*gh*pr*merge}"
PR_NUM=""
# `set -f` disables filename globbing so an unquoted-expansion token containing
# `*`, `?`, or `[` (e.g. shell redirections in the merge command) doesn't
# expand against cwd before the loop sees it. Restored after the loop.
set -f
for token in $REMAINDER; do
    if [[ "$token" =~ ^[0-9]+$ ]]; then
        PR_NUM="$token"
        break
    fi
done
set +f

# No PR number anywhere after `merge` → bare `gh pr merge` form, exit clean.
if [ -z "$PR_NUM" ]; then
    exit 0
fi

# Fetch the most recent claude[bot] comment on this PR. Pull body + id +
# created_at so the ack key is stable per-comment (a fresh review re-runs
# the gate).
#
# `?per_page=100&direction=desc` is required: GitHub defaults to 30 items per
# page in ASCENDING order. A busy PR with many review rounds + bot noise
# (codecov, security scanners) can push the latest claude[bot] comment past
# position 100 if we asked for ascending. With `direction=desc` we get the 100
# MOST RECENT comments — the latest claude[bot] review is realistically always
# in that window. Without these params, the jq filter would silently surface
# an OLDER review (the worst possible failure mode for this gate — fires but
# injects the wrong content).
REVIEW_JSON=$(gh api "repos/lbds137/tzurot/issues/${PR_NUM}/comments?per_page=100&direction=desc" \
    --jq '[.[] | select(.user.login == "claude[bot]")] | sort_by(.created_at) | last' \
    2>/dev/null || echo "")

# No claude-review on this PR (yet, or ever). Allow the merge — the gate is
# only meaningful when there's actually content to surface. The user-facing
# rule still applies: agent should be reading whatever review IS available.
if [ -z "$REVIEW_JSON" ] || [ "$REVIEW_JSON" = "null" ]; then
    exit 0
fi

REVIEW_ID=$(jq -r '.id // empty' <<<"$REVIEW_JSON")
REVIEW_TS=$(jq -r '.created_at // empty' <<<"$REVIEW_JSON")
REVIEW_BODY=$(jq -r '.body // empty' <<<"$REVIEW_JSON")

if [ -z "$REVIEW_ID" ] || [ -z "$REVIEW_BODY" ]; then
    # Malformed response or empty review. Allow the merge rather than block on
    # an unparseable state; the rule still nominally applies.
    exit 0
fi

# Origin-language scan: reviews that scope findings as "pre-existing" /
# "not a regression" invite dismissal-by-origin — the shortcut the rules ban
# (00-critical § Always Leave Code Better; 08-review-response § rule 2's
# origin-language row). Origin is not a correctness verdict, so when the
# vocabulary appears, the injected block below demands a per-finding merits
# disposition before the merge retry. Line-count (not boolean) so the warning
# can say how much of it there is; false positives cost one reminder
# paragraph, never a block. grep -c prints 0 on no-match but exits 1; the
# herestring isn't a pipeline (pipefail doesn't apply) and errexit isn't set,
# so `|| true` changes nothing today — it documents that the non-zero exit
# is expected and keeps the guard correct if `set -e` ever arrives.
ORIGIN_HITS=$(grep -icE 'pre-?existing|pre-?dates|not a regression|not introduced (by|in) this|existing behavior|consistent with existing|already (present|existed)' <<<"$REVIEW_BODY" || true)

# Per-(PR, comment-id) ack file. A fresh review (different comment-id) forces
# re-engagement; a retry after ack proceeds. /tmp wipes on reboot so the file
# stays bounded; UID-namespaced so concurrent users on a shared host don't
# cross-contaminate.
ACK_FILE="/tmp/.claude_pr_merge_ack.$(id -u)"
ACK_KEY="${PR_NUM}:${REVIEW_ID}"

if [ -f "$ACK_FILE" ] && grep -qxF "$ACK_KEY" "$ACK_FILE" 2>/dev/null; then
    # Already injected this review; allow the retry.
    exit 0
fi

# First-call path: inject the review into stderr FIRST, then ack and exit 2.
#
# Inject-before-ack ordering matters: if anything interrupts between the two
# steps (signal, stderr buffer issue, partial write), the failure mode under
# inject-first is "review printed but no ack" → next call re-injects (harmless
# double-display). The reversed order would mean "ack written but no inject" →
# next call sees the ack and silently allows the merge without ever surfacing
# the review, which is the exact failure mode this gate exists to prevent.
#
# printf rather than heredoc: an unquoted heredoc terminates on a bare delimiter
# line in the body, so a review that contained `EOF` on its own line would
# silently truncate the injected content. printf has no such delimiter
# semantics — `%s` swallows whatever the variable holds.
RULE='━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
{
    printf '%s\n' "$RULE"
    printf 'PR MERGE GATE — latest claude-review for PR #%s\n' "$PR_NUM"
    printf 'Posted: %s\n' "$REVIEW_TS"
    printf '%s\n\n' "$RULE"
    printf '%s\n\n' "$REVIEW_BODY"
    printf '%s\n' "$RULE"
    printf 'This review'\''s content is now in your context. Per .claude/rules/00-critical.md\n'
    printf '"Never Merge PRs Without Completed CI" #3:\n\n'
    printf '  - If the review is LGTM with no actionable items, retry the same merge\n'
    printf '    command — it will proceed (this comment-id is now acked).\n'
    printf '  - If the review surfaced a substantive finding (post-autosquash review\n'
    printf '    can differ from pre-autosquash), report it to the user and ask whether\n'
    printf '    to proceed, fix, or backlog.\n\n'
    if [ "${ORIGIN_HITS:-0}" -gt 0 ] 2>/dev/null; then
        printf '⚠ ORIGIN-LANGUAGE DETECTED (%s matching line(s)). This review scopes at\n' "$ORIGIN_HITS"
        printf 'least one finding as pre-existing / not-a-regression. Origin is NOT a\n'
        printf 'correctness verdict (.claude/rules/08-review-response.md, rule 2). Before\n'
        printf 'retrying the merge, give each such finding a merits disposition in your\n'
        printf 'user-facing summary: fix now / backlog entry with promote-when /\n'
        printf 'correct-as-is WITH the technical reason. "Pre-existing" may not be the\n'
        printf 'operative reason.\n\n'
    fi
    printf 'Do NOT bypass this gate by editing the ack file. The gate'\''s purpose is to\n'
    printf 'ensure the latest review is in context at merge time — not an obstacle to\n'
    printf 'be routed around.\n'
    printf '%s\n' "$RULE"
} >&2

# Now write the ack. Fail-open if the write itself fails (disk full, /tmp
# readonly, permission race): blocking on retry would infinite-loop because
# the next call would also fail to write, never see the ack, and re-block.
# The review has already been injected to stderr, so the agent has seen the
# content — the trade-off is "this PR's gate effectively no-ops until the
# system-fault is fixed" rather than "agent stuck blocked indefinitely."
# Consistent with the script's other fail-open paths (no review present,
# malformed API response).
if ! echo "$ACK_KEY" >>"$ACK_FILE" 2>/dev/null; then
    printf 'WARNING: pr-merge-review-check ack write failed (%s) — allowing merge to avoid infinite block; investigate /tmp writability\n' "$ACK_FILE" >&2
    exit 0
fi
chmod 600 "$ACK_FILE" 2>/dev/null || true

exit 2
