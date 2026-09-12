---
id: TASK-943
title: >-
  release:bump rewrites package.json files inside .claude/worktrees, editing
  another checkout
status: Done
assignee: []
created_date: '2026-09-12 14:43'
updated_date: '2026-09-12 16:06'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 941000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: pnpm ops release:bump 3.0.0-beta.223 (2026-09-12) reported 34 files updated: the 17 workspace package.json files AND the same 17 under .claude/worktrees/agent-*/ while a dispatched orchestrator was working there. The glob that finds package.json files does not exclude .claude/worktrees (or any nested git checkout), so the bump silently dirties an unrelated worktree mid-dispatch; the transfer then carries version hunks that only drop out because develop lands the same values first. Cost measured: 17 spurious modified files in a live agent worktree at the beta.223 cut.
Fix shape: in packages/tooling/src/release (the bump command), enumerate package.json files from git ls-files or the pnpm workspace globs instead of a recursive walk, or exclude any path containing /.claude/worktrees/ and any directory holding its own .git; add a test with a fixture worktree directory asserting it is skipped; check whether other recursive package.json walkers in tooling (grep findPackageJsonFiles) share the gap and fix them in the same PR.
Acceptance: a bump run with a populated .claude/worktrees/ touches only the 17 workspace manifests and prints 17; the test fails if the exclusion is removed.
<!-- SECTION:DESCRIPTION:END -->
