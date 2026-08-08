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

# Decide the PR number from the ARGUMENT VECTOR of a real `gh pr merge`
# invocation, not from a text scan of the whole command.
#
# The text scan this replaces was wrong in two ways that both END IN AN
# UNREVIEWED MERGE, which is the one outcome this hook exists to prevent. It
# matched the phrase anywhere in the command, so `gh pr comment N --body "...gh
# pr merge 1..."` armed the gate on PR 1 (fired in production twice); and it
# stripped to the FIRST occurrence, so `echo gh pr merge 1 && gh pr merge 2002`
# extracted 1. Either way the gate fetches some unrelated PR — and when that PR
# has no review and a base other than `main`, the hook exits 0 and the real
# merge proceeds with nothing read.
#
# `shlex` gives quote-awareness (a quoted --body is ONE token, so prose can
# never match) and operator tokens (so `gh` is only a command when it starts
# the line or follows an operator). Python is already a hard dependency of
# three sibling hooks, so this adds no new one.
#
# Fails CLOSED by design, in both directions: an unparseable command falls back
# to the old permissive scan rather than arming nothing, because silently not
# arming is the same hole under a different name.
PR_NUM=$(COMMAND="$COMMAND" python3 << 'PYEOF'
import os, re, shlex, sys

raw_command = os.environ.get("COMMAND", "")

# Cheap reject before any parsing: no phrase, no gate. Keeps the common Bash
# call (which is not a merge) off the parsing path entirely.
if not re.search(r"(^|[\s&|;(])gh\s+pr\s+merge($|\s)", raw_command):
    sys.exit(0)

OPERATORS = {"&&", "||", ";", "|", "&", "(", ")", ";;", "\n"}


def strip_heredocs(text):
    """Remove heredoc BODIES before tokenizing.

    A heredoc body is data, never commands — bash will not execute a word in
    it no matter what it looks like. `shlex` has no concept of heredocs, so
    without this the body is tokenized as if it were shell, and any example
    command quoted in a PR body, commit message, or issue text can arm the
    gate on whatever digit follows it. That is not hypothetical: this hook
    fired on its own PR's `gh pr create`, extracting a PR number out of a
    markdown table cell describing the very bug being fixed.

    Handles `<<MARKER`, `<<'MARKER'`, `<<"MARKER"`, and the `<<-` indent form.
    Anything unterminated is dropped to end-of-text, which is the safe way
    round: an unterminated heredoc means the rest was never commands either.
    """
    pattern = re.compile(r"<<-?\s*(['\"]?)([A-Za-z_][A-Za-z_0-9]*)\1")
    out = []
    pos = 0
    while True:
        match = pattern.search(text, pos)
        if match is None:
            out.append(text[pos:])
            return "".join(out)
        # Keep the redirection operator itself; drop only what it introduces.
        out.append(text[pos : match.start()])
        marker = match.group(2)
        # The body starts after the line carrying the redirection.
        newline = text.find("\n", match.end())
        if newline == -1:
            return "".join(out)
        out.append(text[match.end() : newline + 1])
        terminator = re.compile(r"^[ \t]*" + re.escape(marker) + r"[ \t]*$", re.M)
        end = terminator.search(text, newline + 1)
        if end is None:
            return "".join(out)
        pos = end.end()


def legacy_scan(text):
    """The pre-hardening behaviour, kept ONLY as the unparseable fallback.

    Over-arming (the old bug) is recoverable — the agent sees a review for a
    PR it did not ask about and retries. Under-arming is not: the merge just
    proceeds. So when the tokenizer cannot run, take the noisy option.
    """
    after = re.split(r"gh\s+pr\s+merge", text, maxsplit=1)
    if len(after) < 2:
        return ""
    for token in after[1].split():
        if token.isdigit():
            return token
    return ""


command = strip_heredocs(raw_command)

try:
    lexer = shlex.shlex(command, punctuation_chars=True, posix=True)
    lexer.whitespace_split = True
    # A newline separates commands, but shlex counts it as plain whitespace and
    # never emits it as a token — so `pnpm test\ngh pr merge 2002` would read as
    # one long command and the merge would lose its command position. Record the
    # line each token STARTS on so a newline can restore that position.
    #
    # Read the counter BEFORE each token, not after: measured, `lineno` is
    # incremented while finishing the token that PRECEDES the newline, so the
    # after-value marks the wrong token as the one that crossed the line.
    tokens = []
    linenos = []
    while True:
        line_at_start = lexer.lineno
        token = lexer.get_token()
        if token is None or token == "":
            break
        tokens.append(token)
        linenos.append(line_at_start)
except ValueError:
    # Unbalanced quotes: not parseable as a command line at all.
    print(legacy_scan(command))
    sys.exit(0)

at_command_start = True
for i, token in enumerate(tokens):
    if i > 0 and linenos[i] != linenos[i - 1]:
        at_command_start = True
    if token in OPERATORS:
        at_command_start = True
        continue
    # `FOO=bar gh pr merge 5` — an assignment prefix does not consume the
    # command position. Missing this made the gate silently skip that shape.
    if at_command_start and re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]*=.*", token):
        continue
    if at_command_start and token == "gh" and tokens[i + 1 : i + 3] == ["pr", "merge"]:
        for candidate in tokens[i + 3 :]:
            if candidate in OPERATORS:
                break
            if candidate.isdigit():
                print(candidate)
                sys.exit(0)
        # Bare `gh pr merge` (current branch's PR). Nothing to key an ack on.
        sys.exit(0)
    at_command_start = False
