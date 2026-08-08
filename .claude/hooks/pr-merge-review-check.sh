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
# attention; this hook is the structural backstop.
#
# It also carries the release-finalize reminder for PRs based on `main`. That
# reminder used to be its own PostToolUse hook firing after the merge, but
# non-blocking PostToolUse output never reaches the agent (probed directly,
# every matcher), so it printed into a void across every release. This hook is
# the nearest channel that provably delivers: it fires on the same `gh pr merge`
# command and blocks, and blocking-path stderr was observed reaching context.

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

RULE='━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'

# Ack file, defined BEFORE the review fetch because two independent concerns
# key off it now: the review gate (per PR+comment-id) and the release-finalize
# reminder (per PR). /tmp wipes on reboot so the file stays bounded;
# UID-namespaced so concurrent users on a shared host don't cross-contaminate.
ACK_FILE="/tmp/.claude_pr_merge_ack.$(id -u)"
RELEASE_KEY="RELEASE:${PR_NUM}"

# Base-branch resolution. Queried fresh every time it is needed, NOT cached.
#
# The release reminder must be reachable BEFORE the review-existence
# early-exits — a release PR whose claude-review posted nothing (documented in
# 05-tooling.md § claude-review health, observed twice) would otherwise merge
# with no reminder at all, which is the exact silent-drop this hook was moved
# here to end.
#
# That does NOT cost the acked-retry fast path anything, because that path
# exits at the ack check below before this is ever called — which is also why
# an earlier cache of the answer was removed rather than kept: it bought
# nothing on the hot path and introduced a staleness bug, since a PR retargeted
# from develop to main (or back) would keep serving the old base for the life
# of /tmp, silently suppressing or spuriously firing the reminder. A stale
# answer here reproduces the very failure class this hook exists to prevent, so
# freshness wins over one saved API call on a rare path.
#
# Fails open to "": an unreadable base skips the release block rather than
# blocking a merge on a `gh` blip.
PR_BASE=""
resolve_pr_base() {
    [ -n "$PR_BASE" ] && return 0
    PR_BASE=$(gh pr view "$PR_NUM" --json baseRefName --jq '.baseRefName' 2>/dev/null || echo "")
    return 0
}

# True when this is a release PR whose reminder has not been shown yet.
# Filtering on base=main is the whole test: the project's critical rule
# reserves a `main` base for release PRs.
release_reminder_due() {
    resolve_pr_base
    [ "$PR_BASE" = "main" ] || return 1
    if [ -f "$ACK_FILE" ] && grep -qxF "$RELEASE_KEY" "$ACK_FILE" 2>/dev/null; then
        return 1
    fi
    return 0
}

# The reminder body. Written to stderr by both call paths below — beside the
# review on the normal path, alone when no review exists. FORWARD-looking (it
# fires before the merge, not after), which is why there is no `state = MERGED`
# check: state is OPEN at this point by construction. That is a channel-forced
# improvement over the PostToolUse version, which fired post-merge into an
# output stream that never reached the agent.
print_release_block() {
    printf '%s\n' "$RULE"
    printf 'RELEASE PR — base is main. AFTER this merge lands, run finalize NEXT:\n\n'
    printf '  pnpm ops release:finalize --yes\n\n'
    printf 'Rebase-merging a release PR to main creates new SHAs on main. Without\n'
    printf 'finalize, develop keeps its old SHAs and the next release PR shows N\n'
    printf 'commits of false divergence per cycle — ~57 commits of drift accumulated\n'
    printf 'across two skipped cycles before manual cleanup was needed.\n\n'
    printf 'Also part of the post-merge sequence:\n'
    printf '  - Prod migrations run BEFORE the merge (pnpm ops release:premigrate) —\n'
    printf '    if this release has one and it has not run, stop and run it first.\n'
    printf '  - Tag + push the release tag, then create the GitHub Release.\n'
    printf '  - Do NOT pass --delete-branch: develop must survive.\n\n'
}

