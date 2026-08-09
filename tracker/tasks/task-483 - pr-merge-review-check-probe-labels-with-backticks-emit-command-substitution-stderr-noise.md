---
id: TASK-483
title: >-
  pr-merge-review-check probe labels with backticks emit command-substitution
  stderr noise
status: Done
assignee: []
created_date: '2026-08-09 11:28'
updated_date: '2026-08-09 14:21'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 483000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: case labels containing backticked words in pr-merge-review-check.probe.sh trigger "command substitution: syntax error" lines on stderr when echoed. Assertions still PASS — cosmetic only — but the noise reads as a failing probe to anyone scanning stderr.
Fix shape: single-quote or escape the backticked words in the label strings.
Surfaced by post-merge audit of the hooks PRs.
<!-- SECTION:DESCRIPTION:END -->
