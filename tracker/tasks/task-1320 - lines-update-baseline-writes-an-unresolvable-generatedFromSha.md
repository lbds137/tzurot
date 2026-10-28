---
id: TASK-1320
title: lines:update-baseline writes an unresolvable generatedFromSha
status: To Do
assignee: []
created_date: '2026-10-28T23:16:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1303000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
lines:update-baseline stamps generatedFromSha from the working tree, so the SHA names a pre-squash/pre-amend state that dangles after rebase-merge. Recurred 4x on PR 2681 (r2/r4/r5/r6 findings) and consumed a review round each time. Fix shape: record HEAD when the tree matches the commit, or omit the field when the tree is dirty; first grep the consumer set (generatedFromSha across packages/tooling) so no gate resolves the field. Precedent: dc2862a5 on the current baseline also dangles - informational today, but any future resolver fails on both baselines.
<!-- SECTION:DESCRIPTION:END -->
