---
id: TASK-1209
title: >-
  develop-code-commit-guard judges a commit after a non-leading cd against the
  starting checkout
status: To Do
assignee: []
created_date: '2026-10-11 13:07'
labels:
  - 'area:hooks'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1198000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the guard reads the branch and dirty tree of the checkout the command STARTS in (or, since TASK-1203, the directory of a leading `cd /abs &&` or `git -C /abs`). A cd that is not the first segment is not followed, so `git status && cd /abs/worktree-on-develop && git commit -m y` run from a feature worktree passes while the commit lands on develop. Measured by the TASK-1203 review-round worker (probe row red at exit 0, removed from that PR as out of scope). Not introduced by TASK-1203: the shape bypassed the guard before it as well. Same class: `env -C <dir> git commit`, `pushd`.

What: in lib/branch_switch.py commit_target_dir, follow every absolute `cd`/`pushd` in a pure && chain (relative cds resolve against the previous absolute dir when known, else None) and return the directory the commit actually runs in; when a later cd cannot be resolved, return a sentinel that makes the guard fall back to blocking rather than judging the starting checkout. Decide the over-block cost explicitly (relative cd into a subdirectory of this checkout is common and must keep working).

Acceptance: probe rows for a later absolute cd into a develop worktree (blocks), a later relative cd into a subdir of this checkout (unchanged), pushd, and env -C.
<!-- SECTION:DESCRIPTION:END -->
