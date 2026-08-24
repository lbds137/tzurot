---
id: TASK-756
title: board-commit-branch-gate bypass is unreachable from the agent seat
status: To Do
assignee: []
created_date: '2026-08-24 00:40'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 756000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the hook documents TZUROT_ALLOW_BOARD_ON_FEATURE=1 as a same-command bypass, but line 91 checks the variable in the HOOK process environment - a PreToolUse hook runs before the command, so a command-line env prefix can never reach it. Observed live: the prescribed form was blocked twice on a doc fixup that genuinely belonged with its PR (the review-finding sweep for PR 2203); the develop-direct fallback worked but cost the PR its self-contained fix.
Fix shape: make the hook honor the bypass from the COMMAND STRING it receives on stdin (grep the command JSON for the variable prefix), keeping the env check as a second path; add a probe case per guard:hook-probes.
Acceptance: a single Bash call of the documented form commits on a feature branch; the probe pins it.
<!-- SECTION:DESCRIPTION:END -->
