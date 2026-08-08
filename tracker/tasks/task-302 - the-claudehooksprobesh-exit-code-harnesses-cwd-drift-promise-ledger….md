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

MEMBER (added 2026-08-07 while shipping TASK-458): `.claude/hooks/pr-merge-review-check.sh` has no probe either, and it is the highest-stakes hook in the set — it BLOCKS `gh pr merge` and is the structural backstop behind 00-critical's read-the-review rule. #2002 modified it (folding in the release-finalize reminder) and the only way to verify the change was a hand-built harness: copy the script to /tmp with ACK_FILE redirected, run it against a real merged main-based PR and a develop-based one, and assert exit 2 -> exit 0 on retry plus release-section presence/absence. That worked (all four assertions passed) but nothing re-runs it, which is this task's whole complaint. The ACK_FILE redirect is the only parameterization needed — worth making the script honor an env override so the probe does not have to sed itself a copy.

MEMBER (added from the #1985 round-6 review): `.husky/pre-commit` has no probe.sh at all — its TEMPORAL_PATTERN catch/ignore smoke list lives as an embedded shell COMMENT that a human is expected to copy-paste and run. #1985 tightened that pattern (`round [0-9]+` to `round[- ][0-9]+`), extended the smoke list to 11 catch / 9 ignore cases, and verified them by hand, but nothing re-runs them. So this hook needs the probe.sh written first, then wired by the same gate as the rest. Extracting the pattern from the file and asserting the two lists against `grep -E` is the whole harness — the existing probe.sh files are the shape to copy.
<!-- SECTION:DESCRIPTION:END -->
