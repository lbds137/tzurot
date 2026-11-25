---
id: TASK-1556
title: Adopt cloud-launch in tzurot-orchestration Cloud dispatch
status: To Do
assignee: []
created_date: '2026-11-25T22:56:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1549000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Deck Platform shipped cloud-launch (deck-platform de71856), a generic claude --cloud launcher that pins the base by sha, refuses a base not on origin, logs each attempt (--list), and parses success instead of assuming it. The tzurot-orchestration Cloud dispatch section hand-rolls the same launch (prompt file, two-line launcher, script -qfec). What: replace the launch steps with cloud-launch, move the step-0 block into .claude/cloud/step0.md (cloud-launch reads it), and check its Delivery section against the skill (push branch, no PR, report via get_run_log). Report any gaps to the Deck Platform session. Related: TASK-1091, TASK-1109 (permission-mode auto on the launcher), TASK-1111. Acceptance: the skill section names cloud-launch as the launch path, and one real cloud unit launched through it.
<!-- SECTION:DESCRIPTION:END -->
