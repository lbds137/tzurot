---
id: TASK-473
title: pr-merge-review-check prefers a later plain merge over an earlier wrapped one
status: Done
assignee: []
created_date: '2026-08-08 23:35'
updated_date: '2026-08-09 01:12'
labels:
  - 'area:process'
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 473000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The merge gate scans top-level tokens first and only recurses into `-c` / `eval` string arguments after the whole top level is exhausted. So in `bash -c "gh pr merge 2001" && gh pr merge 2002` the extractor returns 2002, even though 2001 is the first merge in execution order.

Both invocations are real merges, so this is a precision issue, not a bypass: the gate still arms, just on the wrong PR. That direction is the safe one (an over-arm shows an unrelated review and the agent retries), which is why it did not block PR 2009.

Fix shape: collect nested `-c` / `eval` arguments with their token index, then resolve candidates in index order rather than draining the top level first. The recursion already exists; only the ordering changes.

Acceptance: a probe case pinning `bash -c "gh pr merge 2001" && gh pr merge 2002` to 2001, plus the existing suite green.
<!-- SECTION:DESCRIPTION:END -->
