---
id: TASK-302
title: Probe-harness parity for the remaining .claude hooks
status: To Do
assignee: []
created_date: '2026-07-20 00:00'
updated_date: '2026-07-28 10:52'
labels:
  - 'area:tooling'
  - 'area:process'
  - 'origin:review'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 302000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-20 (#1732 review observation) — the `.claude/hooks/*.probe.sh` exit-code harnesses (cwd-drift, promise-ledger, develop-code-commit-guard) are "run manually after editing the hook," not wired into `pnpm quality`/CI — a future hook edit could silently regress the guard with no safety net. Applies to the pre-existing develop-code-commit-guard.probe.sh too (not new to #1732). **Fix shape**: a lightweight gate that runs every `*.probe.sh` when any `.claude/hooks/*.sh` changed (a `guard:hook-probes` ops command in the lint job, or a pre-commit keyed on the hooks-dir diff). **Promote when**: next hook-script touch, or a probe-detectable regression slips through.

**Why:** 05-tooling prefers structural enforcement over remembered manual steps; the probes exist but their execution is memory-dependent.

MEMBER: `.claude/hooks/pr-monitor-reminder.sh` has no probe.sh either. It is PR-flow-critical (it is the artifact that tells the agent to arm the CI monitor, and as of #1989 to stop the prior one), and its logic is non-trivial — PR-number resolution with a `gh pr create` stdout path plus a `gh pr list` fallback, a tag-push exclusion, per-(PR,SHA) dedup, and an assignee backfill. A probe would pin the banner's required lines and the exclusion branches against a synthetic hook payload.

MEMBER (added from the #1985 round-6 review): `.husky/pre-commit` has no probe.sh at all — its TEMPORAL_PATTERN catch/ignore smoke list lives as an embedded shell COMMENT that a human is expected to copy-paste and run. #1985 tightened that pattern (`round [0-9]+` to `round[- ][0-9]+`), extended the smoke list to 11 catch / 9 ignore cases, and verified them by hand, but nothing re-runs them. So this hook needs the probe.sh written first, then wired by the same gate as the rest. Extracting the pattern from the file and asserting the two lists against `grep -E` is the whole harness — the existing probe.sh files are the shape to copy.

MEMBER (added 2026-08-07 from the #2002 round-7 review): when the
pr-merge-review-check probe is written, pin PR-NUMBER EXTRACTION as its own case
group. The extraction is `REMAINDER="${COMMAND#*gh*pr*merge}"` followed by the
first standalone all-digit token. That uses SHORTEST-prefix removal, so a chained
command carrying an earlier `gh`...`pr`...`merge` token sequence (an echoed
string, a heredoc mentioning the command) can anchor the remainder on the wrong
occurrence.

Merits disposition, since the reviewer scoped it as pre-existing and that is not
a verdict: NOT fixed in #2002, and not because it predates the PR. It is
genuinely low-risk - misleading it needs an earlier gh/pr/merge sequence
FOLLOWED by a bare digit token before the real invocation - but the failure mode
is not benign if it ever fires: a wrong PR number makes the gate fetch a
different PR's review, and if that PR has none, the gate exits 0 and the merge
proceeds UNREVIEWED. That is the exact outcome this hook exists to prevent, so
it earns a pinned case rather than a shrug.

Cases to pin: bare `gh pr merge 2002`; flags-first `gh pr merge --rebase 2002`;
a chained `echo "gh pr merge 1" && gh pr merge 2002`; and a heredoc body
mentioning the command. Assert the extracted PR_NUM, not just the exit code -
exit code alone cannot distinguish "right PR" from "wrong PR with no review".
<!-- SECTION:DESCRIPTION:END -->