# Taken by the two "no usable review" exits below. Without a review there is
# nothing to inject, so the review gate itself allows the merge — but a release
# PR still owes its finalize reminder, and stderr only reaches the agent on the
# blocking path, so delivering it means exiting 2 once. A feature PR is
# unaffected and still exits 0 immediately.
release_block_then_exit() {
    if release_reminder_due; then
        {
            printf '%s\n' "$RULE"
            printf 'PR MERGE GATE — no claude-review comment found for PR #%s\n' "$PR_NUM"
            printf '%s\n\n' "$RULE"
            printf 'The review gate has nothing to surface, so it is not blocking on that.\n'
            printf 'This block is the release reminder, which does NOT depend on a review\n'
            printf 'existing. Retry the same merge command to proceed.\n\n'
            print_release_block
            printf '%s\n' "$RULE"
        } >&2
        if echo "$RELEASE_KEY" >>"$ACK_FILE" 2>/dev/null; then
            chmod 600 "$ACK_FILE" 2>/dev/null || true
            exit 2
        fi
        # Ack write failed — fail open rather than block forever.
        printf 'WARNING: release-reminder ack write failed (%s) — allowing merge\n' "$ACK_FILE" >&2
    fi
    exit 0
}

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
    release_block_then_exit
fi

REVIEW_ID=$(jq -r '.id // empty' <<<"$REVIEW_JSON")
REVIEW_TS=$(jq -r '.created_at // empty' <<<"$REVIEW_JSON")
REVIEW_BODY=$(jq -r '.body // empty' <<<"$REVIEW_JSON")

if [ -z "$REVIEW_ID" ] || [ -z "$REVIEW_BODY" ]; then
    # Malformed response or empty review. Allow the merge rather than block on
    # an unparseable state; the rule still nominally applies. The release
    # reminder is independent of that and still owed.
    release_block_then_exit
fi

# Origin-language scan: reviews that scope findings as "pre-existing" /
# "not a regression" invite dismissal-by-origin — the shortcut the rules ban
# (00-critical § Always Leave Code Better; /tzurot-review-response § rule 2's
# origin-language row). Origin is not a correctness verdict, so when the
# vocabulary appears, the injected block below demands a per-finding merits
# disposition before the merge retry. Line-count (not boolean) so the warning
# can say how much of it there is; false positives cost one reminder
# paragraph, never a block. grep -c prints 0 on no-match but exits 1; the
# herestring isn't a pipeline (pipefail doesn't apply) and errexit isn't set,
# so `|| true` changes nothing today — it documents that the non-zero exit
# is expected and keeps the guard correct if `set -e` ever arrives.
ORIGIN_HITS=$(grep -icE 'pre-?existing|pre-?dates|not a regression|not introduced (by|in) this|existing behavior|consistent with existing|already (present|existed)' <<<"$REVIEW_BODY" || true)

# Per-(PR, comment-id) key. A fresh review (different comment-id) forces
# re-engagement; a retry after ack proceeds.
ACK_KEY="${PR_NUM}:${REVIEW_ID}"

# Acked-retry fast path. Deliberately BEFORE any base resolution so it stays
# free of API calls — it runs on every ordinary feature merge, and the release
# reminder (if this is a release PR) was already delivered by the blocking call
# that wrote this ack.
if [ -f "$ACK_FILE" ] && grep -qxF "$ACK_KEY" "$ACK_FILE" 2>/dev/null; then
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
RELEASE_DUE=0
if release_reminder_due; then RELEASE_DUE=1; fi
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
        printf 'correctness verdict (/tzurot-review-response, rule 2). Before\n'
        printf 'retrying the merge, give each such finding a merits disposition in your\n'
        printf 'user-facing summary: fix now / backlog entry with promote-when /\n'
        printf 'correct-as-is WITH the technical reason. "Pre-existing" may not be the\n'
        printf 'operative reason.\n\n'
    fi
    if [ "$RELEASE_DUE" = 1 ]; then
        print_release_block
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
# Ack the release reminder too when it was just shown, so a later call on this
# PR (a fresh review re-arming the gate, or a no-review path) does not repeat
# it. Best-effort: a failure here costs a duplicate reminder, never a block.
if [ "$RELEASE_DUE" = 1 ]; then
    echo "$RELEASE_KEY" >>"$ACK_FILE" 2>/dev/null || true
fi
chmod 600 "$ACK_FILE" 2>/dev/null || true

exit 2
