---
id: TASK-859
title: >-
  05-tooling PR Monitoring prose is stale since ci-gate rejects a non-head
  --sha; add the cwd/worktree cause
status: To Do
assignee: []
created_date: '2026-09-01 23:43'
labels:
  - 'area:rules'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 859000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: 05-tooling.md § PR Monitoring still says a moved HEAD "makes the gate watch a different SHA in silence" and "no local check objects". Both claims are stale: since 4ad18083c (TASK-459) gh:ci-gate fetches the PR head and refuses a --sha that is not it, so the gate objects loudly. The paragraph also names only a branch hop as the cause; TASK-595 (archived, option (b) already shipped under 459) recorded a second cause that bit live: the substitution resolves in the persistent shell cwd, so a worktree-held branch armed from the main checkout watches the main checkout HEAD. Rules are review-gated, so this is its own PR.

Fix shape: rewrite that paragraph in 05-tooling.md § PR Monitoring to (1) drop the silence claim and state that the gate refuses a non-head SHA, (2) name the cwd/worktree cause beside the branch hop, and (3) keep the instruction to arm immediately. Run pnpm ops guard:monitor-command (the fenced invocation must not change) and lines:update-baseline --surface rules.

Acceptance: the paragraph carries no claim the shipped head-SHA check falsifies; both causes are named; guard:monitor-command and lines:check green.
<!-- SECTION:DESCRIPTION:END -->
