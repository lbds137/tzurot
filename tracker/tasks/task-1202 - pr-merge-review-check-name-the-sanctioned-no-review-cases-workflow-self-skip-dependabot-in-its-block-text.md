---
id: TASK-1202
title: >-
  pr-merge-review-check: name the sanctioned no-review cases (workflow
  self-skip, dependabot) in its block text
status: Done
assignee: []
created_date: '2026-10-11 11:06'
updated_date: '2026-10-11 17:29'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1191000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the 2026-10-11 session-mining pass found 2 blocks (one session) on main-cut workflow PRs where claude-review posts nothing by design: the review action skips itself when .github/workflows/claude-code-review.yml differs from main (claude-code-review.yml, Verify a review was posted step). The hook block on a base=main PR says only "no claude-review comment found", so the driver spent ~4 minutes reading workflow if: conditions, rerunning, and pulling the job log before concluding the skip was legitimate.

What: in pr-merge-review-check.sh, when no claude[bot] comment exists, check whether the PR diff touches .github/workflows/claude-code-review.yml (gh pr diff --name-only, bounded, fail-open) and, if so, name the self-skip in the block header and say not to rerun; name the dependabot no-review case the same way. Probe rows for both, plus a negative row (no review, workflow untouched keeps the current text).

Acceptance: probe rows green; the release reminder still fires on the self-skip path.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shipped in #2603.
<!-- SECTION:NOTES:END -->
