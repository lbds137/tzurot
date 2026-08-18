---
id: TASK-653
title: Merge-time hook should demand re-derivation of numeric claims in a PR body
status: To Do
assignee: []
created_date: '2026-08-18 03:02'
labels:
  - 'area:hooks'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 653000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: three stale self-reported numbers landed in one day, each caught by a reviewer rather than the author -- beta.204 release PR body said 72 files when the diff was 91; PR 2134 commit message said the interval was half the cache TTL after the code moved to a third; PR 2135 body said 12 colocated tests when there were 38. Each was correct when written and became false when the underlying thing moved. Nothing in the workflow prompts a re-read, so care alone does not fix it.

Why a hook and not a rule: .claude/rules is at 154272 of 154502 bytes, roughly 230 bytes of headroom, so a rule addition would blow the always-loaded budget. The trigger is also deterministic and the correction mechanical, which is the hook criterion in 00-critical Fix Recurring Failures Structurally.

Fix shape: extend .claude/hooks/pr-merge-review-check.sh, which already fires on gh pr merge and already injects the review body. Have it additionally scan the PR body and the head commit message for numeric claims -- integers next to words like file, files, test, tests, PR, PRs, site, sites, percent, or a fraction phrase like half/third of -- and print them back as a re-derive checklist before allowing the merge retry. It does NOT need to verify the numbers, only to force the author to look at them at the one moment they otherwise never do.

Note the commit-message half is the sharpest case: git commit --fixup never touches the base message, so N rounds of fixups leave it describing a design that no longer exists, and it becomes permanent history.

Acceptance: attempting to merge a PR whose body contains a numeric claim prints that claim in a re-derive list; a body with no numeric claims passes silently. Probe added per the guard hook-probes registry.
<!-- SECTION:DESCRIPTION:END -->
