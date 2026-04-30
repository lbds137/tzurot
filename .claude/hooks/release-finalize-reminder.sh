#!/bin/bash
# PostToolUse hook: after `gh pr merge <N> --rebase` completes for a release PR
# (one whose base branch is `main`), inject a reminder to run
# `pnpm ops release:finalize` so develop's SHAs stay aligned with main.
#
# Why this hook exists: the release procedure in `.claude/skills/tzurot-git-workflow`
# documents a step 6 ("After Merge to Main") that rebases develop onto main and
# force-pushes, dropping the duplicate-SHA commits a rebase-merge always
# creates. The tool (`pnpm ops release:finalize`, PR #878) and the skill
# documentation existed for both the v3.0.0-beta.111 and v3.0.0-beta.112
# releases — but the step was skipped both times, accumulating ~57 commits of
# divergent-SHA drift before being caught and cleaned up on 2026-04-30.
#
# Documentation + tool wasn't enough enforcement. This hook is the
# deterministic-trigger layer: PostToolUse fires on the `gh pr merge` event
# itself, not on attention to a procedure document.
#
# Known limitations:
# - PostToolUse fires on the COMMAND, not on its success. A failed
#   `gh pr merge` (network error, branch-protection rejection) triggers
#   PostToolUse but does NOT trigger the reminder, because the
#   `PR_STATE = MERGED` check below exits silently when state is OPEN.
#   Retries after a failed attempt fire correctly because the dedup
#   write is gated by the same MERGED check.
# - `gh pr merge https://github.com/.../pull/N` (URL form) is not matched
#   by the `gh pr merge[[:space:]]+[0-9]+` extraction below. The reminder
#   silently no-ops on URL-form invocations. Documented examples in the
#   project consistently use the numeric form, so this is a known gap
#   rather than a bug.
# - `gh pr merge --rebase <NUM>` (flags before number) likewise doesn't
#   match — the extraction requires the number directly after `gh pr merge`.
#   Same rationale: documented examples always put the number first.

# No `-e`: we rely on graceful early-exits via empty-var checks. `-u` catches
# typos on variable names; pipefail surfaces failures from pipelines.
set -uo pipefail

INPUT=$(cat)
TOOL_NAME=$(jq -r '.tool_name // empty' <<<"$INPUT" 2>/dev/null || echo "")
COMMAND=$(jq -r '.tool_input.command // empty' <<<"$INPUT" 2>/dev/null || echo "")

[ "$TOOL_NAME" != "Bash" ] && exit 0

# Match `gh pr merge <NUM> [...] --rebase`. Excludes squash/merge strategies
# since the project rule mandates rebase-only for release PRs anyway — if
# a future operator violates that rule, this hook silently no-ops, which
# is the right failure mode (the rule violation is the bigger problem).
if ! grep -qE '(^|[[:space:]&|;])gh pr merge[[:space:]]+[0-9]+' <<<"$COMMAND"; then
    exit 0
fi
if ! grep -qE -- '(^|[[:space:]&|;])--rebase($|[[:space:]])' <<<"$COMMAND"; then
    exit 0
fi

# Feature-branch PRs to develop carry `--delete-branch` (and the project's
# critical-rule says release PRs MUST omit it). This is the PRIMARY
# fast-path filter: it lets us short-circuit on the common feature-PR
# case without making an API call. The `gh pr view` call below is the
# SECONDARY confirmation that catches feature PRs which forgot the
# `--delete-branch` flag — without that, every such merge would
# spuriously fire the reminder.
#
# `--auto` (GitHub auto-merge) is not filtered — but the `PR_STATE = MERGED`
# check below correctly prevents spurious firing at command-issue time
# (state would be OPEN at that point, not MERGED). The real gap is the
# opposite: when an auto-merge eventually lands (minutes later when CI
# greens and GitHub auto-applies), NO PostToolUse event fires for that
# merge, so the reminder never fires at all. The project release procedure
# always merges synchronously after CI greens, so this gap is theoretical
# — but worth noting for a future operator who might opt into --auto.
if grep -qE -- '(^|[[:space:]&|;])--delete-branch($|[[:space:]])' <<<"$COMMAND"; then
    exit 0
fi

PR_NUM=$(grep -oE 'gh pr merge[[:space:]]+[0-9]+' <<<"$COMMAND" | grep -oE '[0-9]+$' | head -1)
[ -z "$PR_NUM" ] && exit 0

# Confirm via PR metadata: base = main AND state = MERGED.
#
# Why both fields: PostToolUse fires on the command, not on success. A
# failed `gh pr merge` (branch protection, network blip) reaches this
# point with the same shape as a successful one. Without the state
# check, the dedup file below would be written on the failed attempt,
# the reminder would fire confusingly, AND the subsequent successful
# retry's reminder would be dedup-suppressed — defeating the hook's
# purpose in the exact scenario where reliable reminders matter most.
# Filtering on `state = MERGED` is what makes the dedup write safe.
#
# Single API call fetches both fields together — no extra round trip
# vs the previous baseRefName-only version.
PR_INFO=$(gh pr view "$PR_NUM" --json baseRefName,state 2>/dev/null || echo "")
PR_BASE=$(jq -r '.baseRefName // empty' <<<"$PR_INFO" 2>/dev/null || echo "")
PR_STATE=$(jq -r '.state // empty' <<<"$PR_INFO" 2>/dev/null || echo "")
[ "$PR_BASE" != "main" ] && exit 0
[ "$PR_STATE" != "MERGED" ] && exit 0

# Append-only dedup: one line per release PR we've already reminded for.
# Survives multi-PR sessions; namespaced by UID for shared-host safety.
# /tmp is wiped on reboot, so the file stays bounded naturally.
#
# PR-level dedup (not PR:SHA like pr-monitor-reminder.sh): a release merge
# is a one-shot event. There's no follow-up push to the same release PR
# that should re-fire this reminder — once finalize has run, the operator
# moves on to tagging + GitHub Release. The sister hook keys on PR:SHA
# because feature-PR pushes happen repeatedly within a session.
#
# Critically: this dedup write is gated by the `PR_STATE = MERGED` check
# above. Without that gate, a failed-then-retried merge sequence would
# write the failed attempt's PR num to the dedup file, suppressing the
# reminder on the subsequent successful retry.
SEEN_FILE="/tmp/.claude_release_finalize_seen.$(id -u)"
if [ -f "$SEEN_FILE" ] && grep -qxF "$PR_NUM" "$SEEN_FILE" 2>/dev/null; then
    exit 0
fi
echo "$PR_NUM" >>"$SEEN_FILE"
chmod 600 "$SEEN_FILE" 2>/dev/null || true

cat <<EOF
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RELEASE FINALIZE REMINDER — release PR #$PR_NUM merged to main
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Per .claude/skills/tzurot-git-workflow "Release Procedure" step 6, run
release:finalize NEXT to rebase develop onto main:

  pnpm ops release:finalize --yes

Why this matters: rebase-merging a release PR to main creates new SHAs on
main. Without finalize, develop keeps its old SHAs and the next release PR
shows ~N commits of false divergence per cycle. Skipped on beta.111 +
beta.112; ~57 commits of drift accumulated before manual cleanup on
2026-04-30. Don't make it three in a row.

Also remember the rest of the release sequence:
  - Run pending Prisma migrations on prod IF this release includes one
    (pnpm ops db:migrate --env prod; check: git log v<prev>..HEAD -- prisma/migrations/)
  - Tag + push the release tag (git tag v3.0.0-beta.XX && git push --tags)
  - Create the GitHub Release (gh release create v3.0.0-beta.XX --notes ...)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