PYEOF
) || PR_NUM=""

# No PR number → bare `gh pr merge`, or the command only mentioned the phrase
# without invoking it. Either way there is nothing to gate on.
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
#
# The ack check runs FIRST, before the network call, so a PR whose reminder was
# already shown costs nothing to re-evaluate.
#
# DELIBERATE ACCEPT for the remaining case: a FIRST block on an ordinary feature
# PR pays one `gh pr view` to discover it is not release-relevant. Two things
# make that acceptable — the same path already makes a `gh api` call to fetch
# the review, so it is network-bound regardless, and it is a blocking gate that
# happens once per review cycle, not a latency-sensitive loop. It also fails
# open, so a `gh` outage degrades to "no reminder", never "cannot merge".
#
# Two cheaper short-circuits were considered and REJECTED, both for correctness:
#
#   - Caching the base per PR. Tried and removed: a PR retargeted develop<->main
#     keeps serving the stale answer for the life of /tmp, which either
#     suppresses the reminder or fires it spuriously. A stale answer here
#     reproduces the exact silent-drop class this hook exists to prevent.
#   - Treating `--delete-branch` as "this is a feature PR" (the old standalone
#     reminder used it as a fast path). It looks free and local, but it
#     suppresses the reminder precisely when the reminder matters MOST: the
#     release block's own text says "Do NOT pass --delete-branch: develop must
#     survive", so keying the skip on that flag would silence the warning in the
#     exact scenario that once deleted `develop`.
release_reminder_due() {
    if [ -f "$ACK_FILE" ] && grep -qxF "$RELEASE_KEY" "$ACK_FILE" 2>/dev/null; then
        return 1
    fi
    resolve_pr_base
    [ "$PR_BASE" = "main" ] || return 1
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
#
# $1 is the reason line, because the two call sites are NOT the same state: one
# found no comment, the other found one that would not parse. Saying "none
# found" for both would be a banner asserting something untrue, which is the
# whole class this hook's own PR was cleaning up.
release_block_then_exit() {
    if release_reminder_due; then
        {
            printf '%s\n' "$RULE"
            printf 'PR MERGE GATE — %s for PR #%s\n' "${1:-no usable claude-review}" "$PR_NUM"
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
    release_block_then_exit "no claude-review comment found"
fi

REVIEW_ID=$(jq -r '.id // empty' <<<"$REVIEW_JSON")
REVIEW_TS=$(jq -r '.created_at // empty' <<<"$REVIEW_JSON")
REVIEW_BODY=$(jq -r '.body // empty' <<<"$REVIEW_JSON")

if [ -z "$REVIEW_ID" ] || [ -z "$REVIEW_BODY" ]; then
    # Malformed response or empty review. Allow the merge rather than block on
    # an unparseable state; the rule still nominally applies. The release
    # reminder is independent of that and still owed.
    release_block_then_exit "a claude-review comment was found but did not parse"
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
#
# KNOWN GAP, tracked: that last clause assumes the base has not changed since
# the ack was written. Retarget an open PR from develop to main between two
# merge attempts on the SAME review comment and the ack still matches, so this
# exits before release_reminder_due() is ever consulted and the reminder never
# fires. Not the documented workflow — release PRs are opened against main
# directly — and closing it costs a `gh pr view` on EVERY merge attempt, which
# is the cost two earlier review rounds asked to remove from these paths. Those
# reviewers genuinely conflict, so the resolution is its own change rather than
# a late patch here.
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
