---
id: TASK-1517
title: >-
  Pre-push runs unthrottled in a worktree: LOW_RESOURCE_MODE only read from the
  checkout-local .env
status: To Do
assignee: []
created_date: '2026-11-23T15:57:00Z'
labels:
  - area:husky
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1517000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: a push from .claude/worktrees/task-1515 (2026-11-23) ran turbo build/lint/test across 15 packages in parallel at ~3.2 GB RSS with MemAvailable at 756 MB; the Deck session flagged it. Cause, verified: .husky/pre-push:130-132 reads LOW_RESOURCE_MODE from the env or from `.env` in the CURRENT checkout, and the core-count auto-detect (pre-push:146-158) only fires at <=4 cores (this Deck reports nproc 8). Worktrees have no .env (gitignored, never copied), so every worktree push gets no --concurrency=1 and no vitest maxWorkers cap, even though the main tree .env sets LOW_RESOURCE_MODE.

What: when .env is absent, fall back to the main tree .env via `git rev-parse --git-common-dir` (its parent is the main checkout), or add a MemAvailable/MemTotal-based auto-detect beside the core-count one. Related: TASK-829 (bare pnpm test has the same env-delivery gap), TASK-374 (runtime capability detection).

Acceptance: a push from a worktree with no .env and LOW_RESOURCE_MODE unset prints the low-resource trigger line and runs turbo with --concurrency=1; the hook probe covers the no-.env worktree case.
<!-- SECTION:DESCRIPTION:END -->
