---
id: TASK-485
title: >-
  pr-merge-review-check: a -c-wrapped merge invocation loses PR priority to a
  later plain one
status: Done
assignee: []
created_date: '2026-08-09 14:55'
updated_date: '2026-08-13 23:52'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 485000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: in the merge-gate hook, a gh pr merge wrapped in bash -c / eval is detected via the over-arm path, but when the SAME command also carries a later plain gh pr merge invocation naming a different PR, the plain match wins the PR-number extraction - the gate then reads the review-ack state of the wrong PR (both PRs real, wrong one gated). Surfaced on PR #2009 round-8 review as an over-arm-adjacent precision issue; new-code-only; the reviewer and agent agreed it is a backlog candidate, and the filing was promised on merge (merged 2026-08-08) - this task closes that promise (found unfiled by the 2026-08-09 session-mining sweep).
Fix shape: when both a wrapped-invocation match and a plain match exist in one command, prefer the earliest match position (or gate on BOTH PR numbers) instead of letting the plain regex win unconditionally. Whole-detection-chain pass, same file as TASK-484.
Acceptance: a command containing bash -c "gh pr merge 111 ..." followed by gh pr merge 222 gates on 111 (or both), pinned by a probe case.
<!-- SECTION:DESCRIPTION:END -->
